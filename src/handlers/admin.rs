//! 账号管理台的后端（`/api/admin/*`）。
//!
//! 需求原话：一个实例上会有若干"给家人朋友共享的短期子账号"，需要主账号能在一个
//! 独立页面里**看到并控制**它们（改有效期 / 停用 / 踢下线 / 重置 2FA / 删除）。
//!
//! ## 安全边界（改这个文件前先读）
//!
//! 1. **鉴权只有一条**：请求头 `X-Admin-Token` 必须等于 secret `ADMIN_TOKEN`。
//!    比较用 `constant_time_eq`（与 `auth.rs` 校验 JWT 同一套做法），避免时序侧信道；
//!    "没给"和"给错"返回**完全相同**的响应，避免被用来探测。
//! 2. **写操作双保险**：`ADMIN_ENV != "test"` 时还要求 `ADMIN_ALLOW_WRITES == "yes"` 才放行。
//!    避免这份代码（或它的一个副本）被误配到别的库上就悄悄改数据。
//! 3. **零知识**：库里的 name/username/password/totp 全是密文，解密的钥匙在用户主密码里。
//!    这里**读不到也永远读不到**任何条目明文 —— 管理台能给的只有元数据与生命周期动作。
//! 4. **停用必须真的停用**：`disable` 除了写 `disabled_at`，还会**轮换 security_stamp**。
//!    因为 `auth::decode_access_token` 每次都拿库里的 `security_stamp` 与 JWT 里的对比，
//!    轮换即让该账号**已登录的所有设备立刻失效** —— 否则"停用"只是个 UI 标签。
//! 5. **删除要连存储一起删**：附件在 R2/KV 里，只删 D1 行会把对象泄漏成永久垃圾。

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{Duration, Utc};
use constant_time_eq::constant_time_eq;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;
use worker::Env;

use crate::d1_query;
use crate::db::{self, now_string, Db};
use crate::error::AppError;
use crate::handlers::{attachments, sends};

/// 有效期天数的上限（约 10 年）。超过这个值更可能是前端打错了。
const MAX_EXPIRE_DAYS: i64 = 3650;

/// 状态徽章里"即将到期"的窗口，与前端 `--` 的 7 天口径保持一致。
const EXPIRING_WINDOW_DAYS: i64 = 7;

/* ---------------------------------- 工具 ---------------------------------- */

fn admin_env(env: &Env) -> String {
    env.var("ADMIN_ENV")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "prod".to_string())
}

fn db_label(env: &Env) -> String {
    env.var("ADMIN_DB")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "vault1".to_string())
}

fn iso(days_from_now: i64) -> String {
    (Utc::now() + Duration::days(days_from_now))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

fn forbidden(message: &str) -> AppError {
    AppError::api_json(
        StatusCode::FORBIDDEN,
        json!({ "error": "write_refused", "message": message }),
    )
}

/// 鉴权 + 写操作护栏。`is_write` 由每个 handler 显式传入（在读接口里传 `false`）。
fn authorize(env: &Env, headers: &HeaderMap, is_write: bool) -> Result<(), AppError> {
    let expected = match env.secret("ADMIN_TOKEN") {
        Ok(secret) => secret.to_string(),
        Err(_) => String::new(),
    };
    if expected.trim().is_empty() {
        return Err(AppError::api_json(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({ "error": "not_configured", "message": "服务端未配置 ADMIN_TOKEN" }),
        ));
    }

    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
        // 故意不区分"为空"与"错误"
        return Err(AppError::api_json(
            StatusCode::UNAUTHORIZED,
            json!({ "error": "unauthorized", "message": "管理令牌不正确" }),
        ));
    }

    let env_name = admin_env(env);
    if is_write && env_name != "test" {
        let allow = env
            .var("ADMIN_ALLOW_WRITES")
            .map(|v| v.to_string().eq_ignore_ascii_case("yes"))
            .unwrap_or(false);
        if !allow {
            return Err(forbidden(
                "写操作未启用。这是保护措施：确认要在这个实例上开放管理写权限，再设置 ADMIN_ALLOW_WRITES=yes。",
            ));
        }
    }

    Ok(())
}

/// 表里是否真的有这一行；顺便把邮箱带回来供 404 之外的场景使用。
async fn find_user_email(db: &Db, id: &str) -> Result<Option<String>, AppError> {
    db.prepare("SELECT email FROM users WHERE id = ?1")
        .bind(&[id.to_string().into()])
        .map_err(|_| AppError::Database)?
        .first::<String>(Some("email"))
        .await
        .map_err(|_| AppError::Database)
}

