# 把定制从前端补丁层（L4）迁到源码（方案 d）

> 目标：**删掉 `custom/`（L4），改成直接修改前端源码**，让定制成为"构建出来的产物"的一部分，
> 而不是运行期往 DOM 上贴的补丁。
> 本文是**执行方案**，配套设计文档见 `docs/custom-layer-design.md`（§1.3 路径对比 / §9.6 决策）。

---

## 1. 先回答那个最要紧的问题

> **"是需要把前端的代码也一起拉进 GitHub 吗？"**

**不需要拉进 `warden-worker` 仓库，也不需要你新建 fork。**

前端源码**在构建时从公开仓库现场取**：

| 仓库 | 是什么 | 我们要不要碰 |
|---|---|---|
| `bitwarden/clients` | 官方源码（GPL-3.0） | 不直接碰 |
| **`vaultwarden/vw_web_builds`** | **`bitwarden/clients` 的 fork**，每个 Bitwarden 版本一个分支，**vaultwarden 的改动以 commit 形式存在分支上**（实测：1.19 GB，44 个分支，`v2024.12.1` … `v2026.8.0`） | **只读地 clone 它**（公开仓库，无需 fork） |
| `dani-garcia/bw_web_builds` | **构建脚本**：clone 上面那个仓库 → 构建 → 打包 → 发 Release | 抄它的构建配方 |

**所以我们的改动就是一个补丁文件，放在 `warden-worker` 里。**

理由：我们的改动量相对于 1.19 GB 的源码很小，用"补丁"比"维护一个 1.19 GB 的 fork"更轻；
而且我们把上游 commit **钉死**，补丁上下文不会自己漂移——只在我们主动升版本时才需要处理。

> 如果哪天我们的改动大到"补丁已经不好维护"，再改成 fork `vw_web_builds` 把改动做成 commit
> （那时用 `git cherry-pick` 升级版本）。**现在不必**。

---

## 2. 构建机制（实测，不是推测）

来自 `dani-garcia/bw_web_builds` 的 `Dockerfile` 与 `scripts/`：

```dockerfile
FROM node:24-trixie
ARG VAULT_VERSION=d2a095eb800fe80a9bc524579b974796eae51994   # vw_web_builds 上的 commit
ENV VAULT_FOLDER=bw_clients
RUN ./scripts/checkout_web_vault.sh    # 浅克隆 vw_web_builds @ 该版本
RUN ./scripts/build_web_vault.sh       # npm ci && cd apps/web && npm run dist:oss:selfhost
RUN mv "${VAULT_FOLDER}/apps/web/build" ./web-vault
RUN tar -czvf "bw_web_vault.tar.gz" web-vault --owner=0 --group=0
```

四个要点（照抄即可）：

| 项 | 值 |
|---|---|
| Node | **24** |
| 构建命令 | 仓库根 `npm ci` → `apps/web` 里 `npm run dist:oss:selfhost` |
| 产物目录 | `apps/web/build` |
| 打包 | `tar -czvf bw_web_vault.tar.gz web-vault`（**顶层是 `web-vault/`**） |

**与我们现有 CI 的兼容性**：现有步骤是 `tar -xzf bw_web_${TAG}.tar.gz -C public/`，
解出 `public/web-vault/`。我们自己打的包顶层同样是 `web-vault/` → **完全对得上，替换是 drop-in 的**。

**当前版本**：CI 里钉的是 `v2026.6.4`，而 `vaultwarden/vw_web_builds` **确有 `v2026.6.4` 分支**
→ 所以第一阶段能做到**真正的"零行为变化"**（同版本、同构建配方）。

---

## 3. 目标架构

```
warden-worker/                        ← 现有仓库，体积不变
├── .github/workflows/
│   ├── build-web-vault.yaml          ← 【新增】构建我们自己的前端，产出 Actions artifact
│   └── push-cloudflare.yaml          ← 【改】下载地址指向我们自己的资产；删掉注入/替换步骤
├── webvault/                         ← 【新增】我们的前端改动
│   ├── patches/                      ← 按顺序应用的补丁（一个特性一个文件，便于 review 与升级）
│   │   └── 01-*.patch …
│   └── README.md                     ← 怎么改、怎么重新生成补丁、怎么升版本
└── custom/                           ← 【最终删除】L4 消失
```

数据流：

```
改 webvault/patches/ → 触发 build-web-vault.yaml
    → clone vaultwarden/vw_web_builds @ 钉住的版本
    → git apply 我们的补丁
    → npm ci + npm run dist:oss:selfhost（实测约 5 分钟）
    → 打包 tar.gz → 上传 Actions artifact（90 天保留）
push-cloudflare.yaml → 下载该资产 → 部署（仍然很快）
```

**关键：重量级构建与部署解耦。** 构建只在"改了前端"时跑一次；
日常部署仍然只是"下载 + 部署"，速度不变。

---

## 4. 分阶段迁移（每步都可验证、可回退）

