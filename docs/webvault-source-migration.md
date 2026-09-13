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

### Phase 1 — 迁移"本来就该在源码里"的改动（低风险）🔄 进行中

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
+ RUN_ID="$(gh run list --repo "${GITHUB_REPOSITORY}" --workflow=build-web-vault.yaml \
+            --status=success --limit=1 --json databaseId --jq '.[0].databaseId')"
+ gh run download "${RUN_ID}" --repo "${GITHUB_REPOSITORY}" \
+    --name "bw_web_vault-${TAG}" --dir .frontend
+ tar -xzf ".frontend/bw_web_vault.tar.gz" -C public/
```

找不到产物时**直接失败**（不会静默退回官方包 —— 那会悄悄部署成没打补丁的版本）。
回退是把这段换回 `wget` 一行 + 恢复被删的两个替换步骤。

### Phase 2 — 迁移功能层（主体工作量）
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

### Phase 3 — 拆掉 L4
- 删 `custom/`、删 CI 的 "Inject shypwd custom frontend" 步骤
- `custom/custom.js` 的部分 guard 断言（如"面板被接管为 fixed"）改为对新构建的断言
  （例如"源码里就是 `position: fixed`，不再需要运行期接管"）
- 退出条件：`custom/` 不存在，线上 guard 全绿，部署时长与迁移前相当。

---

## 5. 迁移完成后 CI 的样子（净变化：变简单）

**删掉的步骤（3 个）**：
- `Patch web vault master password minimum length`（→ 已进源码 `patches/01-`）
- index.html 里的视口替换（→ 已进源码 `patches/02-`）
- `Inject shypwd custom frontend`（Phase 3 删；现在仍需注入 `custom.css/js`，L4 还在）

第 1、2 项**已删**（Phase 1）；第 3 项要等 Phase 2 迁完 13 个功能点。

**改动的步骤（1 个）**：前端来源
```diff
- wget -q "https://github.com/dani-garcia/bw_web_builds/releases/download/${TAG}/bw_web_${TAG}.tar.gz"
+ gh run download <最新成功的 Build Web Vault run> --name "bw_web_vault-${TAG}"
```
（为什么不是 Release 资产：见 §4 的 Releases API 500 结论。）

**保留的步骤**：`*.map` 删除（Cloudflare 单文件体积限制，与构建方式无关）。

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

## 7. 待确认 / 状态

| # | 事项 | 状态 |
|---|---|---|
| 1 | **Phase 0 是否做** | ✅ 已完成（run #3 成功，逐字节验证见 §4） |
| 2 | **补丁的组织方式** | ✅ 已按"**一个特性一个 `.patch`**"落地（`01-` / `02-`） |
| 3 | **升级策略**：跟 `vaultwarden/vw_web_builds` 的节奏，还是长期钉死一个版本 | ⬜ 待定（当前钉 `v2026.6.4`，与线上一致） |
| 4 | Phase 2 的**迁移顺序**是否认可（先做"移动端下拉"+"表格结构"两个重灾区） | ⬜ 待确认 |
| 5 | **是否现在就把线上切到我们自己的产物**（改 `push-cloudflare.yaml` 那一行） | ⬜ 待确认 —— 需先跑通一次带补丁的构建并验证资产 |

> 第 3 条的现实含义：钉死 → 上游修安全问题时我们不会自动拿到；跟随 → 每次升版本要
> `git apply` 全部补丁、可能人工解冲突（**冲突在编译期暴露，不会静默**）。
> 折中做法（推荐）：**跟随大版本、但手动触发**，每次升级单独一个 PR，方便回退。
