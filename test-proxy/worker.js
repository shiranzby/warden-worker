/**
 * shytest.cc.cd 的**测试用** Worker —— 做三件事，不碰生产数据。
 *
 *   ① 静态资源：直接发 `test-proxy/dist`（新版前端 + `admin/` 管理台页面），由 wrangler 的
 *      `[assets]` 绑定提供；
 *   ② **账号管理台**：`/api/admin/*` 走本文件里的 `handleAdmin()`，读写的是**独立的测试库**
 *      `vault1-admin-test`（见 `wrangler.test.toml` 的 D1 绑定）。🔴 这一条必须在反代判断**之前**
 *      拦截，否则 `/api/` 前缀会把管理台的请求一起代理到生产站（那边还没有这个路由，只会 404）。
 *   ③ 其余后端：把 `/api/*`、`/identity/*`、`/notifications/*` **反向代理**到线上
 *      `https://shypwd.cc.cd`。
 *
 * 为什么要反代而不是再部署一份后端：
 *   · 后端是 Rust→WASM，本地重建要装整套 cargo/wasm 工具链（几分钟起）；
 *   · 而这次要验收的**管理台**是新增能力，与既有后端逻辑无关；
 *   · 反代到线上同时意味着测试环境用的是**真实数据**（同一个 D1），能立刻看出问题。
 *
 * ⚠️ 这是**临时测试通道**，不是生产架构：生产是 `push-cloudflare.yaml` 按 artifact 名反查、
 *    把前端打进 `public/web-vault` 与 Worker 一起发布。这里只是为了"先看到新 UI"。
 * ⚠️ WebSocket（`/notifications/hub`）能不能透传取决于 Cloudflare 的边缘行为，
 *    最坏情况是实时同步不工作（页面仍可用），MVP 阶段可接受。
 *
 * === 管理台安全边界（改这个文件前先读这段）===
 * · 鉴权只有一条：请求头 `X-Admin-Token` 必须等于服务端 `ADMIN_TOKEN`（wrangler secret，
 *   不在仓库里）。比较用常数字节比较，避免时序侧信道。
 * · **写操作护栏**：`ADMIN_ENV` 不等于 `test` 时必须显式给 `ADMIN_ALLOW_PROD=yes` 才放行，
 *   防止这份"测试台"哪天被误配到生产库上。
 * · 这里**不可能**解密任何账号的条目明文 —— 库里的 name/username/password/totp 全是密文，
 *   解密的钥匙在该用户的主密码里。管理台能提供的只有**元数据**与**生命周期操作**。
 */

const UPSTREAM = "https://shypwd.cc.cd";
const PROXY_PREFIXES = ["/api/", "/identity/", "/notifications/"];
const ADMIN_PREFIX = "/api/admin";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ① 管理台 API —— 必须先于反代判断，否则会被代理到生产站
    if (url.pathname === ADMIN_PREFIX || url.pathname.startsWith(ADMIN_PREFIX + "/")) {
      return handleAdmin(request, env, url);
    }

    // ② 其余后端：反代到线上
    if (PROXY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      return proxyToUpstream(request);
    }

    // ③ 静态资源（含 /admin/ 的页面）
    return env.ASSETS.fetch(request);
  },
};

/* ============================ 反代 ============================ */

function proxyToUpstream(request) {
  const target = new URL(request.url);
  target.protocol = "https:";
  target.host = new URL(UPSTREAM).host;

  const headers = new Headers(request.headers);
  headers.set("Host", target.host);

  return fetch(
    new Request(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    }),
  );
}

/* ============================ 管理台 ============================ */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** 常数字节比较（长度不等直接 false；长度本身不是秘密） */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** D1 里的时间统一用这个格式（与 created_at 同形，字符串比较才有意义） */
function nowIso() {
  return new Date().toISOString();
}

function isWrite(method) {
  return method !== "GET" && method !== "HEAD";
}

