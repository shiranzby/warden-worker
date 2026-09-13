# webvault/ —— 我们对前端源码的改动

前端（Bitwarden Web Vault）的**源码不在这个仓库里**。它在我们的独立 fork：

> **`shiranzby/vw_web_builds`**，分支 **`shypwd`**

全部前端定制都直接写在那个 fork 的源码里。这个目录现在只剩说明文字；
曾经的 `patches/` 与 `sync-source.sh` 已在本阶段退役（见文末）。

完整方案与阶段划分：`docs/webvault-source-migration.md`。

## 为什么源码不进本仓库

前端源码约 **1.2 GB**（`bitwarden/clients` 的 monorepo）。放进来会有两个后果：

- 本仓库从 **0.9 MB** 涨到约 1.2 GB（约 1300 倍）；
- 更要命的是**丢掉共同祖先**——把上游文件"复制"进来，升级时只能肉眼比对；
  而独立 fork 保留共同祖先，`git rebase` 能自动分辨"哪些是我们的改动、哪些冲突"。

fork 是**零功能损失**的：它 fork 自 `vaultwarden/vw_web_builds`，完整继承其全部改动
（移除非自由代码、自托管适配、允许 `vw-` 前缀 class、动态 CSS 支持、裁掉无关客户端等）。

## 我们的定制在哪（三项）

| 定制 | 文件 | 说明 |
|---|---|---|
| 移动端视口 | `apps/web/src/index.html` | `width=1010` → `width=device-width, initial-scale=1, viewport-fit=cover`。`width=1010` 是官方给桌面用的固定宽度，手机上会强制整页缩放、控件失真，是移动端适配的前置条件 |
| 最小主密码长度 | `libs/common/src/platform/misc/utils.ts` | `minimumPasswordLength` 12 → 8 |
| 自托管样式表 | `apps/web/src/css/vaultwarden.css` + `apps/web/webpack.base.js` | 隐藏不支持的功能（订阅 / SSO / Passkey / 部分 2FA / 紧急访问…）。`index.html` 一直有 `<link href="css/vaultwarden.css">`（上游 `Add dynamic CSS support` 加的），但 `copy-webpack-plugin` **默认不复制** `src/css`，所以官方产物里从来没有这个文件——我们在 patterns 里显式声明了复制规则 |

> ⚠️ `utils.ts` 里还有一个 `originalMinimumPasswordLength = 8`。它用于**登录**表单
> （让老账号的短密码还能登进去），跟注册时的最小长度是两件事，**不要动它**。

## 怎么改（推荐本地热重载）

```bash
# 一次性准备（约 1.2 GB；需要时走代理 http://127.0.0.1:7890）
git clone https://github.com/shiranzby/vw_web_builds.git
cd vw_web_builds && git checkout shypwd
npm ci --no-audit --no-fund

# 开发：起本地 dev server（:8080，https），接口代理到线上后端
cd apps/web && npm run build:oss:selfhost:watch
```

改完提交到 `shypwd` 分支，再触发构建。**不要直接改 `build/` 里的产物。**

## 构建与部署链路

```
改 fork 的 shypwd 分支 → push
        ↓
Actions: "Build Web Vault (patched)"     ← 手动 workflow_dispatch，可传 version
   clone fork@shypwd → npm ci → npm run dist:oss:selfhost
   → 断言三项定制都在产物里 → 上传 artifact "bw_web_vault-<version>"（保留 90 天）
        ↓
Actions: "Build" (push-cloudflare.yaml)  ← push 到 main 触发
   下载上面那个 artifact → 解到 public/web-vault/
   → 硬校验（viewport / 密码长度 / css/vaultwarden.css / vw-version.json）
   → 注入 custom.js + custom.css（L4，尚未退役）→ wrangler deploy
```

产物只走 **Actions artifact**，不发 Release —— 本仓库（一个 fork）的 Releases API 在 GitHub
侧一直返回 500，且失败请求仍会留下脏记录。详见 `docs/webvault-source-migration.md`。

## 硬性约定

1. **改源码，不要改压缩产物。** 不要再 sed / python 去动 `app/main.*.js`。
2. **不要把 Bitwarden 源码整份提交进 `warden-worker`。** 这是整个方案的前提。
3. **升级上游版本用 `git rebase`，不要 merge**——版本分支之间是非线性的。
   冲突只可能落在我们改过的那 3 个文件上，范围可控。
4. 迁移期**同一个特性不要两处并存**：某个特性一旦迁进源码，就从 `custom/custom.js` 删掉对应段落。

## 已退役的东西

| 曾经 | 现在 |
|---|---|
| `webvault/patches/*.patch` + CI 里 `git apply` | 改动直接提交进 fork 源码 |
| `public/css/vaultwarden.css` + CI 里 `cp` | 放进 fork 的 `apps/web/src/css/`，由 webpack 复制 |
| CI 里 `sed` 改产物中的 `minimumPasswordLength` | 改源码常量 |
| CI 里 python 替换产物 viewport | 改源码 `index.html` |
| `webvault/sync-source.sh`（稀疏检出以便生成补丁） | 直接完整克隆 fork（本地开发本来就需要） |

## 读源码

产物里的 `.js.map` 内嵌完整原始源码，但更快的方式是直接看 fork 的克隆：

```bash
cd vw_web_builds
git grep -n "minimumPasswordLength" -- libs apps/web/src
```

产物侧查源码（不 clone 也能看）可用 skill 里的 `vault-src.py`。
