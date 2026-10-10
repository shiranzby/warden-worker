//! 账号管理台的后端（`/api/admin/*`）。
//!
//! 需求原话：一个实例上会有若干"给家人朋友共享的短期子账号"，需要主账号能在一个
//! 独立页面里**看到并控制**它们（改有效期 / 停用 / 踢下线 / 重置 2FA / 删除）。
//!
//! ## 安全边界（改这个文件前先读）
//!
//! 1. **鉴权有两条通道**（任一通过即可，见 `resolve_actor`）：
//!    1a. 请求头 `X-Admin-Token` 必须等于 secret `ADMIN_TOKEN`，视为 **owner 级**。
//!        比较用 `constant_time_eq`（与 `auth.rs` 校验 JWT 同一套做法），避免时序侧信道；
//!        "没给"和"给错"返回**完全相同**的响应，避免被用来探测。
//!        ⚠️ **给了令牌头就不回退到会话** —— 否则"令牌写错了但会话有效"会静默变成成功。
//!    1b. `Authorization: Bearer <JWT>`：走 `auth::decode_access_token`（校验签名、
//!        security_stamp、devices 行），再查 `users.role` 定级。
//!        这是本轮的**主通道** —— web vault 里登录着就能判出身份，不必再让人记令牌。
//!    分级用 `Role` 的 `Ord`（`user < admin < owner`），每个 handler 显式声明自己要求哪一级。
//! 2. **写操作双保险**：`ADMIN_ENV != "test"` 时还要求 `ADMIN_ALLOW_WRITES == "yes"` 才放行。
//!    避免这份代码（或它的一个副本）被误配到别的库上就悄悄改数据。
//! 3. **零知识**：库里的 name/username/password/totp 全是密文，解密的钥匙在用户主密码里。
//!    这里**读不到也永远读不到**任何条目明文 —— 管理台能给的只有元数据与生命周期动作。
//! 4. **停用必须真的停用**：`disable` 除了写 `disabled_at`，还会**轮换 security_stamp**。
//!    因为 `auth::decode_access_token` 每次都拿库里的 `security_stamp` 与 JWT 里的对比，
//!    轮换即让该账号**已登录的所有设备立刻失效** —— 否则"停用"只是个 UI 标签。
//! 5. **删除要连存储一起删**：附件在 R2/KV 里，只删 D1 行会把对象泄漏成永久垃圾。
//! 6. **所有者可以有多位**，且**管理者不得操作所有者** —— 否则"管理者"与"所有者"就没区别了。
//!    唯一的例外是 `POST /users/{id}/role`：它只认所有者，且拒绝把**最后一个** owner 降级
//!    （否则这个实例就再没人能改角色了，只能回去翻 `ADMIN_TOKEN`）。

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    Json,
};
use chrono::{Duration, Utc};
use constant_time_eq::constant_time_eq;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;
use worker::Env;

use crate::auth::{bearer_token_from_header_value, decode_access_token, Claims};
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

fn unauthorized() -> AppError {
    AppError::api_json(
        StatusCode::UNAUTHORIZED,
        json!({ "error": "unauthorized", "message": "需要管理员登录，或提供正确的管理令牌" }),
    )
}

fn not_configured() -> AppError {
    AppError::api_json(
        StatusCode::SERVICE_UNAVAILABLE,
        json!({ "error": "not_configured", "message": "服务端未配置 ADMIN_TOKEN" }),
    )
}

/* --------------------------------- 角色 ---------------------------------- */

/// 账号角色，落在 `users.role`（迁移 0016，TEXT，默认 `'user'`）。
///
/// `Ord` 按声明顺序，所以可以直接用 `role >= Role::Admin` 表达"至少要到这一级"。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    /// 普通用户：看不到管理页。
    User,
    /// 管理者：看得到管理页、能做账号生命周期动作；但不能改角色，也不能操作 owner。
    Admin,
    /// 所有者：全部权限，是唯一能改角色的一级。**可以有多位。**
    Owner,
}