async function handleAdmin(request, env, url) {
  /* ---- 0. 令牌 ---- */
  const expected = env.ADMIN_TOKEN;
  if (!expected) {
    return json({ error: "not_configured", message: "服务端未配置 ADMIN_TOKEN" }, 503);
  }
  const provided = request.headers.get("X-Admin-Token") || "";
  if (!safeEqual(provided, expected)) {
    // 故意不区分"为空/错误"，避免被探测
    return json({ error: "unauthorized", message: "管理令牌不正确" }, 401);
  }

  const db = env.DB;
  if (!db) {
    return json({ error: "no_db", message: "未绑定 D1（vault1-admin-test）" }, 503);
  }

  /* ---- 1. 写操作护栏：默认只能打测试库 ---- */
  const adminEnv = env.ADMIN_ENV || "test";
  const dbName = env.ADMIN_DB || "(unknown)";
  if (isWrite(request.method) && adminEnv !== "test" && env.ADMIN_ALLOW_PROD !== "yes") {
    return json(
      {
        error: "write_refused",
        message:
          "写操作被护栏拦下：ADMIN_ENV=" + adminEnv +
          "。这是保护措施，确认要动这个库再设 ADMIN_ALLOW_PROD=yes。",
      },
      403,
    );
  }

  const path = url.pathname.slice(ADMIN_PREFIX.length) || "/";

  try {
    /* ---- GET /session ---- */
    if (path === "/session" && request.method === "GET") {
      return json({ ok: true, env: adminEnv, db: dbName, now: nowIso() });
    }

    /* ---- GET /users ---- */
    if (path === "/users" && request.method === "GET") {
      const { results } = await db
        .prepare(
          "SELECT u.id, u.email, u.name, u.email_verified, u.created_at, u.updated_at, " +
          "       u.expires_at, u.disabled_at, " +
          "       (SELECT COUNT(*) FROM ciphers c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS items, " +
          "       (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS devices, " +
          "       (SELECT COUNT(*) FROM twofactor t WHERE t.user_uuid = u.id AND t.atype = 0 AND t.enabled = 1) AS totp " +
          "  FROM users u ORDER BY u.created_at DESC",
        )
        .all();

      const users = (results || []).map(function (r) {
        return {
          id: r.id,
          email: r.email,
          name: r.name || "",
          email_verified: !!r.email_verified,
          created_at: r.created_at,
          updated_at: r.updated_at,
          expires_at: r.expires_at || null,
          disabled_at: r.disabled_at || null,
          items: Number(r.items) || 0,
          devices: Number(r.devices) || 0,
          has_totp: Number(r.totp) > 0,
        };
      });
      return json({ ok: true, users: users });
    }

    /* ---- GET /stats ---- */
    if (path === "/stats" && request.method === "GET") {
      const now = nowIso();
      const soon = new Date(Date.now() + 7 * 86400000).toISOString();
      const { results } = await db
        .prepare(
          "SELECT " +
          "  (SELECT COUNT(*) FROM users) AS users, " +
          "  (SELECT COUNT(*) FROM ciphers WHERE deleted_at IS NULL) AS items, " +
          "  (SELECT COUNT(*) FROM twofactor WHERE atype = 0 AND enabled = 1) AS totp, " +
          "  (SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL) AS disabled, " +
          "  (SELECT COUNT(*) FROM users WHERE expires_at IS NOT NULL " +
          "     AND expires_at > ?1 AND expires_at <= ?2) AS expiring",
        )
        .bind(now, soon)
        .all();
      const r = (results && results[0]) || {};
      return json({
        ok: true,
        stats: {
          users: Number(r.users) || 0,
          items: Number(r.items) || 0,
          totp: Number(r.totp) || 0,
          disabled: Number(r.disabled) || 0,
          expiring: Number(r.expiring) || 0,
        },
      });
    }

    /* ---- /users/:id/{sign-out|reset-2fa|expire|disable} ---- */
    const m = path.match(/^\/users\/([^/]+)\/(sign-out|reset-2fa|expire|disable)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const op = m[2];
      const exists = await db.prepare("SELECT email FROM users WHERE id = ?1").bind(id).first();
      if (!exists) {
        return json({ error: "not_found", message: "账号不存在" }, 404);
      }
      const now = nowIso();

      if (op === "sign-out" && request.method === "POST") {
        await db.batch([
          db
            .prepare("UPDATE users SET security_stamp = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(crypto.randomUUID(), now, id),
          db.prepare("DELETE FROM devices WHERE user_id = ?1").bind(id),
        ]);
        return json({ ok: true, message: "已轮换安全戳并清空设备" });
      }

      if (op === "reset-2fa" && request.method === "POST") {
        // twofactor.atype: 0 = TOTP, 5 = Remember(设备信任), 8 = RecoveryCode
        await db.batch([
          db.prepare("DELETE FROM twofactor WHERE user_uuid = ?1 AND atype IN (0, 5, 8)").bind(id),
          db.prepare("UPDATE users SET totp_recover = NULL, updated_at = ?1 WHERE id = ?2").bind(now, id),
        ]);
        return json({ ok: true, message: "已清除该账号的两步验证" });
      }

      if (op === "expire" && request.method === "POST") {
        const body = await readJson(request);
        const days = body ? body.days : undefined;
        let value = null;
        if (days !== null && days !== undefined && days !== "") {
          const n = Number(days);
          if (!Number.isFinite(n) || n < 1 || n > 3650) {
            return json({ error: "bad_days", message: "days 需在 1–3650 之间，或传 null 取消" }, 400);
          }
          value = new Date(Date.now() + n * 86400000).toISOString();
        }
        await db
          .prepare("UPDATE users SET expires_at = ?1, updated_at = ?2 WHERE id = ?3")
          .bind(value, now, id)
          .run();
        return json({ ok: true, expires_at: value, message: value ? "已设置到期" : "已取消到期" });
      }

      if (op === "disable" && request.method === "POST") {
        const body = await readJson(request);
        const disabled = !!(body && body.disabled);
        // 🔴 与生产端(src/handlers/admin.rs::disable)**逐条对齐**：
        //    停用时除了写 disabled_at，还要轮换 security_stamp + 清设备记录。
        //    因为 `decode_access_token` 每次都会拿库里的 stamp 与 JWT 里的比对、
        //    并要求 devices 里有对应行 ⇒ 轮换后该账号**已登录的所有设备立刻失效**。
        //    只写 disabled_at 的话"停用"只是个 UI 标签，旧 JWT 照用不误。
        //    （测试通道若不带这一步，"测试通过"就证明不了生产的行为。）
        const stmts = [
          db
            .prepare("UPDATE users SET disabled_at = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(disabled ? now : null, now, id),
        ];
        if (disabled) {
          stmts.push(
            db
              .prepare("UPDATE users SET security_stamp = ?1 WHERE id = ?2")
              .bind(crypto.randomUUID(), id),
          );
          stmts.push(db.prepare("DELETE FROM devices WHERE user_id = ?1").bind(id));
        }
        await db.batch(stmts);
        return json({ ok: true, disabled: disabled, message: disabled ? "已停用" : "已启用" });
      }

      return json({ error: "method_not_allowed", message: "方法不允许" }, 405);
    }

    /* ---- DELETE /users/:id ---- */
    const dm = path.match(/^\/users\/([^/]+)$/);
    if (dm && request.method === "DELETE") {
      const id = decodeURIComponent(dm[1]);
      const row = await db.prepare("SELECT email FROM users WHERE id = ?1").bind(id).first();
      if (!row) {
        return json({ error: "not_found", message: "账号不存在" }, 404);
      }
      // 显式清子表（不依赖 PRAGMA foreign_keys 是否开着）
      await db.batch([
        db.prepare("DELETE FROM attachments WHERE cipher_id IN (SELECT id FROM ciphers WHERE user_id = ?1)").bind(id),
        db.prepare("DELETE FROM ciphers WHERE user_id = ?1").bind(id),
        db.prepare("DELETE FROM folders WHERE user_id = ?1").bind(id),
        db.prepare("DELETE FROM devices WHERE user_id = ?1").bind(id),
        db.prepare("DELETE FROM twofactor WHERE user_uuid = ?1").bind(id),
        db.prepare("DELETE FROM sends WHERE user_id = ?1").bind(id),
        db.prepare("DELETE FROM auth_requests WHERE user_id = ?1").bind(id),
        db.prepare("DELETE FROM users WHERE id = ?1").bind(id),
      ]);
      return json({ ok: true, message: "账号已删除" });
    }

    return json({ error: "not_found", message: "未知的管理接口: " + path }, 404);
  } catch (e) {
    return json({ error: "internal", message: String((e && e.message) || e) }, 500);
  }
}

async function readJson(request) {
  try {
    const txt = await request.text();
    return txt ? JSON.parse(txt) : null;
  } catch (e) {
    return null;
  }
}