### Phase 0 — 打通流水线（零行为变化）✅ 已完成

- 新增 `build-web-vault.yaml`：clone `v2026.6.4` + **空补丁** → 构建 → 上传 artifact
- **不切线上**。这一步只证明"我们造得出来"。
- 退出条件：构建成功且产物结构与官方一致。

**执行结果**：run #3（`34747235498`）成功，构建耗时 **5.2 分钟**。

**退出条件的验证（逐字节，不是"量级相近"）**
把我们的产物与官方 `dani-garcia` release 的 `bw_web_v2026.6.4.tar.gz` 拆开逐个文件比对：

| 指标 | 我方 | 官方 |
|---|---|---|
| tarball 大小 | 36,213,426 B | 36,208,444 B |
| 解包后文件数 | 278 | 279 |
| 解包后总字节 | 147,587,090 | 147,585,315 |
| **大小完全一致的文件** | **271 / 272** 共有文件 | — |

**7 个有差异的文件，全部差异来源已定位到具体字节**：

| 文件 | 差异 | 性质 |
|---|---|---|
| `app/main.*.js` (×2 处) | `dropin.js?cache=akgcuk` vs `?cache=2rpsdj`；`messages.json?cache=…` 同 | **构建期随机 cache-buster**（每次构建都不同） |
| `app/main.*.js` | `//# sourceMappingURL=main.<hash>.js.map` | 上行 token 变化 → 内容 hash 变化 → 文件名 hash 变化（派生） |
| `connectors/duo-redirect.*.js`、`connectors/webauthn-fallback.*.js` | 同上（token + sourceMappingURL） | 同上 |
| `index.html`、`duo-redirect-connector.html`、`webauthn-fallback-connector.html` | 只差被引用的 `main/connectors` 文件名 hash | 派生 |
| `app/vendor.*.js.map` | 仅 `sources` 路径层级：`../../../../../` vs `../../../../` | **构建机绝对路径深度**，纯展示；`mappings` 与 `sourcesContent`（1150 条内嵌源码）**完全相同** |
| `vw-version.json` | 官方有、我方无 | 见下 |

> `main.js` 长度两边**完全相同**（5,069,569 B），差异 run 只有 4 段：2 处 token + 1 处 sourceMappingURL 文件名。
> **即：除一个刻意的随机 token 外，零源码差异。**

**`vw-version.json` 的真相**（读上游 `scripts/build_web_vault.sh` 得到）：
它不是 Bitwarden 版本，而是**构建仓库自己的 tag**：
```bash
printf '{"version":"%s"}' "$(git ls-remote --tags --refs --sort='v:refname' \
  https://github.com/dani-garcia/bw_web_builds.git 'v*' | tail -n1 | grep -Eo '[^\/v]*$')" \
  | tee -a build/vw-version.json
```
- 官方 v2026.6.4 产物里是 `{"version":"2026.6.4"}`，22 字节。
- 检索确认：**前端 bundle 与源码里都没有任何地方引用 `vw-version.json`**；
  `src/`（我们的 L2）里也没有 → 目前是个"跟着 tarball 走、没人读"的文件。
- **但为了"零行为变化"，我们的构建必须照样生成它**：值就是 `<我们的 tag 去掉 v>`，
  与上游对钉死版本的行为**完全等价**（见 Phase 1 的构建改动）。

### Phase 1 — 迁移"本来就该在源码里"的改动（低风险）✅ 已完成
> 结论（2026-09-13）：两处改动已进源码，CI 里的 `sed` / 视口替换步骤已删除，
> 构建产物经**逐字节验证**确认补丁真实生效（见本节末"产物验证"）。
> 剩余一步是**切换生产下载源**（部署改用我们自己的 artifact），已配好并带硬校验，等一次显式上线。

这两件事**现在就在 CI 里用 sed/python 硬替换**，属于路径 (a)，搬进源码后天然更干净。
两处真实出处都已定位（用 `.js.map` 里的内嵌源码查的，不是猜的）：

| 现在 | 源码里的真实出处 | 迁移后 |
|---|---|---|
| `sed 's/minimumPasswordLength=12/=8/'` 扫 `app/*.js` | `libs/common/src/platform/misc/utils.ts:70`<br>`static readonly minimumPasswordLength = 12;` | 补丁 `01-minimum-password-length.patch` |
| python 替换 `index.html` 的 `width=1010` 视口 | `apps/web/src/index.html:5`<br>`<meta name="viewport" content="width=1010" />` | 补丁 `02-viewport-mobile.patch` |

**为什么源码改 1 行就等价于现在的全局 sed（不是"差不多"，是等价）**
`minimumPasswordLength` 全项目只有 4 个引用点，全部经由这个常量：
`libs/auth/.../input-password.component.ts`（注册/设密码表单）、
`src/app/admin-console/.../master-password.component.ts`（组织策略编辑器，2 处）、以及常量定义本身。
sed 是全局替换，改常量同样影响这三处 → 行为完全一致。
> ⚠️ 同一文件里的 `originalMinimumPasswordLength = 8` 是**另一件事**：只用于**登录**表单
> （`libs/auth/.../login.component.ts:112`，允许老账号的短密码登录）。sed 也没动它，**我们同样不动**。