fn not_found() -> AppError {
    AppError::api_json(
        StatusCode::NOT_FOUND,
        json!({ "error": "not_found", "message": "账号不存在" }),
    )
}

/* --------------------------------- 读接口 --------------------------------- */

#[worker::send]
pub async fn session(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, false)?;
    Ok(Json(json!({
        "ok": true,
        "env": admin_env(&env),
        "db": db_label(&env),
        "now": now_string(),
    })))
}

#[derive(Deserialize)]
struct UserRow {
    id: String,
    email: String,
    name: Option<String>,
    /// D1 里 BOOLEAN 实际返回整数（见 models/user.rs 的 `bool_from_int`），按整数收。
    email_verified: Option<i64>,
    created_at: Option<String>,
    updated_at: Option<String>,
    expires_at: Option<String>,
    disabled_at: Option<String>,
    items: Option<i64>,
    devices: Option<i64>,
    totp: Option<i64>,
}

const USERS_SQL: &str = "SELECT u.id, u.email, u.name, u.email_verified, u.created_at, u.updated_at, \
     u.expires_at, u.disabled_at, \
     (SELECT COUNT(*) FROM ciphers c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS items, \
     (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS devices, \
     (SELECT COUNT(*) FROM twofactor t WHERE t.user_uuid = u.id AND t.atype = 0 AND t.enabled = 1) AS totp \
   FROM users u ORDER BY u.created_at DESC";

#[worker::send]
pub async fn list_users(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, false)?;
    let db = db::get_db(&env)?;

    let rows: Vec<UserRow> = db
        .prepare(USERS_SQL)
        .all()
        .await
        .map_err(|_| AppError::Database)?
        .results()
        .map_err(|_| AppError::Database)?;

    let users: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "email": r.email,
                "name": r.name.unwrap_or_default(),
                "email_verified": r.email_verified.unwrap_or(0) != 0,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
                "expires_at": r.expires_at,
                "disabled_at": r.disabled_at,
                "items": r.items.unwrap_or(0),
                "devices": r.devices.unwrap_or(0),
                "has_totp": r.totp.unwrap_or(0) > 0,
            })
        })
        .collect();

    Ok(Json(json!({ "ok": true, "users": users })))
}

#[derive(Deserialize)]
struct StatsRow {
    users: Option<i64>,
    items: Option<i64>,
    totp: Option<i64>,
    disabled: Option<i64>,
    expiring: Option<i64>,
}

const STATS_SQL: &str = "SELECT \
     (SELECT COUNT(*) FROM users) AS users, \
     (SELECT COUNT(*) FROM ciphers WHERE deleted_at IS NULL) AS items, \
     (SELECT COUNT(*) FROM twofactor WHERE atype = 0 AND enabled = 1) AS totp, \
     (SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL) AS disabled, \
     (SELECT COUNT(*) FROM users WHERE expires_at IS NOT NULL \
        AND expires_at > ?1 AND expires_at <= ?2) AS expiring";

#[worker::send]
pub async fn stats(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, false)?;
    let db = db::get_db(&env)?;

    // 到期窗口用"字符串比较"（列里存的就是同格式的 ISO8601，与 created_at 同形）
    let now = now_string();
    let soon = iso(EXPIRING_WINDOW_DAYS);

    let row: Option<StatsRow> = d1_query!(&db, STATS_SQL, now, soon)
        .map_err(|_| AppError::Database)?
        .first(None)
        .await
        .map_err(|_| AppError::Database)?;
    let r = row.unwrap_or(StatsRow {
        users: None,
        items: None,
        totp: None,
        disabled: None,
        expiring: None,
    });

    Ok(Json(json!({
        "ok": true,
        "stats": {
            "users": r.users.unwrap_or(0),
            "items": r.items.unwrap_or(0),
            "totp": r.totp.unwrap_or(0),
            "disabled": r.disabled.unwrap_or(0),
            "expiring": r.expiring.unwrap_or(0),
        }
    })))
}

/* --------------------------------- 写接口 --------------------------------- */