impl Role {
    /// 未知值一律降级为 `User`：将来若新增角色，老代码只会更保守，不会误放大权限。
    pub fn parse(value: &str) -> Self {
        match value {
            "owner" => Role::Owner,
            "admin" => Role::Admin,
            _ => Role::User,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Admin => "admin",
            Role::Owner => "owner",
        }
    }

    /// 中文名，只用于给用户看的提示文案。
    fn label(self) -> &'static str {
        match self {
            Role::User => "普通用户",
            Role::Admin => "管理者",
            Role::Owner => "所有者",
        }
    }
}

/// 通过鉴权的调用者。
struct Actor {
    role: Role,
    /// 走会话通道时是该账号 id；走令牌通道时为 `None`（令牌不绑定任何账号）。
    user_id: Option<String>,
}

/// 读某个账号当前的角色（`users.role`）。调用前该账号已被 JWT 校验确认存在。
async fn fetch_role(env: &Env, user_id: &str) -> Result<Role, AppError> {
    let db = db::get_db(env)?;
    let role: Option<String> = db
        .prepare("SELECT role FROM users WHERE id = ?1")
        .bind(&[user_id.to_string().into()])
        .map_err(|_| AppError::Database)?
        .first(Some("role"))
        .await
        .map_err(|_| AppError::Database)?;
    Ok(Role::parse(role.as_deref().unwrap_or("user")))
}

/// 会话通道：从 `Authorization: Bearer <JWT>` 解出账号与角色。
async fn session_actor(env: &Env, headers: &HeaderMap) -> Result<(Role, Claims), AppError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(bearer_token_from_header_value)
        .ok_or_else(unauthorized)?;

    let claims = decode_access_token(env, &token).await?;
    let role = fetch_role(env, &claims.sub).await?;
    Ok((role, claims))
}

/// 解析调用者的角色（令牌 ∨ 会话）。分流规则见模块注释第 1 条。
async fn resolve_actor(env: &Env, headers: &HeaderMap) -> Result<Actor, AppError> {
    let expected = env
        .secret("ADMIN_TOKEN")
        .map(|s| s.to_string())
        .unwrap_or_default();
    let token_configured = !expected.trim().is_empty();

    // 通道 1：令牌。**给了这个头就不再回退到会话** —— 否则"令牌写错了但会话有效"
    // 会静默变成成功，令牌的"第二道锁"意义就没了。
    if let Some(provided) = headers.get("x-admin-token").and_then(|v| v.to_str().ok()) {
        if !token_configured {
            return Err(not_configured());
        }
        if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
            // 故意不区分"为空"与"错误"
            return Err(unauthorized());
        }
        return Ok(Actor {
            role: Role::Owner,
            user_id: None,
        });
    }

    // 通道 2：会话。
    match session_actor(env, headers).await {
        Ok((role, claims)) => Ok(Actor {
            role,
            user_id: Some(claims.sub),
        }),
        Err(e) => {
            // 令牌没配、调用者又压根没带会话头 ⇒ 无处可鉴权。报 503 让运维一眼看出
            // 是配置缺失（与升级前的行为一致），而不是伪装成"密码错"。
            if !token_configured && headers.get(header::AUTHORIZATION).is_none() {
                return Err(not_configured());
            }
            Err(e)
        }
    }
}