**视口那处的坑**：CI 的匹配串是 `<meta name="viewport" content="width=1010"/>`（`/>` 前**无空格**），
因为 Angular 生产构建会把 HTML 的 `" />` 压成 `"/>`；而**源码里是有空格的** (`content="width=1010" />`)。
所以在源码里改必须按源码的写法，不能照抄 CI 那个串。

**新增的搬迁内容（本来以为要单独处理，结果发现是构建产物的一部分）**
`vw-version.json` 由官方 `build_web_vault.sh` 生成，属于"构建步骤"而不是"源码"，
已搬进我们的 `build-web-vault.yaml`（值 = 我们钉的 tag 去掉 `v`，与上游对钉死版本的行为等价）。

**改动清单**

| 文件 | 变化 |
|---|---|
| `webvault/patches/01-minimum-password-length.patch` | 新增（`utils.ts` 12→8） |
| `webvault/patches/02-viewport-mobile.patch` | 新增（`index.html` 视口自适应） |
| `webvault/sync-source.sh` | 新增：**8 秒 / 54 MB** 稀疏检出上游源码（不是 1.19 GB） |
| `webvault/README.md` | 重写"怎么加一个改动"流程 |
| `.github/workflows/build-web-vault.yaml` | 生成 `vw-version.json`；新增**补丁生效断言**；上传 Actions artifact（保留 90 天） |
| `.gitignore` | 忽略 `.vwsrc/`（本地稀疏检出） |

**验证**
- 本地：`git apply --check` 两个补丁都能干净应用；实际应用后 `utils.ts:71` 为 `= 8`、
  `index.html:5` 为 `device-width` 变体，然后还原。
- CI：构建步骤会**断言产物**（viewport 不再含 `1010`；`main.js` 里有 `minimumPasswordLength=8`
  且没有 `=12`）—— 防"补丁打得上去但没改到实际执行的代码"这种静默失败。
- 部署后：逐条跑 `tests/mobile-regression.mjs --only=guard`（G1–G7 全绿）。

- 退出条件：CI 里不再有 `sed`/视口替换步骤。

**切换线上下载源（已改，走 Actions artifact）**

原计划是"发 Release 资产 + wget"，但**这条路在本仓库走不通**，实测结论：

> 🔴 **本仓库（一个 fork）的 Releases API 在 GitHub 侧是坏的。**
> `POST /releases`、`DELETE /releases/{id}`、`PATCH /repos/{r}` **一律返回 HTTP 500 且 body 为空**，
> 用 workflow 的 `GITHUB_TOKEN` 和全权限 PAT **结果一样**（说明不是权限问题）；
> 而 `DELETE /git/refs/tags/...` 却正常返回 204。
> 更坑的是 `POST /releases` **报 500 但会真的建出 release 记录** → 留下重复的脏数据
> （本轮留下 3 条 draft，需手工在 Releases 页删掉）。

所以改成 **Actions artifact**：`build-web-vault.yaml` 用 `actions/upload-artifact`
（`retention-days: 90`），`push-cloudflare.yaml` 用 `gh run download` 取同仓库的产物。
`push-cloudflare.yaml` 的 `permissions` 必须显式加 `actions: read` ——
**一旦声明 `permissions`，未列出的作用域会被置为 `none`**，漏了会 403。

```diff
- wget -q "https://github.com/dani-garcia/bw_web_builds/releases/download/${TAG}/bw_web_${TAG}.tar.gz"
- tar -xzf "bw_web_${TAG}.tar.gz" -C public/
+ # 按 artifact 名确定性反查 run —— 不要用 gh run list --limit=1（见下方"选构建脆弱性"）
+ ART_JSON="$(gh api "repos/${GITHUB_REPOSITORY}/actions/artifacts?name=bw_web_vault-${TAG}&per_page=100")"
+ RUN_ID="$(printf '%s' "${ART_JSON}" \
+   | jq -r '(.artifacts // []) | map(select(.expired == false))
+            | sort_by(.created_at) | reverse | (.[0].workflow_run.id // empty)')"
+ gh run download "${RUN_ID}" --repo "${GITHUB_REPOSITORY}" \
+    --name "bw_web_vault-${TAG}" --dir .frontend
+ tar -xzf ".frontend/bw_web_vault.tar.gz" -C public/
```

**⚠️ 选构建脆弱性（实测踩到，已修）**

最初用的是 `gh run list --workflow=build-web-vault.yaml --status=success --limit=1`。
实测在 GitHub **索引滞后**的窗口里，它会返回**上一个**成功的构建：
当时刚跑完补丁构建 `34748607765`(sha `40a9b8b`)，`run list` 却仍把**未打补丁的基线**
`34747235498`(sha `ed8f883`) 排在第一位。若那一刻部署，就会**静默上线没打补丁的前端**。

