# webvault/ —— 我们对前端源码的改动

这个目录放**我们对 Bitwarden 前端源码的修改**，替代原来的 `custom/` 运行期补丁层（L4）。
完整方案见 `docs/webvault-source-migration.md`。

## 这里为什么是"补丁"而不是"源码"

前端源码（`vaultwarden/vw_web_builds`，是 `bitwarden/clients` 的 fork）约 **1.19 GB**，
**不进这个仓库**。构建时由 `.github/workflows/build-web-vault.yaml` 现场 clone 它，
再把本目录的补丁 `git apply` 上去。

好处：`warden-worker` 体积不变；上游源码与我们解耦；升级版本时冲突在**编译期**暴露，不会静默失效。

## 目录

```
webvault/
  patches/            按文件名顺序应用的 .patch（一个特性一个文件）
    01-minimum-password-length.patch
    02-viewport-mobile.patch
    ...
  sync-source.sh      稀疏检出上游源码, 供本地改代码/生成补丁
  README.md           ← 本文件
```

`patches/` 为空时，构建仍会成功，那就是**基线产物**（等于官方 `dani-garcia/bw_web_builds` 的内容），
可用于和我们的产物做对比。

## 当前已迁移的改动

| 补丁 | 改了什么 | 替代了原来的什么 |
|---|---|---|
| `01-minimum-password-length.patch` | `libs/common/src/platform/misc/utils.ts`：`minimumPasswordLength` 12 → 8 | `push-cloudflare.yaml` 里 `sed 's/minimumPasswordLength=12/=8/'` 扫压缩产物 |
| `02-viewport-mobile.patch` | `apps/web/src/index.html`：`width=1010` → `width=device-width, initial-scale=1, viewport-fit=cover` | `push-cloudflare.yaml` 里的 python 视口替换 |

> 注意 `utils.ts` 里还有 `originalMinimumPasswordLength = 8` —— 那个只用于**登录**表单
> （让老账号的短密码还能登进去），跟注册时的最小长度是两件事，**不要改它**。

`custom/`（L4）里的 13 个功能点还没迁，见 `docs/webvault-source-migration.md` Phase 2。

## 怎么加一个改动

1. 拉源码（**稀疏 + 无 blob**，只取需要的路径）：
   ```bash
   export http_proxy=http://127.0.0.1:7890 https_proxy=$http_proxy   # 需要代理时
   ./webvault/sync-source.sh                              # 默认 v2026.6.4
   ./webvault/sync-source.sh v2026.6.4 libs/vault/src     # 需要更多路径时追加
   ```
   实测：**8 秒 / 54 MB**。不要用普通 `git clone`（整份 1.19 GB）。
2. 在 `.vwsrc/` 里直接改源码（改完能在本地 `npm ci && cd apps/web && npm run dist:oss:selfhost`
   验证就更稳；但那要装整个 monorepo，日常不必）。
3. 生成补丁（**只包含你改的文件**）：
   ```bash
   cd .vwsrc
   git diff -- <你改过的路径...> > ../webvault/patches/03-描述.patch
   ```
   注意用 `git diff` 而不是 `git diff HEAD`，也**不要**用 `git format-patch`
   （我们只需要内容差异，不需要提交元信息）。
4. 本地先试打一遍，确认能干净应用：
   ```bash
   git apply --check -3 ../webvault/patches/03-描述.patch
   ```
5. 触发构建：Actions → **Build Web Vault (patched)** → Run workflow → 填版本号。
   构建会自己断言"补丁真的改变了产物"（viewport 不再是 1010、`minimumPasswordLength=8`），
   并把 tarball 发成 `webvault-<版本>` 这个**滚动预发布 release** 的资产，供部署工作流下载。

## 读源码（不 clone 全量也能看）

`warden-worker` 本地那份 `public/web-vault/` 带着 `.js.map`，**内嵌完整原始源码**（3227 个文件）。
用 skill 里的工具直接查：

```bash
PY=~/.workbuddy/binaries/python/versions/3.13.12/python.exe
T=~/.workbuddy/skills/warden-worker-shypwd-deploy/scripts/vault-src.py
$PY $T grep "minimumPasswordLength" --ext ts      # 找常量的真实出处
$PY $T cat libs/components/src/select/select.component.html
$PY $T dump /tmp/bw-src libs/vault                # 导出成真实文件树, 用编辑器看
```

## 硬性约定

1. **改源码，不要改压缩产物。** `dist:oss:selfhost` 出来的 `build/` 是产物，不进版本管理。
2. **不要写 `apps/web/build/` 里的东西**——那是构建输出。
3. 一个补丁只做一件事，文件名带序号和描述，便于升级时逐个处理冲突。
4. 迁移期**同一个特性不要两处并存**：某个特性一旦迁进源码，就从 `custom/custom.js` 里删掉对应段落。
5. **不要把 Bitwarden 源码整份提交进这个仓库**。这是这个方案的前提。
