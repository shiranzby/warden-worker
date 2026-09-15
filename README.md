# Warden: A Bitwarden-compatible server for Cloudflare Workers

[![Powered by Cloudflare](https://img.shields.io/badge/Powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://www.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-orange?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

This project provides a self-hosted, Bitwarden-compatible server that can be deployed to Cloudflare Workers for free. It's designed to be low-maintenance, allowing you to "deploy and forget" without worrying about server management or recurring costs.

---

## 🇨🇳 本 Fork 是什么（先读这段）

> 下面是**上游 warden** 的英文 README（保留原样）。本 Fork 在它之上做了两件事，中文说明集中在这里与
> **[`docs/交付文档.md`](docs/交付文档.md)**（接手/迁移/开源/跟进上游，看这一篇就够了）。

这是上游 [`qaz741wsd856/warden-worker`](https://github.com/qaz741wsd856/warden-worker) 的一个 Fork，
现部署于 `https://shypwd.cc.cd`。与上游的差异：

| | 上游 | 本 Fork |
|---|---|---|
| 前端来源 | 直接下载 Vaultwarden 的 `bw_web_builds` 预编译包 | **从我们自己维护的源码 fork 构建**：[`shiranzby/vw_web_builds`](https://github.com/shiranzby/vw_web_builds) 分支 `shypwd` |
| 前端定制方式 | 部署后往 `public/css/` 覆盖一个 CSS | **直接写在前端源码里**，随构建产物一起出 |
| 运行时注入层 `custom/custom.js` | 有（这是上游那套） | **已删除**，`/custom.js`、`/custom.css` 固定 404 |
| 移动端适配 | 无 | **19 批**针对手机浏览器的改造（底栏导航、输入框高度、下拉躲软键盘、深色主题等） |
| 构建期保护 | 无 | **27 组产物断言**：每批定制都在 CI 里对真实产物 grep 校验，rebase 丢改动会立刻红 |
| 前端版本 | 跟随上游 `v2026.6.4` | **v2026.8.9**（`/vw-version.json` 可查） |

### 分层（L1 / L2 / L3）

```
L3 前端 Web Vault   源我们在 fork 里改（GPL-3.0）→ 构建产物 bw_web_vault-<ver>.tar.gz
                        ↓ 作为静态资源随 Worker 一起发布（public/web-vault/）
L1 后端 Worker      Rust → WASM（MIT，上游 warden © 2025 Deep Gaurav）
                        ↓
L2 数据             Cloudflare D1（主数据）+ KV/R2（附件）+ Durable Objects（推送）+ 限流
```

**L4（运行时注入层）已退役** —— 这是本项目一个明确的设计选择：
运行时补丁依赖"上游产物的 DOM 不变"，一改就静默失效且无法被构建期检查保护；
下沉到源码后，每批定制都能在 CI 里被 grep 到。代价是要跟着上游 rebase，
流程见 [`docs/交付文档.md` §7](docs/交付文档.md#7-上游跟进与长期维护)。

### 一分钟部署到你自己的 Cloudflare

**你不需要 fork 那个 1.2 GB 的前端仓库** —— 构建 workflow 里的 `VAULT_REPO` 指向我们公开的
`shiranzby/vw_web_builds`，任何人 fork 本仓库都能构建出同样的定制前端。

1. **Fork 本仓库**，然后在 Cloudflare 建好 **D1**（建议名 `vault1`）和 **KV**（附件用），
   在仓库 *Settings → Secrets* 里加：
   `CLOUDFLARE_EMAIL`、`CLOUDFLARE_API_KEY`、`CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID`、
   `ALLOWED_EMAILS`、`JWT_SECRET`、`JWT_REFRESH_SECRET`（可选 `R2_NAME`）。
2. **跑一次构建**：Actions → `Build Web Vault (patched)` → *Run workflow* → `version` 填 `v2026.8.9`。
3. **跑一次部署**：Actions → `Build` → *Run workflow*。
4. 绑自定义域：DNS 加 `A → 192.0.2.1`（开橙色云）+ Workers Routes `<你的域名>/*`。

自检：`https://<你的域名>/vw-version.json` 应返回 `{"version":"2026.8.9"}`，
且 `/custom.js` 与 `/custom.css` 都是 **404**。

> 更细的步骤（迁移数据、回滚、开源合规、上游跟进）见
> **[`docs/交付文档.md`](docs/交付文档.md)**。

> 🤖 **想让 AI 帮你部署？**
> 把本仓库连同 **[`AI_Skill.md`](AI_Skill.md)** 一起交给 AI（Codex / Claude / Cursor / 任意 Agent），
> 它会自动向你索取 Account ID、API Key、D1/KV ID 等信息，然后自己建资源、设 Secrets、
> 跑构建与部署并验证。**你不需要自己敲任何命令。**

### 许可证（两部分，别混淆）

- **后端（本仓库，`src/`、`migrations/` 等）：MIT** —— 见 `LICENSE`，© 2025 Deep Gaurav。
- **前端（构建产物，来自 Bitwarden clients）：GPL-3.0** —— 见 `.vwsrc/LICENSE_GPL.txt`、
  `.vwsrc/LICENSE_BITWARDEN.txt`。
- 「Bitwarden」是注册商标。本项目只是**协议兼容**，不是官方项目，也不得用其商标/Logo 对外宣称。

---

## Why another Bitwarden server?

While projects like [Vaultwarden](https://github.com/dani-garcia/vaultwarden) provide excellent self-hosted solutions, they still require you to manage a server or VPS. This can be a hassle, and if you forget to pay for your server, you could lose access to your passwords.

Warden aims to solve this problem by leveraging the Cloudflare Workers ecosystem. By deploying Warden to a Cloudflare Worker and using Cloudflare D1 for storage, you can have a completely free, serverless, and low-maintenance Bitwarden server.

## Features

* **Core Vault Functionality:** Create, read, update, and delete ciphers and folders.
* **File Attachments:** Optional Cloudflare KV or R2 storage for attachments.
* **Bitwarden Send:** Share encrypted text or files via a link.
* **Device Management:** View and revoke active sessions.
* **Live Sync & Push Notifications:** Real-time vault updates via WebSocket and mobile push.
* **TOTP Support:** Store and generate Time-based One-Time Passwords.
* **Bitwarden Compatible:** Works with official Bitwarden clients.
* **Free to Host:** Runs on Cloudflare's free tier.
* **Low Maintenance:** Deploy it once and forget about it.
* **Secure:** Your encrypted data lives in your Cloudflare D1 database.
* **Easy to Deploy:** Get up and running in minutes with the Wrangler CLI.

### Attachments Support

Warden supports file attachments using either **Cloudflare KV** or **Cloudflare R2** as the storage backend:

| Feature | KV | R2 |
|---------|----|----|  
| Max file size | **25 MB** (hard limit) | 100 MB (By request body size limit of Workers) |
| Credit card required | **No** | Yes |
| Streaming I/O | Yes | Yes |

**Backend selection:** R2 takes priority — if R2 is configured, it will be used. Otherwise, KV is used.

See the [deployment guide](docs/deployment.md) for setup details. R2 may incur additional costs; see [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/).

### Bitwarden Send

- **Text Send:** Enabled by default, no extra configuration required.
- **File Send:** Requires a storage backend (KV or R2), same as [attachments](#attachments-support).

> [!NOTE]
> Due to the D1 single-row size limit of 2 MB, the maximum text Send size is approximately **1.8 MiB**. Additionally, the `/api/sync` endpoint serializes all of the current user's Sends into the response. A large number of Sends or very large text Sends will significantly increase CPU time and response size.


## Current Status

**This project is not yet feature-complete**, ~~and it may never be~~. It currently supports the core functionality of a personal vault, including TOTP. However, it does **not** support the following features:

* Sharing
* 2FA login (except TOTP)
* Emergency access
* Admin operations
* Organizations
* Other Bitwarden advanced features

There are no immediate plans to implement these features. The primary goal of this project is to provide a simple, free, and low-maintenance personal password manager.

## Compatibility

* **Browser Extensions:** Chrome, Firefox, Safari, etc. (Tested 2026.3.0 on Chrome)
* **Android App:** The official Bitwarden Android app. (Tested 2026.4.0)
* **iOS App:** The official Bitwarden iOS app. (Tested 2026.4.0)

## Demo

A demo instance is available at [warden.qqnt.de](https://warden.qqnt.de).

You can register a new account using an email ending with `@warden-worker.demo` (The email does not need verification).

If you decide to stop using the demo instance, please delete your account to make space for others.

It's highly recommended to deploy your own instance since the demo can hit the rate limit and be disabled by Cloudflare.

## Getting Started

- Choose a deployment path: [CLI Deployment](docs/deployment.md#cli-deployment) or [Github Actions Deployment](docs/deployment.md#cicd-deployment-with-github-actions).
- Set secrets and optional attachments per the deployment doc.
- Configure Bitwarden clients to point at your worker URL.

## Frontend (Web Vault)

<!-- ⚠️ 本节已被本 Fork 改写：上游原文说"下载 Vaultwarden 的 bw_web_builds 预编译包"，
     本 Fork 改为**从自己的源码 fork 构建**，且不再有 public/css 覆盖那一步。 -->

The frontend is bundled with the Worker using [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).

**本 Fork 与上游不同**：前端不是下载上游预编译包，而是从我们维护的源码 fork
[`shiranzby/vw_web_builds`](https://github.com/shiranzby/vw_web_builds)（分支 `shypwd`）构建出来的 ——
所有定制都**直接写在前端源码里**，随构建产物一起发布，不再有"部署后覆盖 CSS"这一层。

由 `build-web-vault.yaml`（手动触发，输入 `version`）完成：
拉源码 → `npm ci` → `dist:oss:selfhost` → 打 `bw_web_vault-<version>.tar.gz`
→ **27 组产物断言** → 上传为 Actions artifact（保留 90 天）。
随后 `push-cloudflare.yaml` 按 artifact 名反查、解压到 `public/web-vault/` 并部署。

**How it works:**
- Static files (HTML, CSS, JS) are served directly by Cloudflare's edge network.
- API requests (`/api/*`, `/identity/*`) are routed to the Rust Worker.
- No separate Pages deployment or domain configuration needed.

**Version pinning（版本号四处，必须同步）：**

| # | 位置 | 当前值 |
|---|---|---|
| 1 | fork `apps/web/package.json` 的 `version` | `2026.8.9` |
| 2 | fork `package-lock.json` 的 `packages["apps/web"].version` | `2026.8.9` |
| 3 | `build-web-vault.yaml` 的 `inputs.version` 默认值 | `v2026.8.9` |
| 4 | `push-cloudflare.yaml` 的 `BW_WEB_VERSION` 默认值 | `v2026.8.9` |

改版本只升 **patch 位**，让 `/vw-version.json` 自己成为"是否上线成功"的判据。
⚠️ **改 workflow 的那次 push 必须带 `[skip ci]`**，否则会自动触发一次找不到新 artifact 的部署。

> [!NOTE]
> Migrating from separate frontend deployment? If you previously deployed the frontend separately to Cloudflare Pages, you can delete the `warden-frontend` Pages project and re-setup the router for the worker. The frontend is now bundled with the Worker and no longer requires a separate deployment.

> [!WARNING]
> The web vault frontend comes from Vaultwarden and therefore exposes many advanced UI features, but most of them are non-functional. See [Current Status](#current-status).

## Configure Custom Domain (Optional)

The default `*.workers.dev` domain is disabled by default, since it may throw 1101 error. You can enable it by setting `workers_dev = true` in `wrangler.toml`.

If you want to use a custom domain instead of the default `*.workers.dev` domain, follow these steps:

### Step 1: Add DNS Record

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your domain (e.g., `example.com`)
3. Go to **DNS** → **Records**
4. Click **Add record**:
   - **Type:** `A` (or `AAAA` for IPv6)
   - **Name:** your subdomain (e.g., `vault` for `vault.example.com`)
   - **IPv4 address:** `192.0.2.1` (this is a placeholder, the actual routing is handled by Worker)
   - **Proxy status:** **Proxied** (orange cloud icon - this is required!)
   - **TTL:** Auto
5. Click **Save**

> [!IMPORTANT]
> The **Proxy status must be "Proxied"** (orange cloud). If it shows "DNS only" (gray cloud), Worker routes will not work.

### Step 2: Add Worker Route

1. Go to **Workers & Pages** → Select your `warden-worker`
2. Click **Settings** → **Domains & Routes**
3. Click **Add** → **Route**
4. Configure the route:
   - **Route:** `vault.example.com/*` (replace with your domain)
   - **Zone:** Select your domain zone
   - **Worker:** `warden-worker`
5. Click **Add route**

## Built-in Rate Limiting

This project includes rate limiting powered by [Cloudflare's Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Sensitive endpoints are protected:

| Endpoint | Rate Limit | Key Type | Purpose |
|----------|------------|----------|---------|
| `/identity/connect/token` (password grant) | 5 req/min per email + 5 req/min per IP | Email + IP address | Prevent password brute force and credential stuffing |
| `/identity/connect/token` (send access) | 15 req/min | IP address | Prevent Send password brute force |
| `/api/sends/access/*` (password protected) | 10 req/min | IP address | Prevent Send password brute force |
| `/api/accounts/register` | 5 req/min | IP address | Prevent mass registration & email enumeration |
| `/api/accounts/prelogin` | 5 req/min | IP address | Prevent email enumeration |

You can adjust the rate limit settings in `wrangler.toml`:

```toml
[[ratelimits]]
name = "LOGIN_RATE_LIMITER"
namespace_id = "1001"
# Adjust limit (requests) and period (10 or 60 seconds)
simple = { limit = 5, period = 60 }

[[ratelimits]]
name = "SEND_ACCESS_RATE_LIMITER"
namespace_id = "1003"
# Public Send password checks use a slightly wider IP limit.
simple = { limit = 10, period = 60 }
```

> [!NOTE]
> The `period` must be either `10` or `60` seconds. See [Cloudflare documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) for details.

If the binding is missing, requests proceed without rate limiting (graceful degradation).

## Configuration

### CPU offloading (via Durable Objects)

Cloudflare Workers Free plan has a very small per-request CPU budget. Two kinds of endpoints are particularly CPU-heavy:

- import endpoint: large JSON payload (typically 500kB–1MB) + parsing + batch inserts.
- registration, login and password verification endpoint: server-side PBKDF2 for password verification.

To keep the main Worker fast while still supporting these operations, Warden can **offload selected endpoints to Durable Objects (DO)**:

- **Heavy DO (`HEAVY_DO`)**: implemented in Rust as `HeavyDo` (reuses the existing axum router) so CPU-heavy endpoints can run with a higher CPU budget.

**How to enable/disable**

Whether CPU-heavy endpoints are offloaded is determined by whether the `HEAVY_DO` Durable Object binding is configured in `wrangler.toml`.

> [!NOTE]
> Durable Objects have much higher CPU budget of 30 seconds per request in free plan(see [Cloudflare Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)), so we can use it to offload the CPU-heavy endpoints.
>
> Durable Objects can incur two types of billing: compute and storage. Storage is not used in this project, and the free plan allows 100,000 requests and 13,000 GB-s duration per day, which should be more than enough for most users. See [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) for details.
>
> If you choose to disable Durable Objects, you may need subscribe to a paid plan to avoid being throttled by Cloudflare.

### Live Sync and Push Notifications

Warden supports live sync for vault data via two mechanisms: WebSocket push (for desktop apps and browser extensions) and Mobile push notifications (for official mobile apps).

**WebSocket Push (Desktop & Extensions)**

This feature is powered by Durable Objects and enabled by default when the `NOTIFY_DO` Durable Object binding is configured in `wrangler.toml`. Removing this binding (and migration) will gracefully disable WebSocket notifications.

**Mobile Push Notifications**

Warden supports push notifications to official Bitwarden mobile apps via the Bitwarden push relay service.

**Setup:**

1. Obtain an installation ID and key from [https://bitwarden.com/host/](https://bitwarden.com/host/).
2. Store the credentials as secrets (`PUSH_INSTALLATION_ID` & `PUSH_INSTALLATION_KEY`) via the Cloudflare dashboard or `wrangler` cli.
3. Enable push by setting `PUSH_ENABLED` to `true` in `wrangler.toml` `[vars]` or via the Cloudflare dashboard.

Optionally, you can override the default relay endpoints by setting `PUSH_RELAY_URI` and `PUSH_IDENTITY_URI` (defaults to `https://push.bitwarden.com` and `https://identity.bitwarden.com`).

For detailed configuration and troubleshooting, see the [Vaultwarden wiki on push notifications](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-Mobile-Client-push-notification).

### Other Environment Variables

Configure environment variables in `wrangler.toml` under `[vars]`, or set them via Cloudflare Dashboard:

* **`BASE_URL`** (Optional):
  - Overrides the extracted base URL for up/down URLs for files.
  - Format: Include HTTPS protocol, domain, and port (if using non-443 reverse proxy). Do not include any trailing path.
  - Example: `https://vault.example.com` or `https://vault.example.com:8443`
  - If not set, falls back to extracting from the incoming request.
* **`PASSWORD_ITERATIONS`** (Optional, Default: `600000`):
  - PBKDF2 iterations for server-side password hashing.
  - Minimum is 600000.
* **`TRASH_AUTO_DELETE_DAYS`** (Optional, Default: `30`): 
  - Days to keep soft-deleted items before purge. 
  - Set to `0` or negative to disable.
* **`IMPORT_BATCH_SIZE`** (Optional, Default: `30`): 
  - Batch size for import/delete operations. 
  - `0` disables batching.
* **`DISABLE_USER_REGISTRATION`** (Optional, Default: `true`): 
  - Controls showing the registration button in the client UI (server behavior unchanged).
* **`AUTHENTICATOR_DISABLE_TIME_DRIFT`** (Optional, Default: `false`): 
  - Set to `true` to disable ±1 time step drift for TOTP validation.
* **`ATTACHMENT_MAX_BYTES`** (Optional): 
  - Max size for individual attachment files. 
  - Example: `104857600` for 100MB.
* **`ATTACHMENT_TOTAL_LIMIT_KB`** (Optional): 
  - Max total attachment storage per user in KB. 
  - Example: `1048576` for 1GB.
* **`ATTACHMENT_TTL_SECS`** (Optional, Default: `300`, Minimum: `60`): 
  - TTL for attachment upload/download URLs.
* **`SEND_TEXT_MAX_BYTES`** (Optional, Default: `1887436` ≈ 1.8 MiB):
  - Max size for text Send content. Constrained by D1's 2 MB single-row limit.
* **`SEND_MAX_BYTES`** (Optional, Default: `104857600` = 100 MiB):
  - Max file size for file Sends. Subject to the same KV/R2 limits as attachments.
* **`USER_SEND_LIMIT_KB`** (Optional):
  - Max total Send file storage per user in KB.
* **`SEND_TTL_SECS`** (Optional, Default: `300`):
  - TTL for Send file upload/download URLs.

### Scheduled Tasks (Cron)

The worker runs a scheduled task to clean up soft-deleted items. By default, it runs daily at 03:00 UTC (`wrangler.toml` `[triggers]` cron `"0 3 * * *"`). Adjust as needed; see [Cloudflare Cron Triggers documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/) for cron expression syntax.

## Database Operations

- **Backup & restore:** See [Database Backup & Restore](docs/db-backup-recovery.md#github-actions-backups) for automated backups and manual restoration steps.
- **Time Travel:** See [D1 Time Travel](docs/db-backup-recovery.md#d1-time-travel-point-in-time-recovery) to restore to a point in time.
- **Seeding Global Equivalent Domains (optional):** See [docs/deployment.md](docs/deployment.md) for seeding in CLI deploy and CI/CD.
- **Local dev with D1:**
  - Quick start: `wrangler dev --persist`
  - Full stack (with web vault): download frontend assets as in deployment doc, then `wrangler dev --persist`
  - Import a backup locally: `wrangler d1 execute vault1 --file=backup.sql`
  - Inspect local DB: SQLite file under `.wrangler/state/v3/d1/`

## Local Development with D1

Run the Worker locally with D1 support using Wrangler.

**Quick start (API-only):**

```bash
wrangler dev --persist
```

**Full stack (with Web Vault):**

1. Download the frontend assets (see [deployment doc](docs/deployment.md#download-the-frontend-web-vault)).
2. Start locally:

   ```bash
   wrangler dev --persist
   ```

3. Access the vault at `http://localhost:8787`.

**Using production data temporarily:**

1. Download and decrypt a backup (see [backup doc](docs/db-backup-recovery.md#restoring-database-to-cloudflare-d1)).
2. Import locally without `--remote`:

   ```bash
   wrangler d1 execute vault1 --file=backup.sql
   ```

3. Start `wrangler dev --persist` and point clients to `http://localhost:8787`.

**Inspect local SQLite:**

```bash
ls .wrangler/state/v3/d1/
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite
```

> [!NOTE]
> Local dev requires Node.js and Wrangler. The Worker runs in a simulated environment via [workerd](https://github.com/cloudflare/workerd).

## Updating Your Fork

If you deployed via a GitHub fork, keeping up to date is straightforward:

1. **Watch for new releases** — On [this repository](https://github.com/qaz741wsd856/warden-worker), click **Watch** → **Custom** → check **Releases**. You'll be notified when a new version is published.
2. **Sync your fork** — Go to your fork on GitHub, click **Sync fork** → **Update branch**. This pulls the latest changes from upstream into your fork's default branch.
3. **Automatic deployment** — If you set up CI/CD via GitHub Actions, the push-to-main workflow will automatically build and deploy the new version to your Cloudflare Worker. No manual steps needed.

> [!TIP]
> It is recommended to sync your fork when a new release is published in the upstream, so you always have the latest features and security fixes.

### 本 Fork：跟进上游要分两条线

上游同步只能照顾到**后端**。前端的定制在另一个仓库，**必须单独 rebase**，
否则下一次构建就会把上游的新代码和我们旧的定制掺在一起：

| 线 | 上游 | 频率 | 做法 |
|---|---|---|---|
| 后端 | `qaz741wsd856/warden-worker` | 低 | 就是上面的 Sync fork；留意 `migrations/` 与 `wrangler.toml` 有没有新增绑定 |
| 前端 | `bitwarden/clients`（经 `vaultwarden/vw_web_builds` 看 tag） | 每月发版 | 在 `vw_web_builds` 里 `git rebase --onto <新tag> <旧tag> shypwd`；冲突热点：`vaultwarden.css`、`libs/components/src/{select,disclosure,toggle-group}`、`libs/tools/send/**`、i18n `messages.json` |

rebase 完改"版本号四处"，跑一次构建 —— **CI 的 27 组断言会告诉你哪一批定制丢了**
（每组对应一批，红了就对着那一批修）。静态断言只能证明"字面量还在"，
行为对不对要再跑一次运行期探针。

完整流程（含冲突热点、回滚、节奏建议）见
[`docs/交付文档.md` §7](docs/交付文档.md#7-上游跟进与长期维护)。

### 验证工具箱（改动后建议都跑一遍）

```bash
# ① 产物断言：把 CI 那 27 组脚本抽出来，在你刚构建的产物上实跑
python .deploycheck/run-artifact-asserts.py ../vw_web_builds/apps/web/build 2026.8.9

# ② 守卫离线证伪：新增/修改了某批"只在窄屏生效"的守卫后必跑
python .deploycheck/probe-s15-guard.py

# ③ 窄屏运行期验收（本地 8099；带 WARDEN_TEST_PROXY 则走线上）
node .deploycheck/probe-w19-verify.mjs
WARDEN_TEST_BASE=https://<你的域名> WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
  node .deploycheck/probe-w19-verify.mjs
```

> ⚠️ `.deploycheck/` 默认整体 gitignore，只有逐个加白名单的脚本才入库
> （目录里还有带测试账号明文的文件，**绝不能按扩展名批量放行**）。

## Contributing

Issues and PRs are welcome. Please run `cargo fmt` and `cargo clippy --target wasm32-unknown-unknown --no-deps` before submitting.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