修法是两条互补的防线：

| 防线 | 做法 | 性质 |
|---|---|---|
| ① 确定性寻址 | `GET /actions/artifacts?name=bw_web_vault-${TAG}`，取最新且 `expired==false` 的一条，用其 `workflow_run.id` | 消掉索引滞后这一类问题 |
| ② 产物硬校验 | 解包后断言 `index.html` 无 `width=1010`、`main.*.js` 有 `minimumPasswordLength=8` 且无 `=12`、存在 `vw-version.json` | 兜住"选错产物"的**所有**成因 |

②是更根本的一条：不管产物是官方包、旧基线包还是别的什么，只要不是"打过补丁的我们自己构建的产物"
就立刻 `exit 1`，绝不静默降级。本地已实测：补丁产物 → `PASS(exit 0)`；官方包 → `FAIL(exit 1)`。

找不到产物时同样**直接失败**（不会静默退回官方包 —— 那会悄悄部署成没打补丁的版本）。
回退是把这段换回 `wget` 一行 + 恢复被删的两个替换步骤。

### Phase 2 — 建立前端 fork，把注入收编进源码 ✅ 已完成（2026-09-13）

Phase 1 用"补丁"解决了 2 处改动，但补丁机制本身有代价：升级时要重新打、冲突在**构建时**才暴露、
`vaultwarden.css` 还得靠部署时 `cp`。本阶段把前端源码 fork 出来，改动**直接提交进源码**。

**决策：fork `vaultwarden/vw_web_builds` 为独立仓库，而不是把源码 vendoring 进本仓库**

| 依据 | 实测数据 |
|---|---|
| fork 零功能损失 | `v2026.8.0` 相对官方 `bitwarden/clients` = **ahead 36 / behind 0**。fork = 完整复制 + 我们的提交 → 36 个提交全部保留 |
| 反而会丢东西 | 若改去 fork `bitwarden/clients`，会丢 dynamic CSS 支持与 `vw-` class 钩子（→ `vaultwarden.css` 全废），并重新引入非自由代码（法务风险） |
| 上游永不给移动端适配 | 在 `apps/web` + `libs/common` + `libs/vault` 实测：含 `@media` 的文件**仅 1 个**、断点值 **0 个**。官方是纯桌面设计 ⇒ 移动端适配是**永久性分叉**，等不来 |
| 不能塞进本仓库 | 塞进去 = 0.9 MB → 约 1.2 GB（约 1300 倍），且丢共同祖先 ⇒ 升级只能肉眼比对，冲突更多 |

**P1（安全阀）：只换"从哪拉代码"，产物应与官方一致**

- git 级：fork 的 `shypwd` 分支与官方 `v2026.8.0` 是**同一个 commit**
  （`a868ea02ea78b4a0eb8656664cf8d29f9fdab8c2`），`git diff shypwd v2026.8.0` 为空。
- 产物级：跑两次构建 —— run `34755569036`（官方源）与 run `34755791632`（fork 源），
  逐文件比 SHA256。结果：**281 个文件里 272 个 hash 完全相同**，两棵树**总字节完全相同**
  （156,125,341 = 156,125,341）。

  剩下 9 个差异全部可解释，且都**不是源码差异**：

  | 文件 | 差异 | 性质 |
  |---|---|---|
  | `app/main.*.js` | 3 处 / 共 32 字节：2 处 `?cache=ljhmfm` vs `?cache=3ttnsl`，1 处 `sourceMappingURL` | 源头是 `webpack.base.js` 的 `CACHE_TAG: Math.random().toString(36).substring(7)` —— **每次构建都随机** |
  | `connectors/duo-redirect.*.js`、`connectors/webauthn-fallback.*.js` | 各约 160 段单字节差异，全是标识符 `e` ↔ `t` 互换 | Terser 压缩器的变量名分配非确定性。证据：两侧标识符计数**除 `e`/`t` 外逐一相等**，且 `e`+`t` 总数相同（100+67 = 63+104 = 167） |
  | `index.html`、`duo-redirect-connector.html`、`webauthn-fallback-connector.html` | 仅 `<script src>` 里的文件名 hash | 派生自上面 main.js 的内容 |
  | 3 个 `.map` | 文件名变了 | 同样派生 |

  ⇒ **P1 通过：零源码差异。** 已用同源再构建一次（run `34756073714`）做对照。

**P2（收编）：三处定制从"部署时注入"改为"源码自带"**

提交进 fork 的 `shypwd` 分支（commit `38fcaee85d`）：

