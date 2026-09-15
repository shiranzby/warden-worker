<div align="center">
  <h1>Warden</h1>
  <p><em>运行于 Cloudflare Workers 的 Bitwarden 兼容密码库服务端，前端为针对移动端优化的 Web Vault。</em></p>

  <img alt="Platform" src="https://img.shields.io/badge/platform-Cloudflare%20Workers-f59e0b?logo=cloudflare&logoColor=white">
  <img alt="Backend" src="https://img.shields.io/badge/backend-Rust%20%2B%20D1-dea584?logo=rust&logoColor=white">
  <img alt="Web Vault" src="https://img.shields.io/badge/web%20vault-v2026.8.9-2563eb">
  <img alt="License" src="https://img.shields.io/badge/license-MIT%20%2B%20GPL--3.0-22c55e">

  <a href="https://github.com/shiranzby/warden-worker/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/shiranzby/warden-worker?color=ED8936&logo=github"></a>
  <a href="https://github.com/shiranzby/warden-worker/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/shiranzby/warden-worker"></a>
</div>

---

- [English](./README.en.md) | **简体中文**
- [部署与迁移文档](./docs/交付文档.md)
- [AI 部署手册](./AI_Skill.md)
- [Web Vault 源码仓库](https://github.com/shiranzby/vw_web_builds)
- [LICENSE](./LICENSE)

## 声明

Warden 是运行在 Cloudflare Workers 上的自托管密码库服务端，实现 Bitwarden 服务端协议。
项目基于开源项目 [warden](https://github.com/qaz741wsd856/warden-worker) 二次开发，前端源码派生自
[Bitwarden clients](https://github.com/bitwarden/clients)。

- 本项目与 Bitwarden Inc. **无任何关联**。「Bitwarden」为其注册商标，本项目仅表示协议兼容，
  不得使用其商标或标识进行宣传。
- 本项目不收集、不传输、不存储任何用户数据；所有数据保存在使用者自己的 Cloudflare 账号内。
- 本项目按「原样」提供，不附带任何明示或默示担保。请在使用前自行评估，并遵守所在地法律法规。
- 建议用于个人或小规模自用场景；生产环境请自行完成安全评估与备份演练。

## 功能特性

**服务端**

- 密码库条目、文件夹、收藏与回收站的完整增删改查
- Bitwarden Send：通过链接分享加密文本或文件
- TOTP：存储并生成基于时间的一次性密码
- 附件：支持 Cloudflare KV 或 R2 存储
- 设备管理：查看并吊销活动会话
- 实时同步与推送通知：WebSocket 与移动端推送
- 内置限流：登录 5 次 / 60 秒，Send 访问 15 次 / 60 秒
- 兼容官方 Bitwarden 客户端（移动端 App、浏览器扩展、网页端）

**Web Vault（本项目的定制部分）**

- 底部导航栏：适配单手操作的移动端页面切换
- 表单一致性：单行输入框统一为 38px 高、可见框 40px，内容垂直居中
- 下拉面板：贴合输入框展开，避让软键盘，抬起手指后展开
- 发送页：移除冗余页头，附加选项可折叠，保存与取消按钮在页面内均分一行
- 深色主题：跟随应用内主题设置，覆盖底栏、账户卡片、验证码页与 TOTP 徽章

## 架构

| 层级 | 组件 | 说明 |
|---|---|---|
| L1 后端 | Cloudflare Worker（Rust → WASM） | 处理 `/api/*`、`/identity/*`、`/notifications/*` |
| L2 数据 | D1、KV 或 R2、Durable Objects、Rate Limiting | 主数据、附件、推送通知、访问限流 |
| L3 前端 | Web Vault（由源码 fork 构建） | 静态资源，与 Worker 一同发布 |

前端源码位于独立仓库并构建为 `bw_web_vault-<version>.tar.gz`（约 36 MB），
部署时解压至 `public/web-vault/`，与 Worker 共同发布。

## 快速开始

### 前置要求

- 一个 Cloudflare 账号
- 一个 GitHub 账号（用于 Fork 本仓库并运行 Actions）
- 本地无需安装任何工具（可选安装 `wrangler` 用于命令行部署）

### 方式一：由 AI 助手完成部署

将本仓库与 [AI_Skill.md](./AI_Skill.md) 一并提供给支持代码操作的 AI 助手。
该文档定义了完整的部署流程，助手会主动询问所需的 Cloudflare 账号信息与凭据，
随后创建资源、写入 Secrets、执行构建与部署，并完成验证。

### 方式二：Fork 仓库并运行 Actions（推荐）

本仓库的构建工作流从公开的
[`shiranzby/vw_web_builds`](https://github.com/shiranzby/vw_web_builds) 获取前端源码，
因此**无需 Fork 前端仓库**即可构建出相同的定制前端。

1. Fork 本仓库。
2. 在 Cloudflare 创建 D1 数据库与 KV 命名空间（建议命名为 `vault1` 与 `warden-attachments`）。
3. 在仓库 `Settings → Secrets and variables → Actions` 中添加以下 Secrets：

   | Secret | 必填 | 说明 |
   |---|:--:|---|
   | `CLOUDFLARE_EMAIL` | 是 | Cloudflare 登录邮箱 |
   | `CLOUDFLARE_API_KEY` | 是 | Global API Key（非 Bearer Token 方式） |
   | `CLOUDFLARE_ACCOUNT_ID` | 是 | 账号 ID |
   | `D1_DATABASE_ID` | 是 | D1 数据库 ID |
   | `ALLOWED_EMAILS` | 是 | 允许注册的邮箱，逗号分隔；留空表示不限制 |
   | `JWT_SECRET` | 是 | 访问令牌密钥，随机字符串 |
   | `JWT_REFRESH_SECRET` | 是 | 刷新令牌密钥，随机字符串 |
   | `R2_NAME` | 否 | 使用 R2 存储附件时填写 |

4. 进入 `Actions → Build Web Vault (patched) → Run workflow`，将 `version` 填为 `v2026.8.9`，等待完成（约 5 分钟）。
5. 进入 `Actions → Build → Run workflow`，等待完成（约 4 分钟）。
6. 访问部署完成的域名，注册账号即可使用。

> 部署工作流以构建产物名称 `bw_web_vault-<version>` 为索引，因此必须先完成构建，再执行部署。

### 方式三：使用 Wrangler CLI

```bash
npm install -g wrangler
wrangler login

# 从 Actions 的 bw_web_vault-v2026.8.9 产物下载并解压前端
tar -xzf bw_web_vault.tar.gz
mv web-vault public/web-vault

wrangler d1 migrations apply vault1 --remote
wrangler deploy
```

### 绑定自定义域名

1. 在 DNS 中添加 `A` 记录，指向 `192.0.2.1`，并开启代理（橙色云图标）。
2. 在 Workers Routes 中添加路由 `<你的域名>/*`，指向 Worker `warden-worker`。

若不使用自定义域名，可在 `wrangler.toml` 中启用 `workers_dev = true`（默认关闭，因为
`*.workers.dev` 域名易于触发 1101 错误）。

## 配置

主要配置项位于 `wrangler.toml`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DISABLE_USER_REGISTRATION` | `"false"` | 设为 `"true"` 可隐藏注册入口 |
| `BASE_URL` | 自动推断 | 生成文件上传下载链接所使用的站点地址 |

数据库绑定、KV/R2 绑定、Durable Objects 与限流配置同样在该文件中定义，修改后需重新部署。
数据库结构变更由 `migrations/` 目录管理，部署流程会自动应用迁移。

## 安全性

- 条目内容由客户端使用**主密码派生的密钥**加密，服务端仅存储密文，无法读取明文。
  更换域名或迁移数据库均不影响解密；**遗忘主密码将无法恢复数据**。
- 所有密钥应仅保存在 GitHub Secrets 中，不得写入仓库文件。
- 项目提供 `backup-d1.yaml` 工作流用于定时备份数据库，建议同时定期演练恢复流程。

## 常见问题

**为什么前端源码不在本仓库？**
前端源码来自 Bitwarden clients monorepo，体积约 1.2 GB，独立存放于
[`shiranzby/vw_web_builds`](https://github.com/shiranzby/vw_web_builds)。
构建产物（约 36 MB）同样不纳入版本控制，新环境需运行一次构建工作流。

**访问 `/custom.js` 或 `/custom.css` 返回 404，是否缺少文件？**
属于预期行为。本项目早期版本曾在部署后向页面注入这两个文件以实现界面定制，
该方案已废弃并移除，返回 404 表示运行时注入层确已不存在。

**Web Vault 中部分高级功能无法使用？**
Web Vault 的界面源自上游 Bitwarden/Vaultwarden 的构建产物，其中包含本服务端未实现的功能入口。

**部署会产生费用吗？**
在 Cloudflare Workers、D1 与 KV 的免费额度内可零成本运行，重度使用时请留意用量限制。

## 贡献

欢迎提交 Issue 与 Pull Request。

- 后端改动请先执行 `cargo fmt` 与 `cargo clippy --target wasm32-unknown-unknown --no-deps`。
- 前端改动需运行产物断言脚本，并为新的改动批次补充断言。
- 涉及工作流文件的提交请附带 `[skip ci]`。
- 请勿在仓库任何文件中提交账号、密钥或其他凭据。

## 许可证

本项目由两部分构成，许可证不同：

| 部分 | 许可证 | 文件 |
|---|---|---|
| 服务端（`src/`、`migrations/` 等） | MIT | [LICENSE](./LICENSE)（© 2025 Deep Gaurav） |
| 前端（派生自 Bitwarden clients） | GPL-3.0 | `.vwsrc/LICENSE_GPL.txt` |

## 致谢

- [warden](https://github.com/qaz741wsd856/warden-worker)——本项目的服务端上游
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden)、[bw_web_builds](https://github.com/dani-garcia/bw_web_builds)
- [Bitwarden clients](https://github.com/bitwarden/clients)——Web Vault 源码来源
- Cloudflare Workers、D1、KV
