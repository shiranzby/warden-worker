# Warden

<p align="center">
  <strong>跑在 Cloudflare Workers 上的 Bitwarden 兼容密码库，附带深度适配手机的 Web Vault</strong>
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Cloudflare%20Workers-f59e0b?logo=cloudflare&logoColor=white">
  <img alt="Backend" src="https://img.shields.io/badge/backend-Rust%20%2B%20D1-dea584?logo=rust&logoColor=white">
  <img alt="Web Vault" src="https://img.shields.io/badge/web%20vault-v2026.8.9-2563eb">
  <img alt="License" src="https://img.shields.io/badge/license-MIT%20%2B%20GPL--3.0-22c55e">
  <img alt="Batches" src="https://img.shields.io/badge/customizations-19%20batches-2563eb">
</p>

Warden 是一个自托管的 Bitwarden 协议兼容服务端：后端是编译成 WASM 的 Rust Worker，数据落在 Cloudflare D1，
前端是**我们自己改过源码的** Bitwarden Web Vault。官方 Bitwarden 的手机 App、浏览器扩展与网页端都能直接连。

> ⚠️ 本项目与 Bitwarden Inc. 没有任何关联。「Bitwarden」是其注册商标，本项目仅表示**协议兼容**。
> 🧪 当前面向个人/小团队自用场景，请自行评估后再存放生产数据。