| 定制 | 落点 | 替代了原来的什么 |
|---|---|---|
| 移动端视口 | `apps/web/src/index.html` | CI 里 python 替换产物 + 补丁 `02-` |
| 最小主密码长度 | `libs/common/src/platform/misc/utils.ts` | CI 里 `sed` 扫产物 + 补丁 `01-` |
| `vaultwarden.css` | 新增 `apps/web/src/css/vaultwarden.css`，并在 `apps/web/webpack.base.js` 的 `copy-webpack-plugin` patterns 里显式声明 `to: "css/vaultwarden.css"` | CI 里的 `cp public/css/vaultwarden.css public/web-vault/css/` |

> `vaultwarden.css` 这处值得单说：上游的 `Add dynamic CSS support` 提交**只改了 `index.html` 两行**
> （加了 `<link href="css/vaultwarden.css">`），但 `copy-webpack-plugin` **默认不复制 `src/css`**，
> 所以官方产物里从来没有这个文件 —— 它一直靠部署者自己放。补上这条复制规则后产物即自带。

**派生改动**

- `build-web-vault.yaml`：`VAULT_REPO` → fork，新增 `VAULT_BRANCH: shypwd`；删掉整个
  "Apply our patches" 步骤与 `apply_patches` 输入；新增**版本一致性校验**（`inputs.version`
  必须等于源码 `apps/web/package.json` 的 version —— 否则 artifact 名会标错版本，部署侧就查不到）；
  定制断言从"补丁生效"改为"源码级定制在产物中可见"，并新增 `css/vaultwarden.css` 断言。
- `push-cloudflare.yaml`：删掉 `cp vaultwarden.css` 步骤；硬校验新增第 4 项
  （`css/vaultwarden.css` 存在且含 `.vw-hide`）。
- 退役：`webvault/patches/`（3 个文件）、`webvault/sync-source.sh`、`public/css/vaultwarden.css`。
  `webvault/README.md` 重写为"定制在哪 + 怎么改"的入口页。

**⚠️ 版本前提**：fork 基于 **`v2026.8.0`**（最新），而线上目前是 **`v2026.6.4`**。
⇒ 从这个 fork 构建的产物是 8.0，**部署上去就是一次版本跳跃**，所以先做了下面的兼容性评估。

**兼容性评估结论：零后端改动**

| v2026.8.0 的新东西 | 后端是否支持 | 实际效果 |
|---|---|---|
| **归档 archive** | ✅ `src/router.rs` 已有一整套：`PUT /api/ciphers/{id}/archive`、`/unarchive`、批量 `PUT /api/ciphers/archive`、`/unarchive`；`archived_at` 列 + sync 响应里的 `archivedDate` | **可用**。前端 `default-cipher-archive.service.ts` 调的正是批量端点，路径完全匹配 |
| **新条目类型**（bankAccount / driversLicense / passport） | ✅ `deserialize_cipher_type` 接受 **1..=8**（Login/SecureNote/Card/Identity/SshKey/BankAccount/DriversLicense/Passport），`CipherTypeFields` 也已有这些字段 | **默认关闭** —— 受 `PM32009NewItemTypes` flag 控制，默认 `FALSE` 且 `/api/config` 未返回它 |
| 新批量条 / 快捷复制 / VFO1 术语 | — | 分别受 `PM37785_VaultBatchBar` / `PM40435_QuickCopyIconSetting` / `VFO1Foundation` 控制，**默认全为 FALSE** |
| `/api/config` 的 `version`（仍返回 `2026.6.0`） | — | **不构成问题**：`checkServerMeetsVersionRequirement$` 在 v2026.8.0 的 web 客户端里**只有定义、零调用**（全仓 `git grep` 确认） |

原理在 `libs/common/src/enums/feature-flag.enum.ts`：后端不返回的 flag 一律落到
`DefaultFeatureFlagValue`，而它**几乎全是 `FALSE`**。
⇒ v2026.8.0 的 UI 默认行为 ≈ v2026.6.4，**版本跳跃的界面差异比预期小得多**。
想开某个新功能（例如新条目类型）只需在 `src/handlers/config.rs` 的 `featureStates` 里加一行，
**不需要动任何 API**。

**6.4 → 8.0 的模板层实际改动很小**（`git diff origin/v2026.6.4 origin/v2026.8.0` 实测）：

- `vault-items.component.html`：**3 处，全是 `i18n` → `vfo1I18n` 术语替换**，零结构改动
- `vault-cipher-row.component.html`：3 处，2 处术语 + 1 处 `[showQuickCopyActions]` 传参
- 整个 `vault-items/` 目录：+138 / −41（含 spec）
- `apps/web/src` 整体 +174105 行里，**154881 行是 `locales/` 翻译文件**（89%）

**顺带纠正一个早期的误判**：`cdk-virtual-scroll-viewport`、`batchBarService`、动态 th 宽度
**在 v2026.6.4 就已经存在**，不是 8.0 新引入的。它们确实让 L4 里"4 个 th / `th.tw-w-12`"那套
DOM 假设很脆，但那是 L4 自身的问题（对着编译产物猜 DOM），与版本跳跃无关。