/// 鉴权 + 分级 + 写操作护栏。
///
/// `need` 是该接口要求的最低角色；`is_write` 由每个 handler 显式传入（读接口传 `false`）。
async fn authorize(
    env: &Env,
    headers: &HeaderMap,
    need: Role,
    is_write: bool,
) -> Result<Actor, AppError> {
    let actor = resolve_actor(env, headers).await?;

    if actor.role < need {
        return Err(AppError::api_json(
            StatusCode::FORBIDDEN,
            json!({
                "error": "insufficient_role",
                "message": format!(
                    "当前账号是{}，该操作需要{}。",
                    actor.role.label(),
                    need.label()
                ),
            }),
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

    Ok(actor)
}

/// 目标账号是否存在 + 调用者够不够格动它。两件事合一次查询：
///
/// 1. 不存在 ⇒ 404（与升级前的行为一致）；
/// 2. 存在，但**目标是 owner 而调用者不是 owner** ⇒ 403。
///    否则管理者可以把所有者停用/删除，"管理者"与"所有者"就成了两个没区别的名字。
async fn ensure_target_manageable(db: &Db, actor: &Actor, id: &str) -> Result<(), AppError> {
    let role: Option<String> = db
        .prepare("SELECT role FROM users WHERE id = ?1")
        .bind(&[id.to_string().into()])
        .map_err(|_| AppError::Database)?
        .first(Some("role"))
        .await
        .map_err(|_| AppError::Database)?;

    let Some(role) = role else {
        return Err(not_found());
    };

    if actor.role < Role::Owner && Role::parse(&role) == Role::Owner {
        return Err(forbidden("管理者不能操作所有者账号。"));
    }

    Ok(())
}

fn not_found() -> AppError {
    AppError::api_json(
        StatusCode::NOT_FOUND,
        json!({ "error": "not_found", "message": "账号不存在" }),
    )
}

/* --------------------------------- 读接口 --------------------------------- */

/// GET /api/admin/me —— **只认会话，不认令牌**。
///
/// web vault 在渲染设置页导航之前调它来判定身份：`is_admin` 为真才显示「账号管理」入口。
/// 因此它**绝不能**对普通用户返回 4xx —— "你不是管理员"在这里是**正常情况**
/// （绝大多数用户都是普通用户），前端不该为此写错误分支。
/// 真正未登录时仍然 401，那才是异常。
///
/// 返回 `is_owner` 单独给出：所有者才能在页面里看到"改角色"的控件。
#[worker::send]
pub async fn me(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let (role, claims) = session_actor(&env, &headers).await?;
    Ok(Json(json!({
        "ok": true,
        "role": role.as_str(),
        "is_admin": role >= Role::Admin,
        "is_owner": role == Role::Owner,
        "user_id": claims.sub,
        "email": claims.email,
        "name": claims.name,
    })))
}

#[worker::send]
pub async fn session(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let actor = authorize(&env, &headers, Role::Admin, false).await?;
    Ok(Json(json!({
        "ok": true,
        "env": admin_env(&env),
        "db": db_label(&env),
        "now": now_string(),
        // 令牌通道拿不到账号，给 null；会话通道回自己的 id。
        "user_id": actor.user_id,
        "role": actor.role.as_str(),
    })))
}

#[derive(Deserialize)]
struct UserRow {
    id: String,
    email: String,
    name: Option<String>,
    /// 迁移 0016 之前建的库里没有这一列；`#[serde(default)]` 让老库也能跑（全部当 `user`）。
    #[serde(default)]
    role: Option<String>,
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

const USERS_SQL: &str = "SELECT u.id, u.email, u.name, u.role, u.email_verified, u.created_at, u.updated_at, \
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
    let actor = authorize(&env, &headers, Role::Admin, false).await?;
    let db = db::get_db(&env)?;

    let rows: Vec<UserRow> = db
        .prepare(USERS_SQL)
        .all()
        .await
        .map_err(|_| AppError::Database)?
        .results()
        .map_err(|_| AppError::Database)?;

    let can_edit_roles = actor.role == Role::Owner;

    let users: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            let role = Role::parse(r.role.as_deref().unwrap_or("user"));
            json!({
                "id": r.id,
                "email": r.email,
                "name": r.name.unwrap_or_default(),
                "role": role.as_str(),
                // 前端据此把"改角色"下拉置灰：管理者能看列表，但不能改别人的角色。
                "role_editable": can_edit_roles,
                // 管理者不得操作所有者 —— 前端把这一行的动作按钮置灰，后端仍会再拦一次。
                "manageable": actor.role >= Role::Owner || role < Role::Owner,
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
    authorize(&env, &headers, Role::Admin, false).await?;
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
    let actor = authorize(&env, &headers, Role::Admin, true).await?;
    let db = db::get_db(&env)?;

    ensure_target_manageable(&db, &actor, &id).await?;

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
    let actor = authorize(&env, &headers, Role::Admin, true).await?;
    let db = db::get_db(&env)?;

    ensure_target_manageable(&db, &actor, &id).await?;

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
    let actor = authorize(&env, &headers, Role::Admin, true).await?;
    let db = db::get_db(&env)?;

    ensure_target_manageable(&db, &actor, &id).await?;

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
    let actor = authorize(&env, &headers, Role::Admin, true).await?;
    let db = db::get_db(&env)?;

    ensure_target_manageable(&db, &actor, &id).await?;

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
    let actor = authorize(&env, &headers, Role::Admin, true).await?;
    let db = db::get_db(&env)?;

    ensure_target_manageable(&db, &actor, &id).await?;

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

#[derive(Deserialize)]
struct RoleRow {
    email: String,
    /// 迁移 0016 之前建的库里没有这一列（`#[serde(default)]` ⇒ 当 `user`）。
    #[serde(default)]
    role: Option<String>,
}

/// POST /api/admin/users/{id}/role   body: `{"role": "user" | "admin" | "owner"}`
///
/// **仅所有者**可调用 —— 这是"所有者"与"管理者"唯一的、也是用户明确要的能力差异。
/// 令牌通道在 `resolve_actor` 里被映射成所有者，所以它同样能调：
/// 那正是"库里还没有 owner"时的引导通道（第一个所有者只能由令牌指定）。
///
/// 唯一的护栏是**不能降级最后一个所有者**。这不是权限检查，而是防自锁：
/// 所有者一旦归零，页面里就再没人能改角色，只能回去翻 `ADMIN_TOKEN`。
#[worker::send]
pub async fn set_role(
    State(env): State<Arc<Env>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    authorize(&env, &headers, Role::Owner, true).await?;
    let db = db::get_db(&env)?;

    let new_role = match body.get("role").and_then(|v| v.as_str()) {
        Some("user") => Role::User,
        Some("admin") => Role::Admin,
        Some("owner") => Role::Owner,
        _ => {
            return Err(AppError::api_json(
                StatusCode::BAD_REQUEST,
                json!({ "error": "bad_role", "message": "role 必须是 user / admin / owner" }),
            ))
        }
    };

    // 一次查询同时回答"目标存在吗"和"目标现在是什么角色"
    let row: Option<RoleRow> = db
        .prepare("SELECT email, role FROM users WHERE id = ?1")
        .bind(&[id.clone().into()])
        .map_err(|_| AppError::Database)?
        .first(None)
        .await
        .map_err(|_| AppError::Database)?;
    let Some(row) = row else {
        return Err(not_found());
    };
    let current = Role::parse(row.role.as_deref().unwrap_or("user"));

    if current == Role::Owner && new_role != Role::Owner {
        let others: Option<i64> = db
            .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND id != ?1")
            .bind(&[id.clone().into()])
            .map_err(|_| AppError::Database)?
            .first(Some("n"))
            .await
            .map_err(|_| AppError::Database)?;

        if others.unwrap_or(0) == 0 {
            return Err(AppError::api_json(
                StatusCode::BAD_REQUEST,
                json!({
                    "error": "last_owner",
                    "message": "不能降级最后一位所有者：否则将无人能再修改角色。请先把另一个账号设为所有者。"
                }),
            ));
        }
    }

    let now = now_string();
    d1_query!(
        &db,
        "UPDATE users SET role = ?1, updated_at = ?2 WHERE id = ?3",
        new_role.as_str(),
        now,
        id.clone()
    )
    .map_err(|_| AppError::Database)?
    .run()
    .await
    .map_err(|_| AppError::Database)?;

    Ok(Json(json!({
        "ok": true,
        "id": id,
        "role": new_role.as_str(),
        "message": format!("已将 {} 设为{}", row.email, new_role.label()),
    })))
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