🌐 **简体中文（默认）** ｜ [English](#english)

---

## 目录

- [为什么做 Warden](#为什么做-warden)
- [功能特性](#功能特性)
- [架构](#架构)
- [快速开始](#快速开始)
- [部署配置](#部署配置)
- [Web Vault 前端定制](#web-vault-前端定制)
- [数据与安全](#数据与安全)
- [跟进上游](#跟进上游)
- [验证](#验证)
- [当前限制](#当前限制)
- [路线图](#路线图)
- [贡献](#贡献)
- [许可证](#许可证)
- [致谢](#致谢)

---

## 为什么做 Warden

Vaultwarden 已经很优秀，但它仍然需要一台服务器或 VPS —— 要维护，要续费，忘了续费就可能失去访问权。

Warden 把这件事搬到 Cloudflare 的无服务器栈上：**Workers 跑后端，D1 存数据，Workers 静态资源托管前端**。
部署一次之后基本不用管，也不再有"服务器到期"这件事。

本 Fork 在原生 Warden 之上又多做了一件事：**官方 Web Vault 在手机上很难用**，
所以我们把前端定制**直接写进前端源码**，做了 19 批针对手机浏览器的改造
（底部导航栏、输入框高度统一、下拉躲软键盘、应用内深色主题等）。

---

## 功能特性

### 服务端

- 完整的密码库能力：条目、文件夹、收藏、回收站的增删改查
- Bitwarden Send：通过链接分享加密文本或文件
- TOTP：存储并生成动态验证码
- 附件：可选 Cloudflare KV 或 R2 存储
- 设备管理：查看并吊销活动会话
- 实时同步与推送通知（WebSocket + 移动端 Push）
- 内置限流：登录 5 次/60 秒，Send 访问 15 次/60 秒
- 与官方 Bitwarden 客户端兼容（手机 App / 浏览器扩展 / 网页端）

### 前端（本 Fork 的定制）

- **底部导航栏**：手机上单手可达的页面切换
- **输入框高度统一**：所有单行输入框统一 38px，可见框统一 40px，内容垂直居中
- **下拉面板**：贴着输入框展开、躲开软键盘、松手才展开（不再一碰就弹）
- **发送页重排**：去掉冗余页头、附加选项可折叠、保存/取消落进页面且均分一行
- **应用内深色主题**：底栏、账户卡片、验证码页、TOTP 徽章全部跟随应用设置
- 窄屏列表列对齐、搜索栏常驻、二级导航 chips 等一批细节

---

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│ L3 · 前端 Web Vault                                           │
│   Bitwarden 官方 Angular 应用（GPL-3.0）                       │
│   源码 fork：shiranzby/vw_web_builds @ shypwd                  │
│   定制**写在源码里**，不是运行时打补丁                          │
│   产物：bw_web_vault-<version>.tar.gz（约 36 MB）              │
└───────────────────────────┬──────────────────────────────────┘
                            │ 解压到 public/web-vault/，随 Worker 一起发布
┌───────────────────────────▼──────────────────────────────────┐
│ L1 · 后端 Worker                                              │
│   Rust → WASM（worker-build），入口 src/entry.js（MIT）         │
│   承担 /api/* 、/identity/* 、/notifications/*                 │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ L2 · 数据层（全部 Cloudflare 托管）                             │
│   D1 (SQLite)      主数据：用户 / 条目 / 组织 / Send / 2FA      │
│   KV 或 R2         附件                                        │
│   Durable Objects  推送通知与 CPU 卸载                          │
│   Rate Limiters    登录与 Send 访问限流                         │
└──────────────────────────────────────────────────────────────┘
```

**L4（运行时注入层）已退役**：早期版本会在部署后往页面注入 `custom/custom.js` + `custom.css`。
它依赖"上游产物的 DOM 不变"，上游一改就静默失效，也无法被构建期检查保护。
现在所有定制下沉到源码，构建时就有 **27 组产物断言**守着；线上 `/custom.js`、`/custom.css` 固定返回 404，
这个 404 本身就是"注入层确已退役"的判据。

---

## 快速开始

### 方式一：让 AI 帮你部署（最省事）

把本仓库连同 **[`AI_Skill.md`](AI_Skill.md)** 一起交给任意 AI 编程助手（Codex / Claude / Cursor 等），
它会自己向你索取 Cloudflare 邮箱、Global API Key、Account ID、GitHub PAT 等信息，
然后建资源、设 Secrets、跑构建与部署并验证。**你不需要敲任何命令。**

### 方式二：Fork + 两条 Workflow（推荐）

好消息：**你不需要 fork 那个 1.2 GB 的前端仓库**。
构建 workflow 里的 `VAULT_REPO` 指向我们公开的 `shiranzby/vw_web_builds`，
任何人 fork 本仓库都能构建出完全一样的定制前端。

1. **Fork 本仓库**，在 Cloudflare 建好 **D1** 与 **KV**（名字建议 `vault1` / `warden-attachments`）。
2. 在仓库 **Settings → Secrets and variables → Actions → Secrets** 里添加：

   | Secret | 必填 | 说明 |
   |---|:--:|---|
   | `CLOUDFLARE_EMAIL` | ✅ | Cloudflare 登录邮箱 |
   | `CLOUDFLARE_API_KEY` | ✅ | Global API Key（不是 Bearer Token） |
   | `CLOUDFLARE_ACCOUNT_ID` | ✅ | Account ID |
   | `D1_DATABASE_ID` | ✅ | D1 数据库 ID |
   | `ALLOWED_EMAILS` | ✅ | 允许注册的邮箱（逗号分隔；留空 = 不限制） |
   | `JWT_SECRET` | ✅ | 访问令牌密钥（随机长串） |
   | `JWT_REFRESH_SECRET` | ✅ | 刷新令牌密钥（随机长串） |
   | `R2_NAME` | ➖ | 用 R2 存附件时才需要 |

3. **跑一次构建**：Actions → `Build Web Vault (patched)` → *Run workflow* → `version` 填 `v2026.8.9`（约 5 分钟）。
4. **跑一次部署**：Actions → `Build` → *Run workflow*（约 4~5 分钟）。
5. 打开你的域名，注册账号即可使用。

> ⚠️ 顺序不能反：部署侧是按 **artifact 名 `bw_web_vault-<version>` 反查**最新构建的，先 build 才有东西可查。

### 方式三：Wrangler CLI

```bash
npm i -g wrangler && wrangler login

# 前端产物：从 Actions 的 bw_web_vault-v2026.8.9 artifact 下载后解压
tar -xzf bw_web_vault.tar.gz && mv web-vault public/web-vault

wrangler d1 migrations apply vault1 --remote
wrangler deploy
```

---

## 部署配置

### 自定义域名

Cloudflare 控制台里两步：

1. **DNS**：添加 `A` 记录指向 `192.0.2.1`（假源站，实际由 Worker 接管），开启代理（橙色云）。
2. **Workers 路由**：`<你的域名>/*` → Worker `warden-worker`。

不用自定义域的话，在 `wrangler.toml` 里把 `workers_dev = true` 打开（默认关闭，因为 `*.workers.dev` 容易出 1101）。

### 常用变量

`wrangler.toml` 的 `[vars]` 是配置来源，常用的有：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DISABLE_USER_REGISTRATION` | `"false"` | 设为 `"true"` 隐藏注册入口 |
| `BASE_URL` | 自动推断 | 生成文件上下链时用的站点地址 |

其余绑定（D1 / KV / R2 / Durable Objects / 限流）都在 `wrangler.toml` 里，改完记得重新部署。

### 前端版本

版本号**四处必须同时改**，少一处 CI 就会红或部署错位：

| # | 位置 | 当前值 |
|---|---|---|
| 1 | fork `apps/web/package.json` 的 `version` | `2026.8.9` |
| 2 | fork `package-lock.json` 的 `packages["apps/web"].version` | `2026.8.9` |
| 3 | `build-web-vault.yaml` 的 `inputs.version` | `v2026.8.9` |
| 4 | `push-cloudflare.yaml` 的 `BW_WEB_VERSION` | `v2026.8.9` |

---

## Web Vault 前端定制

前端源码在独立仓库 **[`shiranzby/vw_web_builds`](https://github.com/shiranzby/vw_web_builds)**（`shypwd` 分支），
约 1.2 GB，不塞进本仓库。19 批定制的逐批记录（需求 → 根因 → 落法 → 验证 → 踩坑 → 回滚）在
**[`docs/webvault-migration-checklist.md`](docs/webvault-migration-checklist.md)**。

| 批 | 版本 | 主题 |
|---|---|---|
| P0–P7 | 2026.8.0 | 结构迁移：删除注入层，定制下沉到源码 |
| 第十 ~ 第十九批 | 2026.8.1 → 2026.8.9 | 移动端与体验反馈，每批一批 |

**CI 会做 27 组产物断言**：每组既有正向检查（本批定制的字面量必须在产物里），
也有负向守卫（"只在窄屏生效"的规则不能被写成全局，否则桌面端跟着遭殃）。
rebase 时丢了哪一批，CI 就会红在哪一组 —— 这是"定制下沉到源码"最大的收益。

---

## 数据与安全

- 条目内容用**主密码派生的密钥**在客户端加密，服务端只存密文，**看不到明文**。
  换域名、迁数据库都不会影响解密；但**主密码丢了谁也救不回来**。
- 全部数据在你自己的 Cloudflare 账号里，本项目不接触、不收集任何数据。
- `JWT_SECRET` / `JWT_REFRESH_SECRET` 等密钥只进 GitHub Secrets，不要写进仓库。
- 定时备份请开启 `backup-d1.yaml` workflow，并**定期演练恢复**（没演练过的备份不算备份）。

---

## 跟进上游

有**两条**独立的线，节奏不同：

| 线 | 上游 | 做法 |
|---|---|---|
| 后端 | `qaz741wsd856/warden-worker` | Sync fork 即可；留意 `migrations/` 与 `wrangler.toml` 有没有新增绑定 |
| 前端 | `bitwarden/clients`（经 `vaultwarden/vw_web_builds` 看 tag） | 在 `vw_web_builds` 里 `git rebase --onto <新tag> <旧tag> shypwd`；冲突热点：`vaultwarden.css`、`libs/components/src/{select,disclosure,toggle-group}`、`libs/tools/send/**`、i18n `messages.json` |

rebase 完改"版本号四处"，跑一次构建 —— CI 的 27 组断言会告诉你哪一批定制丢了。

---

## 验证

```bash
# ① 产物断言：把 CI 那 27 组脚本抽出来，在你刚构建的产物上实跑
python .deploycheck/run-artifact-asserts.py ../vw_web_builds/apps/web/build 2026.8.9

# ② 守卫离线证伪：新增/修改了某批"只在窄屏生效"的守卫后必跑
python .deploycheck/probe-s15-guard.py

# ③ 窄屏运行期验收（本地 8099；带 WARDEN_TEST_PROXY 则走线上）
node .deploycheck/probe-w19-verify.mjs
```

部署后自检：

```bash
curl -s https://<你的域名>/vw-version.json                    # {"version":"2026.8.9"}
curl -s -o /dev/null -w "%{http_code}\n" https://<你的域名>/custom.js   # 404
```

> ⚠️ `.deploycheck/` 默认整体 gitignore，只有逐个加白名单的脚本才入库
> （目录里还有带测试账号明文的文件，**绝不能按扩展名批量放行**）。

---

## 当前限制

- 前端源码 1.2 GB，必须独立仓库；前端产物（约 36 MB）不在 git 里，新环境要跑一次构建 workflow。
- Actions artifact 只保留 **90 天**，超期后旧版本无法直接回滚，需要另存。
- 定制靠"产物字面量"保护；若上游把某段逻辑整个重写，字面量会消失 → CI 会红，需要人工补新判据。
- Web Vault 来自 Vaultwarden/Bitwarden 的构建，会显示不少**本服务端未实现**的高级功能入口。
- 免费额度取决于 Cloudflare 的 Workers / D1 / KV 限额，重度使用请留意用量。

---

## 路线图

- [x] 删除运行时注入层，定制全部下沉到源码
- [x] 移动端 19 批适配（导航栏 / 输入框 / 下拉 / 发送页 / 深色主题）
- [x] 构建期 27 组产物断言 + 负向守卫离线证伪
- [x] 交付文档与 AI 部署手册
- [ ] 附件改用 R2 作为默认后端
- [ ] 前端跟进到更新的 Bitwarden 版本
- [ ] 组织/团队相关功能的完整支持
- [ ] 更完善的备份恢复演练脚本

---

## 贡献

欢迎 Issue 与 PR。提交前请注意：

- 后端改动请跑 `cargo fmt` 与 `cargo clippy --target wasm32-unknown-unknown --no-deps`。
- **改前端**必须跑一次 `run-artifact-asserts.py`，并给新批次补一组产物断言（含负向守卫）。
- 改 workflow 的那次提交请带 `[skip ci]`。
- 不要在公开文件里写任何账号、密钥或凭据前缀。

---

## 许可证

本项目包含两部分代码，许可证不同：

| 部分 | 许可证 | 位置 |
|---|---|---|
| 后端（本仓库 `src/`、`migrations/` 等） | **MIT** | [`LICENSE`](LICENSE)（© 2025 Deep Gaurav） |
| 前端（构建产物，来自 Bitwarden clients） | **GPL-3.0** | `.vwsrc/LICENSE_GPL.txt`、`.vwsrc/LICENSE_BITWARDEN.txt` |

「Bitwarden」是 Bitwarden Inc. 的注册商标，本项目仅表示协议兼容，不得用其商标或 Logo 对外宣称。

---

## 致谢

- [warden](https://github.com/qaz741wsd856/warden-worker) —— 本项目的上游后端
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden) 与 [bw_web_builds](https://github.com/dani-garcia/bw_web_builds)
- [Bitwarden](https://github.com/bitwarden/clients) —— Web Vault 的源码来源
- Cloudflare Workers / D1 / KV

---
---

# English

<p align="center">
  <strong>A Bitwarden-compatible password server on Cloudflare Workers, with a mobile-tuned Web Vault</strong>
</p>

🌐 [简体中文](#warden)（默认）｜ **English**

Warden is a self-hosted, Bitwarden-compatible server. The backend is a Rust Worker compiled to WASM,
data lives in Cloudflare D1, and the frontend is a **source-forked** Bitwarden Web Vault.
Official Bitwarden mobile apps, browser extensions and the web client all work out of the box.

> ⚠️ Not affiliated with Bitwarden Inc. "Bitwarden" is a registered trademark; this project is only *protocol-compatible*.
> 🧪 Aimed at personal / small-team self-hosting. Evaluate before storing production data.

## Why Warden

Vaultwarden is excellent, but it still needs a server or VPS — you maintain it, you renew it,
and a missed renewal can cost you access. Warden moves the whole thing onto Cloudflare's serverless stack:
**Workers for the backend, D1 for storage, Workers static assets for the frontend.** Deploy once and forget it.

This fork goes one step further: the official Web Vault is painful on phones, so we put our
customizations **directly into the frontend source** — 19 batches of mobile work
(bottom tab bar, unified input heights, dropdowns that dodge the soft keyboard, in-app dark theme, …).

## Features

**Server** — full vault CRUD (items, folders, favorites, trash) · Bitwarden Send · TOTP ·
attachments on KV or R2 · device management · live sync and push notifications ·
built-in rate limiting · compatible with official Bitwarden clients.

**Frontend (this fork's customizations)** — bottom tab bar · every single-line input is 38px with a
40px visible box and vertically centered content · dropdown panels that open below the field, avoid
the keyboard, and expand on *release* rather than on touch · a reworked Send page (no redundant header,
collapsible extra options, save/cancel in-page and evenly split) · in-app dark theme covering the tab bar,
account card, authenticator page and TOTP badge · plus column alignment, persistent search bar and more.

## Architecture

| Layer | What | Tech | License |
|---|---|---|---|
| L3 | Web Vault frontend | Angular, source fork `shiranzby/vw_web_builds@shypwd` | GPL-3.0 |
| L1 | Backend Worker | Rust → WASM (`src/entry.js`) | MIT |
| L2 | Data | D1 + KV/R2 + Durable Objects + rate limiters | — |

The frontend is built into `bw_web_vault-<version>.tar.gz` (≈36 MB), unpacked to `public/web-vault/`
and published together with the Worker.

**L4 (runtime injection) is retired.** We used to inject `custom/custom.js` + `custom.css` after deploy.
That depended on upstream's DOM never changing — it broke silently and no build-time check could catch it.
All customizations now live in source, guarded by **27 artifact assertions**; `/custom.js` and
`/custom.css` intentionally return 404.

## Quick Start

**Option A — let an AI deploy it for you.** Hand this repo plus [`AI_Skill.md`](AI_Skill.md) to any coding
agent. It will ask you for your Cloudflare email, Global API Key, Account ID and GitHub PAT, then create
resources, set Secrets, run the build and deploy, and verify. You type nothing.

**Option B — fork + two workflows (recommended).** You do *not* need to fork the 1.2 GB frontend repo:
the build workflow's `VAULT_REPO` points at our public `shiranzby/vw_web_builds`, so anyone who forks
this repo can build the exact same customized frontend.

1. Fork this repo. Create a **D1** database and a **KV** namespace in Cloudflare.
2. Add repo Secrets: `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`,
   `D1_DATABASE_ID`, `ALLOWED_EMAILS`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (optional `R2_NAME`).
3. Actions → `Build Web Vault (patched)` → *Run workflow* → `version` = `v2026.8.9` (~5 min).
4. Actions → `Build` → *Run workflow* (~4–5 min).
5. Open your domain and register.

> ⚠️ Order matters: the deploy step looks up the newest artifact named `bw_web_vault-<version>`.

**Option C — Wrangler CLI.** Download the `bw_web_vault-v2026.8.9` artifact, unpack it to
`public/web-vault`, then `wrangler d1 migrations apply vault1 --remote && wrangler deploy`.

### Custom domain

Add a DNS `A` record pointing to `192.0.2.1` (proxied) and a Workers route `<domain>/*` → `warden-worker`.
Without a custom domain, set `workers_dev = true` in `wrangler.toml`.

### Version pinning — four places

Fork `apps/web/package.json` · fork `package-lock.json` (`packages["apps/web"].version`) ·
`build-web-vault.yaml` `inputs.version` · `push-cloudflare.yaml` `BW_WEB_VERSION` —
currently all `2026.8.9` / `v2026.8.9`.

## Web Vault customizations

Frontend source lives in **[`shiranzby/vw_web_builds`](https://github.com/shiranzby/vw_web_builds)**
(branch `shypwd`, ≈1.2 GB). Per-batch records live in
[`docs/webvault-migration-checklist.md`](docs/webvault-migration-checklist.md).
CI runs **27 artifact assertions** — one group per batch, each with positive checks *and* a negative
guard (narrow-screen rules must not become global). If a rebase drops a batch, CI turns red on that group.

## Data & security

Items are encrypted client-side with a key derived from your master password; the server only stores
ciphertext and **cannot read your data**. Migrating the database or changing the domain does not affect
decryption — but a lost master password is unrecoverable. Keep secrets in GitHub Secrets only,
enable `backup-d1.yaml`, and rehearse restores.

## Keeping up with upstream

Two independent lines: the **backend** (`qaz741wsd856/warden-worker`, just sync your fork) and the
**frontend** (`bitwarden/clients` via `vaultwarden/vw_web_builds` tags — rebase with
`git rebase --onto <new-tag> <old-tag> shypwd`). Expected conflict hot spots: `vaultwarden.css`,
`libs/components/src/{select,disclosure,toggle-group}`, `libs/tools/send/**`, i18n `messages.json`.
After rebasing, bump the four version spots and run a build — the 27 assertions will tell you what broke.

## Verification

```bash
python .deploycheck/run-artifact-asserts.py ../vw_web_builds/apps/web/build 2026.8.9
python .deploycheck/probe-s15-guard.py
node .deploycheck/probe-w19-verify.mjs
curl -s https://<your-domain>/vw-version.json     # {"version":"2026.8.9"}
```

## Limitations

The frontend repo is 1.2 GB and separate; the build artifact (≈36 MB) is not in git, so a fresh
environment needs one build run. Artifacts expire after 90 days. Customizations are guarded by
artifact literals — if upstream rewrites a feature wholesale, a guard may need a new criterion.
Some advanced UI from upstream is not implemented by this server.

## Contributing

Issues and PRs are welcome. Run `cargo fmt` and `cargo clippy --target wasm32-unknown-unknown --no-deps`
for backend changes. **Frontend changes must run `run-artifact-asserts.py`** and add an assertion group
for the new batch. Use `[skip ci]` on commits that modify workflows. Never commit credentials.

## License

| Part | License | File |
|---|---|---|
| Backend (`src/`, `migrations/`, …) | **MIT** | [`LICENSE`](LICENSE) (© 2025 Deep Gaurav) |
| Frontend (derived from Bitwarden clients) | **GPL-3.0** | `.vwsrc/LICENSE_GPL.txt` |

## Acknowledgements

[warden](https://github.com/qaz741wsd856/warden-worker) ·
[Vaultwarden](https://github.com/dani-garcia/vaultwarden) ·
[bw_web_builds](https://github.com/dani-garcia/bw_web_builds) ·
[Bitwarden clients](https://github.com/bitwarden/clients) · Cloudflare Workers / D1 / KV