### Phase 2.5 — 版本跳跃 v2026.6.4 → v2026.8.0 兼容性评估 ✅ 已完成

**结论：后端一行都不用改，且 8.0 的新功能默认全关 —— UI 行为 ≈ v2026.6.4。**

**判据一：端点集合零新增。** 从 `libs/common/src/services/api.service.ts` 提取
`send("METHOD", "path")` 对：v2026.6.4 = **51** 个，v2026.8.0 = **50** 个，
**新增 0 个**，只删掉 1 个 `POST /accounts/kdf`（后端 `src/router.rs:55` 仍保留该路由，
属于无害死端点）。即 8.0 客户端不会去调任何后端没有的接口。

**判据二：feature flag 默认全关。** `/api/config` 的 `featureStates` 只显式声明 4 项：

| flag | 值 | 含义 |
|---|---|---|
| `pm-19148-innovation-archive` | **true** | 归档功能开启 |
| `pm-19051-send-email-verification` | false | — |
| `cxp-import-mobile` / `cxp-export-mobile` | true | 移动端导入 / 导出 |

其余 flag 不在响应里 → 客户端 `getFeatureFlagValue()` 落到 `DefaultFeatureFlagValue`，
**一律 FALSE**：

| 8.0 的新功能 | flag | 默认 | 自建服务的实际表现 |
|---|---|---|---|
| 新条目类型（银行账户 / 护照 / 驾照 / SSH 密钥） | `pm-32009-new-item-types` | FALSE | **关闭** |
| 官方批量操作条 | `pm-37785-vault-batch-bar` | FALSE | **关闭** → 沿用旧选择模式 |
| 快捷复制图标 | `pm-40435-quick-copy-icon-setting` | FALSE | 关闭 |
| VFO1 术语（"集合"→"共享文件夹"） | `vfo1-foundation` | FALSE | 关闭 → 沿用旧措辞与旧图标 |

> 这四个开关同时是**杠杆**：后端 `src/models/cipher.rs` 已支持 type `1..=8`，
> 想让用户建银行账户/护照，只需在 `src/handlers/config.rs` 的 `featureStates` 里**加一行**，
> 不触碰任何 API 形状。同理，若哪天启用官方批量条，L4 里那套「选择模式」改动可整段退役。

**判据三：版本号不 gate 任何功能。** `serverConfig.version`（后端给 `2026.6.0`）
在全代码库**只被读 1 次**，位于 `default-config.service.ts:212` 的
`checkServerMeetsVersionRequirement$()` 内部，而该方法**零调用点**（只有抽象定义 + 实现）。
→ 后端报什么版本号都不影响功能。

**判据四：归档（8.0 唯一被打开的"新"功能）后端完全就绪。**

| 环节 | 客户端 | 后端 | 结论 |
|---|---|---|---|
| 端点 | `send("PUT", "/ciphers/archive"` 或 `"/ciphers/unarchive", …)` | `router.rs:161/163` 批量、`:155/157` 单条 | ✅ 路径匹配 |
| 请求体 | `CipherBulkArchiveRequest { ids: [] }` | `json_each(?3, '$.ids')` | ✅ 字段匹配 |
| 响应 | `new ListResponse(r, CipherResponse)` | `build_cipher_list_response` | ✅ |
| 归档标记 | `isArchived = !!cipher.archivedDate` | `cipher.rs:275` 输出 `archivedDate`；sync 见 `handlers/ciphers.rs:1040` | ✅ |
| **菜单可见性** | `userCanArchive$` ← `hasPremiumFromAnySource$` ← `premiumPersonally \|\| premiumFromOrganization` | sync 给 `premium: true` / `premiumFromOrganization: false` | ✅ |

最后一行值得单独记一笔：客户端读的是 `response.premiumPersonally`，而后端字段名是 `premium`，
看起来对不上 —— 但 `BaseResponse.getResponseProperty()` 会**自动尝试另一种大小写**
（`base.response.ts:24-35`），`"Premium"` 能落到 `"premium"`，因此 premium 判定为 true、
归档菜单会出现。**这类"驼峰大小写"差异，核对后端字段时不能只靠肉眼比对。**

**判据五：sync 里新增的 crypto 处理不会抛异常。** 8.0 在
`default-sync.service.ts:183` **无条件**调用了 `runCryptoSyncHandler()`
（源码注释：数据不一致时会 throw 拒绝同步），它把 `profile.accountKeys` 交给 SDK 的
`crypto_sync_handler().on_sync()`。逐层核对后端返回的 `accountKeys`：

```
{"publicKeyEncryptionKeyPair":{wrappedPrivateKey, publicKey, signedPublicKey:null},
 "signatureKeyPair":null, "securityState":null}
```

- `PrivateKeysResponseModel` 构造要求 `publicKeyEncryptionKeyPair` 是对象 ✅；
  且 `signatureKeyPair` / `securityState` **同为 null → 通过"两者必须同时存在或同时缺失"的校验** ✅