/// POST /api/admin/users/{id}/sign-out
///
/// 轮换 `security_stamp` 并清空该账号的设备记录。二者任一都会让既有 JWT 失效
/// （`decode_access_token` 会同时校验 stamp 与 devices 行），所以这是"立刻踢下线"。
#[worker::send]
pub async fn sign_out(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, true)?;
    let db = db::get_db(&env)?;

    if find_user_email(&db, &id).await?.is_none() {
        return Err(not_found());
    }

    let now = now_string();
    let stamp = Uuid::new_v4().to_string();
    db.batch(vec![
        d1_query!(
            &db,
            "UPDATE users SET security_stamp = ?1, updated_at = ?2 WHERE id = ?3",
            stamp,
            now,
            id
        )
        .map_err(|_| AppError::Database)?,
        d1_query!(&db, "DELETE FROM devices WHERE user_id = ?1", id)
            .map_err(|_| AppError::Database)?,
    ])
    .await
    .map_err(|_| AppError::Database)?;

    Ok(Json(
        json!({ "ok": true, "message": "已轮换安全戳并清空设备" }),
    ))
}

/// POST /api/admin/users/{id}/reset-2fa
///
/// `twofactor.atype`: 0 = TOTP, 1 = Email, 5 = Remember(设备信任), 8 = RecoveryCode。
/// 清 0/5/8 —— 留下 Email 类（本项目不提供邮件 2FA，留着也无害，且避免误删未来扩展）。
#[worker::send]
pub async fn reset_2fa(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, true)?;
    let db = db::get_db(&env)?;

    if find_user_email(&db, &id).await?.is_none() {
        return Err(not_found());
    }

    let now = now_string();
    db.batch(vec![
        d1_query!(
            &db,
            "DELETE FROM twofactor WHERE user_uuid = ?1 AND atype IN (0, 5, 8)",
            id
        )
        .map_err(|_| AppError::Database)?,
        d1_query!(
            &db,
            "UPDATE users SET totp_recover = NULL, updated_at = ?1 WHERE id = ?2",
            now,
            id
        )
        .map_err(|_| AppError::Database)?,
    ])
    .await
    .map_err(|_| AppError::Database)?;

    Ok(Json(
        json!({ "ok": true, "message": "已清除该账号的两步验证" }),
    ))
}

/// POST /api/admin/users/{id}/expire   body: `{"days": 7}` 或 `{"days": null}`（取消）
#[worker::send]
pub async fn expire(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, true)?;
    let db = db::get_db(&env)?;

    if find_user_email(&db, &id).await?.is_none() {
        return Err(not_found());
    }

    let days = body.get("days").cloned().unwrap_or(Value::Null);
    let value = match days {
        Value::Null => None,
        Value::Number(n) => {
            let d = n.as_f64().unwrap_or(f64::NAN);
            if !d.is_finite() || d < 1.0 || d > MAX_EXPIRE_DAYS as f64 {
                return Err(AppError::api_json(
                    StatusCode::BAD_REQUEST,
                    json!({
                        "error": "bad_days",
                        "message": format!("days 需在 1–{MAX_EXPIRE_DAYS} 之间，或传 null 取消")
                    }),
                ));
            }
            Some(iso(d.round() as i64))
        }
        _ => {
            return Err(AppError::api_json(
                StatusCode::BAD_REQUEST,
                json!({ "error": "bad_days", "message": "days 必须是数字或 null" }),
            ))
        }
    };

    let now = now_string();
    d1_query!(
        &db,
        "UPDATE users SET expires_at = ?1, updated_at = ?2 WHERE id = ?3",
        value.clone(),
        now,
        id
    )
    .map_err(|_| AppError::Database)?
    .run()
    .await
    .map_err(|_| AppError::Database)?;

    Ok(Json(json!({
        "ok": true,
        "expires_at": value,
        "message": if value.is_some() { "已设置到期" } else { "已取消到期" },
    })))
}

/// POST /api/admin/users/{id}/disable   body: `{"disabled": true|false}`
///
/// 🔴 停用**同时轮换 security_stamp**：`decode_access_token` 每次都会把 JWT 里的 stamp
/// 与库里的现价比对，轮换即让该账号已登录的所有设备立刻失效。
/// 只写 `disabled_at` 的话，一个已经登录的客户端会继续用旧的 JWT 畅通无阻，
/// 直到 token 自然过期 —— 那"停用"就只是个 UI 标签。
#[worker::send]
pub async fn disable(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, true)?;
    let db = db::get_db(&env)?;

    if find_user_email(&db, &id).await?.is_none() {
        return Err(not_found());
    }

    let disabled = body
        .get("disabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let now = now_string();
    let stamp = if disabled {
        Some(Uuid::new_v4().to_string())
    } else {
        None
    };

    let mut statements = vec![
        d1_query!(
            &db,
            "UPDATE users SET disabled_at = ?1, updated_at = ?2 WHERE id = ?3",
            if disabled { Some(now.clone()) } else { None },
            now,
            id.clone()
        )
        .map_err(|_| AppError::Database)?,
    ];
    if let Some(stamp) = stamp {
        statements.push(
            d1_query!(
                &db,
                "UPDATE users SET security_stamp = ?1 WHERE id = ?2",
                stamp,
                id.clone()
            )
            .map_err(|_| AppError::Database)?,
        );
        statements.push(
            d1_query!(&db, "DELETE FROM devices WHERE user_id = ?1", id.clone())
                .map_err(|_| AppError::Database)?,
        );
    }

    db.batch(statements).await.map_err(|_| AppError::Database)?;

    Ok(Json(json!({
        "ok": true,
        "disabled": disabled,
        "message": if disabled { "已停用" } else { "已启用" },
    })))
}

/// DELETE /api/admin/users/{id}
///
/// 与官方 `accounts::delete_account` 同一套清理口径（附件对象 + sends + ciphers + folders + user），
/// 另外显式清 `devices` / `twofactor` / `auth_requests` —— 管理台路径上没有"用户自己还在线"
/// 这回事，不能依赖外键级联。
#[worker::send]
pub async fn delete_user(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, true)?;
    let db = db::get_db(&env)?;

    if find_user_email(&db, &id).await?.is_none() {
        return Err(not_found());
    }

    // 1) 附件对象（R2/KV）——只删 D1 行会把对象留成永久垃圾
    if attachments::attachments_enabled(env.as_ref()) {
        let keys = attachments::list_attachment_keys_for_user(&db, &id).await?;
        attachments::delete_storage_objects(env.as_ref(), &keys).await?;
    }

    // 2) 该账号的 Sends（含它们的存储对象）
    sends::delete_user_sends(&db, env.as_ref(), &id).await?;

    // 3) D1 行。子表在前，users 最后。
    db.batch(vec![
        d1_query!(&db, "DELETE FROM ciphers WHERE user_id = ?1", id)
            .map_err(|_| AppError::Database)?,
        d1_query!(&db, "DELETE FROM folders WHERE user_id = ?1", id)
            .map_err(|_| AppError::Database)?,
        d1_query!(&db, "DELETE FROM devices WHERE user_id = ?1", id)
            .map_err(|_| AppError::Database)?,
        d1_query!(&db, "DELETE FROM twofactor WHERE user_uuid = ?1", id)
            .map_err(|_| AppError::Database)?,
        d1_query!(&db, "DELETE FROM auth_requests WHERE user_id = ?1", id)
            .map_err(|_| AppError::Database)?,
        d1_query!(&db, "DELETE FROM users WHERE id = ?1", id)
            .map_err(|_| AppError::Database)?,
    ])
    .await
    .map_err(|_| AppError::Database)?;

    Ok(Json(json!({ "ok": true, "message": "账号已删除" })))
}

/* --------------------------------- 定时任务 --------------------------------- */

/// 每日 cron：把已过期且尚未停用的账号置为停用（**不做静默删除**，与前端文案一致）。
///
/// 只写 `disabled_at`，**不轮换 security_stamp** —— 定时任务不该在没有人工介入的情况下
/// 批量把用户的登录态打散；真正需要立刻踢下线时由管理员在管理台点「踢下线」。
/// 返回被停用的账号数。
pub async fn disable_expired_accounts(env: &Env) -> Result<u32, worker::Error> {
    let db = db::get_db(env).map_err(|e| worker::Error::RustError(e.to_string()))?;
    let now = now_string();

    let expired: Vec<ExpiredUser> = d1_query!(
        &db,
        "SELECT id FROM users WHERE disabled_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?1",
        now.clone()
    )
    .map_err(|e| worker::Error::RustError(e.to_string()))?
    .all()
    .await
    .map_err(|e| worker::Error::RustError(e.to_string()))?
    .results()
    .map_err(|e| worker::Error::RustError(e.to_string()))?;

    if expired.is_empty() {
        return Ok(0);
    }

    let mut statements = Vec::with_capacity(expired.len());
    for user in &expired {
        statements.push(
            d1_query!(
                &db,
                "UPDATE users SET disabled_at = ?1, updated_at = ?2 WHERE id = ?3",
                now.clone(),
                now.clone(),
                user.id.clone()
            )
            .map_err(|e| worker::Error::RustError(e.to_string()))?,
        );
    }
    db.batch(statements)
        .await
        .map_err(|e| worker::Error::RustError(e.to_string()))?;

    log::info!(
        "Auto-disabled {} expired account(s) (not deleted, metadata kept)",
        expired.len()
    );
    Ok(expired.len() as u32)
}

#[derive(Deserialize)]
struct ExpiredUser {
    id: String,
}