- `toWrappedAccountCryptographicState()`：两者皆 null → 走 **V1 分支** `{V1:{private_key}}` ✅
- `PublicKeyEncryptionKeyPairResponse` 要求 `publicKey` / `wrappedPrivateKey` 为字符串；
  后端 `users.public_key` / `private_key` 都是非 Option 的 `String` ✅

**P5/P6 的源码锚点（实测，取代 L4 对着编译产物的猜测）**
`apps/web/src/app/vault/components/vault-items/vault-items.component.html`：

- 外层是 `cdk-virtual-scroll-viewport`（`[itemSize]="RowHeight"`），
  批量条可见时由 `batchBarService.barVisible()` 切换 `tw-pb-[7.5rem]`
- `<bit-table [dataSource]="dataSource" layout="fixed">` ← **`table-fixed` 的真正来源**
- 表头第 1 个 `<th bitCell class="tw-w-24 tw-whitespace-nowrap" colspan="2">` 是复选框列
  ← 这正是 L4 观察到的"th 比 td 少一列"的真实原因（**不是**"4 个 th 覆盖 5 列"）
- 名称列 `[class]="showExtraColumn ? 'tw-w-3/5' : 'tw-w-full'"`，
  而 `showExtraColumn = showCollections || showGroups || showOwner`（`.ts:279`）——
  个人保险库三者皆 false → **`tw-w-full`**
- 官方确实有响应式，但**只有 Tailwind 的 `lg:` / `xl:`（≥1024 / ≥1280）**，即"桌面宽屏"档；
  **移动端断点（≤768）一个都没有** —— 与前述"官方零移动端响应式"的结论一致

### Phase 3 — 迁移功能层（主体工作量）
`custom.js` 现在 **1983 行**、`custom.css` **1279 行**，共 13 个功能点。
**逐个迁移，每迁一个就从 `custom.js` 里删掉对应段落**（保证任一时刻两处不并存）：

建议顺序（与设计文档 §6 一致，按痛点）：
1. **移动端下拉面板定位**（§8.5，最近出问题最多）
2. **选择模式 / 表头工具行 / 列宽**（表格结构类，互相纠缠）
3. **行内 TOTP 徽章**（列表行结构类）
4. **行内菜单「添加到文件夹」**
5. **底部标签栏 / 二级导航 chips / 独立验证码页**
6. **头像卡片 + 跨端同步**
7. **纯 CSS 观感（留白、页头、对话框）** → 改成真正的 SCSS 改动

- **验证**：每迁一项 → `--local` 跑对应 guard 断言 → 部署 → 线上跑一次
- 退出条件：`custom.js` 里对应功能段落被删除，且 guard 断言仍然全绿

### Phase 4 — 拆掉 L4
- 删 `custom/`、删 CI 的 "Inject shypwd custom frontend" 步骤
- `custom/custom.js` 的部分 guard 断言（如"面板被接管为 fixed"）改为对新构建的断言
  （例如"源码里就是 `position: fixed`，不再需要运行期接管"）
- 退出条件：`custom/` 不存在，线上 guard 全绿，部署时长与迁移前相当。

---

## 5. CI 净变化（截至 Phase 2.5 的实际状态）

| 步骤 | 变化 |
|---|---|
| `Patch web vault master password minimum length` | ✅ **已删**（进源码 `utils.ts`） |
| index.html 里的视口替换 | ✅ **已删**（进源码 `index.html`） |
| `Apply web vault overrides (vaultwarden.css)` 的 `cp` | ✅ **已删**（改由 fork 的 `copy-webpack-plugin` 构建期复制） |
| 前端来源 | ✅ **已改**：`VAULT_REPO` → `shiranzby/vw_web_builds`，新增 `VAULT_BRANCH=shypwd` |
| `Inject shypwd custom frontend`（custom.js / custom.css） | ⬜ 保留至 Phase 3 迁完 13 个功能点 |
| `*.map` 删除 | 保留（Cloudflare 单文件体积限制，与构建方式无关） |
| **新增** 版本一致性校验 | `Verify version matches the source` —— 与 fork 的 `apps/web/package.json` 比对，防 artifact 名标错版本 |
| **新增** 定制硬断言（构建侧） | `Verify our customizations are in the built artifact` —— 视口 / 密码下限 / `css/vaultwarden.css` **三项**，任一不符即 `exit 1` |
| **新增** 定制硬断言（部署侧） | `Verify frontend is our patched build (fail hard)` —— 再补 `vw-version.json` 一项，共四项 |

> 前端来源那次改动就是 P1 的安全阀：`VAULT_REPO` 换掉的当时，fork 与官方还是同一个 commit，
> 所以产物必须逐字节一致。实测两棵树总字节完全相同（156,125,341），281 个文件里 272 个
> SHA256 相同，其余 9 个差异全部可解释为构建期非确定性（见 §4 与 Phase 2 小节）。

---

## 6. 代价与风险（实测数据，不是估算）

> **Phase 0 实跑数据（`v2026.6.4`）** —— 我原先估"20–35 分钟"，**实测只有 5 分钟出头**：

| 步骤 | 实测耗时 |
|---|---|
| 克隆 `vw_web_builds`（浅克隆） | ~0 分钟 |
| `npm ci`（**2885 个包**） | **1.3 分钟** |
| `npm run dist:oss:selfhost`（Angular 生产构建） | **3.9 分钟** |
| 打包 | <0.1 分钟 |
| **整次构建合计** | **5.2 分钟**（run #3 实测） |

> 本地改前端**不需要跑这次构建**：`webvault/sync-source.sh` 用稀疏 + 无 blob 检出，
> 只取要改的路径，**8 秒 / 54 MB**（整份源码是 1.19 GB）。日常改代码 → 生成补丁 → 推 CI，成本很低。

| 项 | 情况 |
|---|---|
| 改前端后的反馈速度 | **约 5–6 分钟构建** + 现有部署（约 4 分钟）→ **和现在基本同一量级**，不是我原先说的"几十分钟" |
| CI 失败风险 | 从"前端零构建风险"变成"构建失败就发不出去" |
| 上游升版本 | 需要 `git apply` 我们的补丁到新版本分支，**冲突要人工处理**（编译期暴露，不会静默） |
| 仓库体积 | `warden-worker` **不增大**（源码不进这个仓库） |
| Actions 额度 | 仓库是 public → **免费** |
| 回退 | 任何时候把 `push-cloudflare.yaml` 的下载地址改回 `dani-garcia`，并恢复注入步骤即可 |

**这条实测把 (d) 的性价比明显推高了** —— 原本"改一次前端要几十分钟"是反对切换的主要理由，
实际只要 5.5 分钟。构建耗时之所以低：GitHub runner 到 GitHub 的网络极快（浅克隆几乎不耗时），
`npm ci` 有完整 lockfile 可并行，Angular 对这个规模的 monorepo 单应用构建本身不慢。

**缓解措施**：
- 构建与部署分离（§3）→ 部署速度不受影响
- 版本号钉死 + 只在主动升级时处理冲突
- 保留 `?sel=` 这类 URL 开关的做法（真机对比）
- `--local` 注入测试在 Phase 2 仍然有效（可对本地构建产物注入），不必每次都等 CI

### 顺带确认的产物一致性
- 构建日志确认：`> @bitwarden/web-vault@2026.6.4 dist:oss:selfhost` / `"Building web - OSS version"`
  → **版本与我们线上跑的一致**，构建目标正确
- 产物 **自带 `.js.map`**（日志里 30 处）→ 与 `bw_web_builds` 行为一致（它把删 map 那行注释掉了），
  部署侧 CI 照旧 `find -name '*.map' -delete`，行为不变
- 打包后 `bw_web_vault.tar.gz` 约 **35 MB**，顶层是 `web-vault/` → 与官方结构一致

---

## 7. 状态与决策

| # | 事项 | 状态 |
|---|---|---|
| 1 | Phase 0 打通流水线 | ✅ 已完成（run #3 成功，逐字节验证见 §4） |
| 2 | 补丁的组织方式 | ⚪ 曾按"一个特性一个 `.patch`"落地（`01-` / `02-`）→ **Phase 2 后已退役**，两处改动均已进 fork 源码 |
| 3 | **部署路线** | ✅ 已定：**fork 前端源到独立仓库** `shiranzby/vw_web_builds`（分支 `shypwd`），源码级定制，不再有运行时补丁层 |
| 4 | **目标版本** | ✅ 已定：**直接上最新 `v2026.8.0`**（fork 点 `a868ea0`，P1 已证明与官方同源同字节） |
| 5 | **升级策略** | ✅ 已定：跟随上游大版本，**手动触发**构建，每次升级单独一个 commit 便于回退 |
| 6 | **验证方式** | ✅ 已定：本地 `webpack serve` 热重载（`:8080`，`apps/web/config/local.json` 代理到线上）+ CI 产物断言 + 真机走查 |
| 7 | Phase 3 迁移顺序 | ⬜ 待开始（先做"移动端下拉" + "表格结构"两个重灾区，见 Phase 3） |
| 8 | **线上何时切到新产物** | ⬜ 待 P5/P6 迁完 —— 线上有真实密码数据，切换前需要一条独立验收地址 |

> 第 5 条的现实含义：钉死版本 → 上游修安全问题时拿不到；跟随 → 升版本时用 `git rebase`
> 把本地提交移到新分支上（fork 保留了共同祖先，**冲突能自动识别**，不会只能肉眼比对）。
> 折中做法（已采纳）：**跟随大版本、但手动触发**。

> 第 6 条的实操要点：`local.json` 已在 `.gitignore` 里，属于本机私有配置；
> 本地页面 + `/api/config` 代理到 `shypwd.cc.cd` 已验证可用（本机可直连该域名，无需走代理）。
