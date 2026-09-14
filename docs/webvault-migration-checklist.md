# L4 → 源码 迁移对照清单

> 生成 2026-09-13 ｜ 对照对象：`custom/custom.js`（**1983 行**）+ `custom/custom.css`（**1279 行**）—— 两者已随 P7 退役
> **当前进度（2026-09-14）**：**P0–P7 全部完成**。源码侧共 **12 批**提交（每批都带运行期验证 + 产物级 CI 断言，现 **20 组**），
> P7 已删 `custom/`（3262 行）与 CI 注入步骤，前端切到 **`v2026.8.1`**（fork `shiranzby/vw_web_builds@shypwd`；
> `v2026.8.0` 是迁移基线，`v2026.8.1` 是第十一批起为"上线可辨识"而升的 patch 位 —— 见 §3 第十一批 ⑦）。
> 状态：⬜ 未开始 ｜ 🟡 进行中 ｜ ✅ 已完成 ｜ ~~删除线~~ = 已退役

---

## 0. 〔已过时，保留作历史〕迁移期为什么在 localhost:8080 上看不到你的功能

> ⚠️ **本节讲的是迁移期（P0–P6）的现象，现已不适用。**
> P7 已删掉注入层、线上也切到了 fork 源码构建 ⇒ **现在线上与本地 dev server 跑的是同一份源码**，
> 定制两边都在（现版本 `v2026.8.1`）。留着的价值：它解释了 L4（运行期注入）与源码层这两条链路的区别，
> 以及"为什么同一个页面在两处长得不一样"这个在迁移中途真实存在过的困惑。

迁移期的对照（**历史状态**）：

| | 线上 shypwd.cc.cd（迁移期） | localhost:8080（dev server） |
|---|---|---|
| 前端产物 | 旧：`v2026.6.4` 官方 tarball | 新：**fork 源码**实时构建 |
| L4 定制 | **有** —— 部署时注入 `custom.js` / `custom.css`（**P7 已退役**） | **没有** —— dev server 不做注入那一步 |
| 源码级定制 | 无 | 有：视口 / 密码下限 / `vaultwarden.css` |

因为定制的两条链路当时互不相通，8080 上看到的是**官方原版 UI**，而这**不代表功能丢了**：
它们当时还在 `custom/` 里、线上仍在用。

迁移的本质就是把「部署时从外面注入」改成「构建时就在源码里」。**P7 完成后 8080 上直接出现那些功能**，
且线上 `/custom.js` 与 `/custom.css` 均返回 **404** —— 注入层确已退役（见 §1 的上线记录）。

---

## 1. 阶段完成度

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** 建 fork | `shiranzby/vw_web_builds` @ `shypwd`，fork 点 = 官方 `v2026.8.0` 的 `a868ea0` | ✅ |
| **P1** 安全阀 | `VAULT_REPO` 换 fork，产物与官方**逐字节同源**（281 文件 / 272 SHA256 相同 / 总字节相同） | ✅ |
| **P2** 收编注入 | 视口 + 密码下限 + `vaultwarden.css` 进源码；`webvault/patches/` 退役 | ✅ |
| **P3** 本地热重载 | `https://localhost:8080`，改源码即时生效（已实测逐字节验证） | ✅ |
| **P4** 版本兼容评估 | 结论：**零后端改动**，新功能默认全关，UI 行为 ≈ 6.4 | ✅ |
| **P5** 迁样式类改动 | A/B/C/E/F/G/H/I/J/J2/J3/K/L/M 共 14 段 / 1248 行 | 🟡 **H+K+M 已落地**（210 行）、**F 主部 + F5 已落地**、**G 段随 J17 落地**（81 行）、**C 段筛选抽屉半边随 J9 落地**（39 行）、**A 段 + C 段「名称」表头工具行随 J7 落地**（150 行，见 §3 第五批）、**I/J/J2/J3 随第六批落地**（见 §3 第六批）、**B 段随第七批落地**（见 §3 第七批）、**E 段随第八批落地**（见 §3 第八批）、**L 整体淘汰**（J12 改走官方对话框） |
| **P6** 迁结构类改动 | TOTP 徽章 / 表头工具行 / 头像卡片 / 验证码页 / 底部标签栏 等 | ✅ **全部落地**：J12 + J8 + J17 + J9 + J14 + J7（「选择」半边）+ J10 账户卡片 + J11 二级导航 + J13 头像上传 + 4b/I 段 + J6 行内 TOTP 徽章/B 段 + J16 验证码页/E 段 + J15 ng-select 躲软键盘 + **第十批/N 段（窄屏省高度，非 L4 迁入，见 §3 第十批）** + **第十一批/O 段（窄屏体验修复 7 条，非 L4 迁入，见 §3 第十一批）** + **第十二批/P 段** + **第十三批/Q 段** + **第十四批/R 段** + **第十五批/S 段** + **第十六批/T 段**（这五批同为上线后按用户反馈做的窄屏修复，非 L4 迁入，逐批记录见 §1 里各自的「上线记录」） |
| **P7** 拆 L4 + 切线上 | 删 `custom/`、删 CI 注入步骤、切到 fork 的 `v2026.8.0` 产物 | ✅ **源码侧已完成**（`custom/` 3262 行已删、注入步骤已删并加负向守卫、`BW_WEB_VERSION` 默认改 `v2026.8.0`）；线上切换见下方说明 |

> ### ⚠️→✅ P7 前置阻塞已修（2026-09-14 定位并修复：`b981110`）
> 部署流水线（`.github/workflows/push-cloudflare.yaml`，workflow 名就叫 **`Build`**）**自 P2 起一直是坏的**：
> `02757c8` 删掉 `public/css/vaultwarden.css` 后，`public/` 下已无任何受跟踪文件，而 git 不跟踪空目录，
> 于是 CI `checkout` 后没有 `public/`，`tar -xzf .frontend/bw_web_vault.tar.gz -C public/` 报
> `tar: public: Cannot open: No such file or directory`（退出码 2）。
> 最后一次**成功**的部署是 `34745232156` @ `079f63c4c1`（v12 方案 B）；此后每次推 `main` 都在第 7 步失败。
> **即整段 P0–P6 迁移期线上从未被部署过** —— 线上一直停在 v2026.6.4 + 注入层（未被半成品污染，属不幸中的万幸）。
>
> 修复 = tar 前补 `mkdir -p public`。因推 `main` 会**自动触发部署**，相关 commit 带 `[skip ci]`，
> 切换时机用显式 `workflow_dispatch` 控制。
>
> **版本必须同时跳**：`build-web-vault.yaml` 有"`inputs.version` 必须等于 fork `apps/web/package.json` version"
> 的闸门 ⇒ 部署 fork 的 `2026.8.0` 只能产出 `bw_web_vault-v2026.8.0`，
> 故 `push-cloudflare.yaml` 的 `BW_WEB_VERSION` 默认值同步改为 `v2026.8.0`（此前 pin 的 `v2026.6.4` 已失效）。
> **"删注入层"与"前端 6.4 → 8.0 跳版"是同一动作，拆不开**；详见 §5 迁移顺序与 `docs/webvault-source-migration.md`。
>
> **回滚路径**：`git revert` P7 提交 + 把 `BW_WEB_VERSION` 改回 `v2026.6.4` + 重跑 `Build`（约 3–4 分钟）。
>
> ### ✅ 上线记录（2026-09-14）
> | 步骤 | 结果 |
> |---|---|
> | `b981110` fix(ci): 补 `mkdir -p public` | 已推 `fork/main`（带 `[skip ci]`，未触发部署） |
> | `a0a2b10` refactor(webvault): P7 | 已推 `fork/main`；`-3307 / +52` |
> | `build-web-vault` dispatch `version=v2026.8.0` | run **`34790935707`** success → artifact `bw_web_vault-v2026.8.0` @ `2026-09-13T23:56:35Z`（成为最新，部署侧取它；**17 组断言全过 = 产物确含全部 9 批**） |
> | `push-cloudflare` dispatch（workflow 名 `Build`） | run **`34791143696`** success（**这是 P2 以来第一次成功的部署**） |
>
> **线上验证（`https://shypwd.cc.cd`，8/8 + 浏览器 6/6 全过）**：
> - `vw-version.json` = `2026.8.0`（页脚也显示 "Vaultwarden Web 2026.8.0"）
> - **`/custom.js` 与 `/custom.css` 均返回 404**，`index.html` 不含任何 `custom.*` 引用 ⇒ 注入层确已退役
> - 定制本体仍在：`.warden-headbar` / `.warden-select-toggle` / `.warden-selectable`（J7+A 段）、
>   `warden-tabbar`（J17）、`warden-subnav`（J11）、`warden-acctcard`（J10）、
>   `warden-totp-code`（J6）、`warden-authview`（J16）、`visualViewport`（J15）、`css/vaultwarden.css`
> - 负向：`warden-sel-mode` / `sel=above` / `MutationObserver` 均为 **0 次**（L4 绕路代码无残留）
> - 浏览器：`app-root` 正常挂载、title `Vaultwarden Web`、窄屏 375px 无横向溢出、
>   `meta viewport = width=device-width,initial-scale=1,viewport-fit=cover`、**无 console/pageerror**

> ### ✅ 上线记录 · 第十批 / N 段（窄屏省高度，2026-09-14）
> 用户确认后按「先 build 后 deploy」执行两条 workflow，**均一次通过**：
>
> | 步骤 | run | 结果 | 耗时 |
> |---|---|---|---|
> | `Build Web Vault (patched)`（`version=v2026.8.0`） | **`34794128650`** | success | **约 6 分钟** |
> | `push-cloudflare` dispatch（workflow 名 `Build`） | **`34794445635`** | success | **约 5 分钟** |
>
> 构建侧关键关卡都过了：步骤 7 `Verify version matches the source`（版本闸门，证明确实拉的是
> fork `shypwd` = `bed28439be`）、步骤 11 `Verify our customizations are in the built artifact`
> （**18 组断言全绿 = 定制确已进产物**）。
>
> **线上验证（27/27 PASS，脚本打线上：`WARDEN_TEST_BASE=https://shypwd.cc.cd` +
> `WARDEN_TEST_PROXY=http://127.0.0.1:7890 node .deploycheck/verify-batch10.mjs`）**：
> - asset 哈希 `main.682291b8…` → **`main.bcbe594e8d36993f0697.js`**（"真的换了产物"的硬证据）
> - `/app/main.bcbe594e…js`（5.4MB）含 `warden-head-new` / `newItemDropdown` / `filters-header` /
>   `warden-headbar` / `addItemCoachmark`×2 / `vault-new-cipher-menu`×3
> - `/css/vaultwarden.css`（58KB）含 `窄屏省高度` / `warden-head-new`×5 / `filters-header`×2
> - 窄屏页头 **16px**、桌面 **93px**；「新增」垂直中心 320 ∈「名称」表头 [298,343]；
>   `新增.right 139 ≤ 选择.left 159`；筛选标题行隐藏且搜索/开关都在（开关展开 6/6）；
>   列表「新增」菜单 6 项；两处 coachmark 各 1 个；无横向溢出；**hard error 0**
> - `/custom.js`、`/custom.css` 仍 **404**（注入层退役状态保持）
>
> ⚠️ **`vw-version.json` 仍是 `2026.8.0`，与部署前相同** —— 同版本号重新构建时该文件不变，
> **不能拿它当"有没有部署"的判据**。判据是「run 列表 build+deploy 都 success」+「asset 哈希变了」。
>
> ⚠️ **验线上产物别取错路径**：主包在 **`/app/main.<hash>.js`**，`/main.<hash>.js` 不存在，
> Worker 会回 **SPA 的 404 HTML**（约 23KB，`<title>Page not found | Bitwarden Web vault</title>`），
> 于是 `grep -c` 得 0 —— 看起来像定制没上线，其实是下错了文件。**先看 `%{http_code} %{size_download}`**。
> `vaultwarden.css` 也不在 `styles.<hash>.css` 里，而是首页单独 `<link href="css/vaultwarden.css">`。
>
> **回滚**：`git revert` fork 的 `bed28439be` + 重跑 `Build`（版本号不用动）。

> ### ✅ 上线记录 · 第十一批 / O 段（窄屏体验修复，2026-09-14）
> **本批首次引入「版本号升 patch 位」**：前端 `2026.8.0 → 2026.8.1`（三处联动，见 §3 第十一批 ⑦）。
> 用户确认部署后按「先 build 后 deploy」执行，**两条 workflow 最终均 success**：
>
> | 步骤 | run | 结果 | 耗时 | 备注 |
> |---|---|---|---|---|
> | `Build Web Vault (patched)`（`version=v2026.8.1`） | `34797228137` | ❌ **failure** | 5m38s | 第 11 步断言挂了 —— **是 CI 自己的 bug，不是产物**（见下） |
> | ↳ 同一批重复触发的两个 run | `34797231349` / `34797236745` | ⏹ cancelled | — | curl 重试导致重复 dispatch，已取消（见下） |
> | `Build Web Vault (patched)`（重跑） | **`34797593160`** | ✅ success | **4m04s** | 第 11 步 **19 组断言全绿** → artifact `bw_web_vault-v2026.8.1`（`10329784092`，35.7MB） |
> | `push-cloudflare` dispatch（workflow 名 `Build`） | **`34797836955`** | ✅ success | **4m43s** | |
>
> - 前端源码：fork `shypwd` = **`0409832f46`**（`633854e640` 是功能提交，本提交只升版本号）；
>   warden-worker `main` = **`3525d20`**（含 CI 修复）。
> - **线上验证**：`vw-version.json` **`2026.8.0` → `2026.8.1`**（版本号本身就是上线判据，本批起不再需要靠哈希推断）；
>   主包 **`app/main.bcbe594e8d36993f0697.js` → `app/main.139cd3d409a45b32bba3.js`**（5.48MB）；
>   `/css/vaultwarden.css` 72KB，7 个 O 段标记的**出现次数与本地源码逐项相同**（9/3/2/6/5）；
>   `/custom.js`、`/custom.css` 仍 **404**（注入层退役状态保持）；L4 残留标记 `warden-sel-mode` = 0。
> - **线上运行时 56/56 PASS**（同一个脚本，只换目标：
>   `WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 node .deploycheck/verify-batch11.mjs`），
>   读数与本地完全一致；**线上 CSP 噪声 0 条**（本地是 4 条，见第十批 ⑥ 的同一解释）。
>
> #### 🔴 本批部署时踩的两个"操作类"坑（都不是产品问题，但各烧掉一轮/制造了脏数据）
> 1. **`--retry-all-errors` 让 dispatch 重复触发** —— 一次调用触发出了 **3 个并发 build run**。
>    根因：本机 Git Bash 下 `curl -o /dev/null` 返回 **exit 23（写数据失败）**，而 `--retry-all-errors`
>    把"任何错误"都当可重试 ⇒ **非幂等的 POST 被重试**。curl 还报 `HTTP 204`（第一次确实成功了），
>    **表面完全看不出来**，只有查 run 列表才发现跑了三份。处置：`cancel` 掉多余的两个（返回 202）。
>    **正确写法**：去掉 `--retry-all-errors`（只留 `--retry 3`，它只重试 5xx/429/超时），且别用 `-o /dev/null`。
> 2. **`grep -qF "$pat"` 当 `$pat` 以 `-` 开头时会被当成选项** —— 第一次 build 就挂在这一个字符上：
>    `grep -qF "--warden-safe-bottom" .vw.css` → `grep: unknown option -- warden-safe-bottom`（exit 2）
>    ⇒ `||` 分支触发，打印"❌ 产物里找不到该标记"，**现象与"标记真的没进产物"一模一样**。
>    而同批其余 6 个标记都以 `.` 开头、全部通过，只有这一条挂。**规矩：一律写 `grep -qF -- "${lit}"`**。
>    > ★ 更值得记的是**为什么本地预演没抓到**：我手写的预演命令用了 `grep -cF -- "$lit"`（**带了 `--`**），
>    > 而 workflow 里漏了 ⇒ **预演的必须是"从 workflow 抽取的命令原文"，不能自己手打一份等价的** ——
>    > 手打时人会下意识补全正确写法，正好把要验的缺陷抹掉。
>    > 另：**CI 失败要拉 job 日志看"真正的输出行"** —— 日志前半是脚本源码回显，需 `grep -v 'echo '`
>    > 才能筛出真正的 `❌`（`##[error]Process completed with exit code 1` 只告诉你"失败了"）。
>
> **回滚**：`git revert` fork 的 `633854e640` 与 `0409832f46` + `BW_WEB_VERSION` 改回 `v2026.8.0` + 重跑 `Build`。

---

> ### ✅ 上线记录 · 第十二批 / P 段（搜索框 ↔ 筛选按钮 等高，2026-09-14）
> 版本号 `2026.8.1 → 2026.8.2`（沿用"升 patch 位让版本号自己成为上线判据"的做法）。
>
> | 步骤 | run | 结果 | 耗时 | 备注 |
> |---|---|---|---|---|
> | `Build Web Vault (patched)`（`version=v2026.8.2`） | **`34801588759`** | ✅ success | **5m46s** | 第 10 步 **20 组断言全绿** → 说明第 20 组的判据在**真实产物**上成立 |
> | `push-cloudflare` dispatch（workflow 名 `Build`） | **`34801965160`** | ✅ success | **4m02s** | |
>
> - 前端源码：fork `shypwd` = **`e0a1f1a230`**（单文件 CSS 改动 + 版本号）；
>   warden-worker `main` = **`2ca708b`**（CI 第 20 组 + 两处版本默认值）。
> - **线上验证**：`vw-version.json` = **`2026.8.2`**；`/css/vaultwarden.css` 里那条规则已经是
>   `padding-left: 12px !important` / `padding-right: 12px !important`，
>   旧的 `padding: 0 12px` **在该规则块内已消失**。
> - **线上运行时 8/8 PASS**（`verify-batch12.mjs`）+ **第十一批回归 56/56 PASS**，
>   读数与本地**完全一致**（搜索框 40px / 按钮 40px，Δ=0）；**线上 0 console error、0 CSP 噪声**。
> - 用 3 步 dispatch（只留 `--retry 3`，不用 `-o /dev/null`）⇒ **只触发 1 个 run**，没有再出现上批的重复触发。
>
> **回滚**：`git revert` fork 的 `e0a1f1a230` + `BW_WEB_VERSION` 改回 `v2026.8.1`（+ 同步 lock 与
> `inputs.version` 默认值），再重跑 `Build`。

---

> ### ✅ 上线记录 · 第十三批 / Q 段（设置页间距/换行 + 下拉面板跟随，2026-09-14）
> 版本号 `2026.8.2 → 2026.8.3`（沿用"升 patch 位让版本号自己成为上线判据"的做法）。
> 本批 6 条全部来自用户对移动端的反馈，与第十/十一/十二批同理：**不是 L4 迁入的**。
>
> | 步骤 | run | 结果 | 耗时 | 备注 |
> |---|---|---|---|---|
> | `Build Web Vault (patched)`（`version=v2026.8.3`） | **`34806871484`** | ✅ success | **5m39s** | 第 10 步 **21 组断言全绿**（本批新增第 21 组） |
> | `push-cloudflare` dispatch（workflow 名 `Build`） | **`34807213844`** | ✅ success | **4m13s** | |
>
> - 前端源码：fork `shypwd` = **`3f26c76552`**（8 文件：1 个组件 TS + 1 个指令模板 + 3 个设置页 + CSS + 版本号）；
>   warden-worker `main` = **`0734cec`**（CI 第 21 组 + 两处版本默认值 + 收录 `verify-batch13.mjs`）。
> - **线上验证**：`vw-version.json` = **`2026.8.3`**；主 JS 哈希 `de1a601412da6aad9dd9` →
>   **`aa965e2a7f4296dfc944`**（线上资产确实换了）；`/css/vaultwarden.css` 76603 B **与本地产物逐字节同尺寸**，
>   内含 `Q. 第十三批` / `.warden-ea-head` / `app-profile .tw-grid` / `app-danger-zone > h1.tw-mt-16`；
>   线上 `main.js` 里 `warden-ea-head` **1 次**、`attributeFilter:["style"]` **2 次**（`v2026.8.2` 基线**都是 0**）。
> - **线上运行时 22/22 PASS**（`verify-batch13.mjs`，读数与本地**完全一致**：面板 gap −508px、两处留白 8px、
>   textarea 30→40px、紧急访问标题 1 行 h=36px / 按钮 h=40px）；
>   另 **0 console error / 0 page error / 0 CSP 违规**（本批大量走 CSSOM 行内几何，专门体检过）。
> - 用 3 步 dispatch（只留 `--retry 3`，不用 `-o /dev/null`）⇒ **只触发 1 个 run**；
>   push `main` 的那次**带 `[skip ci]`**（改 workflow 版本默认值时 artifact 还不存在，自动部署必挂）。
>
> **回滚**：`git revert` fork 的 `3f26c76552` + `BW_WEB_VERSION` 改回 `v2026.8.2`（+ 同步 lock 与
> `inputs.version` 默认值），再重跑 `Build`。

---

> ### ✅ 上线记录 · 第十四批 / R 段（移动端第二轮反馈 10 条，落地 9 条，2026-09-14）
> 版本号 `2026.8.3 → 2026.8.4`。与第十~十三批同理：**不是 L4 迁入的**，全部来自用户对移动端的反馈。
> 用户明确"2a/2b/2c/4/6 已 OK"，本批只动 1/3/5/7/8/9/10a；**10b(Authenticator 显示下一代码)只出方案，未实现**。
>
> | 步骤 | run | 结果 | 耗时 | 备注 |
> |---|---|---|---|---|
> | `Build Web Vault (patched)`（`version=v2026.8.4`） | **`34826968072`** | ✅ success | **5m35s** | 第 10 步 **22 组断言全绿**（本批新增第 22 组） |
> | `push-cloudflare` dispatch（workflow 名 `Build`） | **`34827505769`** | ✅ success | **4m49s** | |
>
> - 前端源码：fork `shypwd` = **`da0f316a6a`**（5 文件：`select.component.{ts,html}` + CSS + 版本号两处）；
>   warden-worker `main` = **`9785d67`**（CI 第 22 组 + 两处版本默认值 + 收录 `verify-batch14.mjs` 与
>   `probe-audit-guards.py`）。
> - **线上验证**：`vw-version.json` = **`2026.8.4`**；主 JS 哈希 `aa965e2a7f4296dfc944` →
>   **`3d3a80b553fea673c01e`**（5480529 B）；`/css/vaultwarden.css` **83455 B 与本地源码逐字节 `cmp` 一致**，
>   内含 `R. 第十四批` / `.warden-select-open` / R1/R4/R5/R6 四条选择器；线上 `main.js` 里
>   `warden-select-open` **1 次**。
> - **线上运行时 14/14 PASS**（`verify-batch14.mjs`，读数与本地**完全一致**：8 个下拉全部"点箭头展开/再点收起"、
>   输入框壳与按钮同高 40px、product-switcher `display:none`、页头新增隐藏且可见新增=1、
>   聚焦后 box-shadow 仍 `none` 而 1px 边框保留、三处留白 8/16/16px）；**0 page error**。
> - 用 2 步 dispatch（只留 `--retry 3`）⇒ **只触发 1 个 run**；push `main` 那次**带 `[skip ci]`**。
>
> #### 🔴 本批两个必须记住的教训
>
> 1. **问题1/3 的真根因是"signal 当布尔用"**：`NgSelectComponent.isOpen` 在 ng-select v21 是
>    `ModelSignal<boolean>`(**函数**)，`if (ngSelect.isOpen) close() else open()` 恒为真 ⇒ 永远只 close()，
>    面板永远打不开。**而模板里那个 class 照样在产物里**（静态 grep 看不出来）。现已改为直接调组件自己的
>    `toggle()`。⇒ **凡"是值还是信号"分不清的 API，先查 `.d.ts` 再写**。
> 2. **CI 负向守卫差点是"哑弹"**：第一版写成 `grep -qE '^main#main-content app-header product-switcher'`，
>    **漏抄真实规则里的 `header` 一词** ⇒ 永远不匹配。离线证伪（把规则从 @media 内提成顶格，即制造
>    它本该拦住的那次误改）时**照样通过**。现改为"守卫字面量复用正向数组 + `grep -nF` 判 `行号:` 后是否
>    紧跟非空白"，并已**逐条证伪 6/6**。⇒ **每加一条负向守卫，提交前必须离线证伪一次**；
>    审计脚本 `.deploycheck/probe-audit-guards.py` 已入库（它能区分"真哑弹"和"禁止出现类常态守卫"）。
>
> #### 📐 问题 10b（Authenticator 显示「下一代码」）：本批**只出方案 + 渲染图**，未动源码
>
> 交付物（都在 `.deploycheck/mockups/`，**不入库**，属交付件不是资产）：
> `R10b-方案说明.md`、`b14-totp-next-code.html`（可交互：实时倒计时、`#ff`/`#ff2`/`#ff0` 跳剩余
> 12/3/0 秒、`#theme` 切深浅色、`#pause` 冻结）、`smoke-b14-mockup.mjs`（冒烟+证伪入口）、
> `shot-b14-mockup.mjs`（出截图）、3 张 PNG。
>
> - **能不能做：能做，且不用自己实现 TOTP。** 关键是 Rust SDK 的
>   `sdk.vault().totp().generate_totp(key, time_ms?: number|null)` **自带时间戳参数**
>   —— 推一个"下一窗口内"的 `time_ms` 就得到下一代码。**不要**照 L4（`custom.js` §6）自己写
>   RFC 6238：重复实现加密算法，且拿不到 SDK 对 Steam/URI 的特例处理。
>   推荐改法：抽象里**新增** `getNextCode$(key)`（`getCode$` 一行不改 ⇒ 现有调用零影响），
>   且**只在 `sec ≤ 10` 时才订阅次码流** ⇒ 稳态算力与现状一致。
> - **主次/排版**：主码 13px 品牌蓝**完全不变**；次码 11px 灰 + 10px 标签「下一个」，在**下方**，
>   仅 `sec ≤ 10` 淡入（`opacity` + 上移 4px，0.22s 延迟 0.05s），徽章 96×46 → 112×64（0.25s），
>   列表行只下沉 18px；转红阈值仍是 **≤5s**（"出现次码 10s" 与 "转红 5s" 是两个独立阈值）；
>   归零**升格**：次码文本变新主码并做 `flash`，次码行 `nudge` 一闪（让"换字"读得出来）后淡出。
> - **渲染图是自证的**：`smoke-b14-mockup.mjs` **6/6 + 3b 全绿**，其中最硬的一条是
>   **"旧次码 === 新主码"**（按 `#ff0` 驱动）；并**离线证伪两轮**：注入"毫秒/秒混用"⇒ 判据 2/5/6/3b 变红、
>   注入"次码算成主码"⇒ 判据 3/5/6 变红。**证伪还揪出一条哑弹**（见下）。
> - **待用户拍板 3 点**：① 10s 内徽章变宽 16px / 行下沉 18px 是否接受（否则用"零抖动"变体 B：
>   次码绝对定位浮在徽章下沿、盒体尺寸不变）；② 次码要不要「下一个」文字标签（不要可窄到约 104px）；
>   ③ 次码要不要也可点击复制（默认不做）。**拍板前不动源码。**
>
> #### 🔴 本批第三个教训（渲染图/交付件专用）
>
> **断言跑出"有红"不算过关，要盯"到底哪一条抓到的"。** 判据 6 原写成"连点后 `step` 是安全整数"，
> 而注入的 bugA 是**单次赋值**的单位错误、根本不会溢出 ⇒ 它当时**不报警**（哑弹）。
> 已改为断"跳转后 `rem` 必须精确落在目标值"—— 那才是双重记账漂移的直接症状。
> 另：**截图前必须等 CSS 过渡落定**（进度条 `0.45s` + 延迟 `0.45s` ⇒ 等 1.4s），
> 否则截到半截动画，看起来像"排版坏了"。
>
> **回滚**：`git revert` fork 的 `da0f316a6a` + `BW_WEB_VERSION` 改回 `v2026.8.3`（+ 同步 lock 与
> `inputs.version` 默认值），再重跑 `Build`。

---

> ### ✅ 上线记录 · 第十五批 / S 段（移动端第三轮反馈 4 组，全部落地，2026-09-14）
> 版本号 `2026.8.4 → 2026.8.5`。同前十~十四批：**不是 L4 迁入的**，来自用户对移动端的反馈。
> 本批含**问题 1 的重做**（第十四批 R 段的做法被用户否掉）与**问题 10b 的落地**（上一批只出方案）。
>
> | 需求（用户原话要点） | 落法 |
> |---|---|
> | **问题1**「点输入会弹输入法…点箭头展开后再点箭头关不掉」 | 窄屏把下拉改成**纯选择器**：输入框 `readOnly`、不再可搜；点**整块表单**展开/收起 |
> | **问题5b** 自定义域名输入框 placeholder 没有相对框高居中 | 窄屏 `textarea[bitInput]` 撑到 32px + `line-height: 32px` |
> | 验证码页「验证码」/ 发送页「Send」/ 报告页「报告」三处左上角标题可去掉以省高度 | 窄屏 **CSS 隐藏**（不删模板），发送/报告页加页级钩子类 `warden-bare-header` |
> | **问题10b** 次码「新主码渐变显示、原主码上移；到时新主码上移变色、原主码上移淡出」；**进度条 0.3s 归零重跑与之同步**；**次码不带「下一个」文字、不可点击复制** | 盒内三行 `.digits/.next/.ghost` 靠位移+透明度；**徽章尺寸零变化** |
>
> | 步骤 | run | 结果 | 耗时 | 备注 |
> |---|---|---|---|---|
> | `Build Web Vault (patched)`（`version=v2026.8.5`） | **`34836189914`** | ✅ success | **5m31s** | 第 11 步 **23 组断言全绿**（本批新增第 23 组） |
> | `push-cloudflare` dispatch（workflow 名 `Build`） | **`34836706375`** | ✅ success | **4m41s** | 第 8 步 `Verify frontend is our patched build (fail hard)` 绿 |
>
> - 前端源码：fork `shypwd` = **`fe2b21a7df`**（两个提交：`ea8e8f42b5` 功能 + `fe2b21a7df` 修 lint-staged 引入的编译错误）；
>   warden-worker `main` = **`3c52f67`**（CI 第 23 组 + 四处版本默认值 + 收录 `verify-batch15.mjs`）。
> - **线上取证**：`vw-version.json` = **`2026.8.5`**；主 JS 哈希 `3d3a80b553fea673c01e` →
>   **`cbd08d29774762b2d296`**（5482582 B）；线上 `/css/vaultwarden.css` **91008 B 与 fork 源码逐字节 `cmp` 一致**；
>   线上 `main.js` 里 `(max-width: 768px)` 1 次、`warden-totp-next`/`-ghost` 各 1 次、`warden-totp-rolling` 2 次、
>   `warden-bare-header` 2 次。
> - **线上运行时 31/31 PASS**（`verify-batch15.mjs`，读数与本地一致）：① 窄屏 `readOnly=true` ⇒ 不弹键盘；
>   ② R 段热点按钮窄屏 `display:none`；③ 点输入框**左侧非箭头区**即展开；④ 面板 `position:fixed`；
>   ⑤ **面板底 229 ≤ 底栏顶 781**；⑥ 再点同一处收起；⑦ 视口压到 320px（下方可用 94px < 上方 129px）时**向上展开**且不出屏；
>   ⑨–⑬ 三处标题 `display:none` 且页头高 **0px**；⑭⑮ placeholder 中心偏差 **0px**；
>   ⑯–㉕ TOTP：>10s 次码 `opacity=0`、无「下一个」标签、≤10s 淡入 `0.92`、
>   **徽章 `96×46` 三个时刻恒等（零抖动）**、升格帧捕获、进度条过渡实测 **0.3s**、
>   **旧次码 === 新主码（`121499 → 121499`）**；㉖㉗ 桌面端 `readOnly=false` 且热点按钮仍在；㉘ **0 pageerror**。
> - 2 步 dispatch（只留 `--retry 3`）⇒ 各**只触发 1 个 run**；推 `main` 那次带 `[skip ci]`（已核 run 列表无新增自动部署）。
>
> #### 🔴 本批四条必须记住的教训
>
> 1. **`pre-commit` 的 `eslint --fix` 会产出编译不过的代码 ⇒ 构建验证必须落在"提交之后"的源码上。**
>    仓库的 `@bitwarden/components/enforce-readonly-angular-properties`（`eslint.config.mjs` 里配
>    `onlyOnPush: true`，**只作用于 `*.component.ts` 的 OnPush 组件**）强制"所有类属性必须 readonly"，
>    却**不区分该属性是否会被重新赋值**；`--fix` 直接给 `previousDigits`/`lastStep`/`rollTimer` 补 `readonly`
>    ⇒ `npm run dist:oss:selfhost` 报 **4 个 TS2540**（本地构建与 CI 都会挂）。
>    现象上最迷惑的一点：**提交前那次构建是通过的**（webpack 生产配置无 `cache`，每次全量类型检查 ⇒ 排除"缓存掩盖"），
>    提交后被 lint-staged 改写才坏。修法照仓库既有先例（`libs/vault/.../date-field-group.component.ts`）
>    **逐行 `eslint-disable-next-line`**，而不是把字段改成 signal（信号语义不符，且要引入 `untracked()` 防自触发）。
> 2. **问题1 的真修法是"把 `searchable` 关掉"，不是"再叠一层触摸热区"。**
>    `NgSelectComponent.handleMousedown()` 的判据是 `if (searchable) open() else toggle()`
>    ⇒ `searchable=true` 时**再点只会 `open()`**（已展开就是空操作）⇒ 用户遇到的"点箭头关不掉"是必然的；
>    而 `searchable=false` 时输入框本身变 `readOnly`（**顺带解决了"点输入框弹软键盘"**），整块表单点击即 `toggle()`。
>    ⇒ 第十四批那个覆盖箭头位置的透明 `<button>`（`.warden-select-open`）在窄屏**反而有害**：
>    它是 `<ng-select>` 的**兄弟**节点，ng-select 判"外部点击"只比 `_select.contains(target)`
>    ⇒ 按它会被判成"点了外面"，跟它自己那次 toggle 打架。窄屏已 `display:none`（桌面端保留）。
> 3. **"面板不得覆盖底栏"只能靠几何避让，不能靠 z-index。** M 段把 `.ng-dropdown-panel` 钉在
>    `z-index: 2400`（为了压过 cdk 的 2050），底栏只有 60 ⇒ 想用 z-index 让底栏盖住面板，
>    就得把面板降到 cdk 之下，对话框会跟着一起坏。故在 `applyGeometry()` 里**先减掉 `#warden-tabbar` 的高度**
>    再算"下方可用空间"（同时它也是"向下展开还是向上展开"的判据输入）。
> 4. **离线证伪本身也会骗人：`bash -c "<29KB 多行脚本>"` 在本机 MSYS 版 bash 下会被截断。**
>    表现是脚本跑到一半就结束、`fail` 仍为 0 ⇒ **退出码 0**，看起来像"负向守卫是哑弹"；
>    而把同一个脚本落成文件再跑却是 `exit=1` + 正确文案。⇒ 证伪必须**把脚本落盘再跑**（也正是 CI 的实际形态）。
>    最终 3 条 S 段 + 6 条 R 段守卫**逐条证伪 9/9 有效**（`probe-s15-guard.py`，已入库）。
>    ⚠️ 途中还发现"证伪的正则"会漏掉**多行选择器列表**（`...focus-within,` 换行后才跟 `{`）——
>    那是探针的局限，不是 CI 缺口（CI 用 `grep -nF` 判 `行号:` 后是否紧跟非空白，与 `{` 在哪一行无关）。
>    📌 第十六批补记**同一个坑的另一个面孔**：断言脚本涨到 33KB 后，Python 侧
>    `subprocess.run(["bash", "-c", script])` 在 Windows 上直接抛
>    `OSError: [WinError 206] 文件名或扩展名太长` —— 这次连跑都没跑起来（不是截断）。
>    `run-artifact-asserts.py` 已改成**先落盘再 `bash <file>`**，与 CI 的 `run: |` 同形。
>    ⇒ 一句话：**凡是要把长脚本交给 shell，一律落盘，别走命令行参数。**
>
> **一处有意为之的差异（留给将来）**：次码/升格那一组 CSS（`.warden-totp-next`/`-ghost`/`-rolling`
> 与两条 `@keyframes`）**刻意写在全局**而不是窄屏 `@media` 里 —— 徽章是桌面端与窄屏**共用**的组件，
> 且全程不动盒体尺寸，桌面端跟着一起升级是有意为之。故此 5 条**不参与**负向守卫（`continue` 跳过）。
>
> **回滚**：`git revert` fork 的 `ea8e8f42b5` + `fe2b21a7df` + `BW_WEB_VERSION` 改回 `v2026.8.4`
> （+ 同步 lock 与 `inputs.version` 默认值），再重跑 `Build`。

---

> ### ✅ 上线记录 · 第十六批 / T 段（移动端第四轮反馈 3 条，全部落地，2026-09-14）
> 版本号 `2026.8.5 → 2026.8.6`。依旧**不是 L4 迁入**，来自用户第四轮移动端反馈。
> 本轮三条里两条是**上一批遗留的真 Bug**（问题 2、问题 3 都栽在"上批的修法只对了一半"），一条是**上批做法被证伪后重做**。
>
> | 需求（用户原话要点） | 根因 | 落法 |
> |---|---|---|
> | **问题1**「到点后新主码上移居中并由灰变蓝，上移后会**先变回原主码、再闪一下**才成新主码」 | `totp.service` 用 `Math.round(Date.now()/1000)` 算 `sec`，比 TOTP 真实的 `floor(now/period)` **提前约 0.5s** 越过 `sec===period` ⇒ 动画先按"旧码"起跑，`digits` 后到才纠正 ⇒ 中段闪回 | ① `Math.round` → **`Math.floor`**（与 TOTP 窗口对齐）；② 徽章 `effect()` 的**换窗判据从"时钟 `step` 变了"改成"`digits` 值变了"** ⇒ 动画第一帧拿到的就是新码 |
> | **问题2**「所有可选项展开都展不开了，只有点下去方框下浅灰一层动画效果就没了」 | 窄屏 R 段那个装在 `<ng-select>` **兄弟位置**的透明热点按钮 `.warden-select-open`：ng-select 判"外部点击"只比 `_select.contains(target)` ⇒ **按它会被判成"点了外面"**，与它自己那次 toggle 打架 ⇒ 展开一次立刻被 `outsideClick` 关掉 | **删掉这个兄弟按钮**，改在包住 `<ng-select>` 的 `<div class="tw-relative tw-w-full">` 上挂 `(pointerdown)`：此时 `target` 必在 `_select` 内，不再被判外部；`onFieldPointerdown` **只对窄屏生效**（`if (!narrow() || disabled) return`），避开宽屏箭头带与输入框聚焦 |
> | **问题3**「自定义域名居中修好了，但右侧减号按钮没居中、高度没和左侧输入框一行对齐」 | 行容器靠 `align-items: center` 居中时，左列（label + 32px 输入框）比右侧纯图标按钮高 ⇒ 两者视觉中心不齐 | 行加页级钩子 `.warden-domain-row`，窄屏改为 **`align-items: flex-end`** + 清掉 `<bit-form-field>` 的 `margin-bottom` ⇒ 按钮底边贴输入框底边（实测按钮 `cy=231` vs 输入框 `cy=230`，残差 **1px**） |
>
> | 步骤 | run | 结果 | 耗时 | 备注 |
> |---|---|---|---|---|
> | `Build Web Vault (patched)`（`version=v2026.8.6`） | **`34844777309`** | ✅ success | **5m33s** | 断言步骤 **24 组全绿**（本批新增第 24 组 T 段；R 段 `.warden-select-open` 由正向断言**改成负向**） |
> | `push-cloudflare` dispatch（workflow 名 `Build`） | **`34845454752`** | ✅ success | **5m25s** | **18/18 步**；第 8 步 `Verify frontend is our patched build (fail hard)` 绿 |
>
> - 产物：`bw_web_vault-v2026.8.6`（artifact id `10347717756`，**35.8 MB**）。
> - 前端源码：fork `shypwd` = **`e8326b216af`** `e8326b216ae039820ebb7d4ab795e81b28bc8f0f`；
>   warden-worker `main` = **`d26b797`**（CI 第 24 组 + 四处版本默认值 + 收录 6 个 T 段探针 + 2 个引擎/线上探针）。
> - **线上取证**（走 `-x http://127.0.0.1:7890`）：`vw-version.json` = **`2026.8.6`**；
>   主 JS 哈希 `cbd08d29774762b2d296` → **`05a80cbf7e5dc88d0603`**（`5482423 B`，上版 `5482582 B`）——
>   **asset 哈希变了 = 部署生效最硬的证据**；线上 `/css/vaultwarden.css` **95557 B**（上版 91008 B）
>   与 fork 源码 **逐字节 `cmp` 一致**（原样拷贝、不压缩）。
> - **产物级标记**（线上 `main.js`）：`warden-domain-row` **2** 次；`Math.floor(Date.now()/1e3)` **1** 次；
>   `Math.round(Date.now()/1e3)` **0** 次（旧写法已绝）；`warden-select-open` **0** 次（已退役）。
>   线上 `vaultwarden.css`：`移动端第四轮反馈` 1 次、`align-items: flex-end !important` 1 次；
>   `warden-select-open` 剩余 **2 处均在"已退役"注释里**（无生效规则）。
> - **线上运行时 14/14 PASS**（`probe-b16-live.mjs`，真站 + 代理 + 移动视口 390×844 + 触摸）：
>   ① 外观页 2 个 `bit-select`；② 轻点→展开（3 选项、首项高 37px）；③ 再轻点→收起；
>   ④ 展开后 **0~600ms 无"关闭帧"**；⑤ 域名行 `alignItems=flex-end`；⑥ 输入框仍 **32px**（S2 居中未被 T 段带坏）；
>   ⑦ 按钮 `cy=231`(40px) vs 输入框 `cy=230`(32px)；⑧ TOTP 升格**第一帧主码即新码**（`f0="075 400"`=N），
>   `f0.ghost` 即旧码（`"866 984"`=C）；⑨ 14 帧内**无 `ghost===digits`**；⑩ 主码行**从未退回旧码**；⑪ **0 pageerror**。
> - **本机复验**（dev server 8099，慢放 + WebKit 双引擎）：`probe-b16-select-postfix.mjs` **10/10**（含宽屏 4 项桌面行为不变）；
>   **`probe-b16-select-webkit.mjs` 8/8**（WebKit≈iOS Safari —— **Chromium 复现不出的触摸路径**用它兜底）；
>   `probe-b16-totp-roll.mjs` **6/6**；`probe-b16-notes.mjs` **6/6**（S2 收窄未误伤备注框，仍 54px）；
>   `falsify-b16.py` **5/5**（离线证伪：把 5 处改动改回去，守卫必须报错 ⇒ 证明守卫不是哑弹）。
> - 2 步 dispatch（只留 `--retry 3`）⇒ 各**只触发 1 个 run**；推 `main` 那次带 `[skip ci]`（已核 run 列表无新增自动部署）。
>
> #### 🔴 本批四条必须记住的教训
>
> 1. **"元素在不在 `<ng-select>` 里"是 ng-select 外部点击判定的唯一判据 —— 覆盖层/兄弟按钮都会被判成"点外面"。**
>    `.warden-select-open` 是 `<ng-select>` 的**兄弟**节点，再"盖在箭头上"也没用：`_checkToClose()` 里
>    `if (!this._select.contains(target) && !this._dropdown.contains(target)) outsideClick.emit()` 一命中，
>    面板就被 `NgDropdownPanelComponent` 的 `(outsideClick)="close()"` 关掉。真修法是让**点击目标落在内部**
>    （包一层 `<div>` 挂 `pointerdown`），而不是"再加一个热区"。
> 2. **`Math.round(Date.now()/1000)` 用在 TOTP 上是错的，会自相矛盾。** TOTP 窗口是 `floor(now/period)`；
>    用 `round` 会让"进度条归零"比"`digits` 换值"**早约半秒**发生 ⇒ 动画先按旧码起跑、随后 `digits` 到才纠正，
>    用户看到的就是"上移后先变回原码、再闪一下"。**判据要么就 `floor`，要么更稳：直接监听 `digits` 值本身有没有变**
>    （本批即把换窗判据从时钟 `step` 改为 `digits` 变化，彻底不依赖时钟精度）。
> 3. **修 A 功能的 CSS 选择器，先问一句"这条选择器还命中谁"。** S2 那条为了给域名输入框扩高，写的是
>    `main#main-content bit-form-field textarea[bitInput]` —— 它会**命中页面上 20+ 个多行输入框**（如备注框 `rows=5`），
>    把人家压成 32px。T 段收窄成 `.warden-domain-row bit-form-field textarea[bitInput]`，并**专门写 `probe-b16-notes.mjs`
>    守住"备注框没被压塌"**。⇒ **越界的选择器 = 分布式 Bug**，改窄 + 加回归探针。
> 4. **`.gitignore` 不支持行尾注释，白名单必须独占一行。** 写成 `!.deploycheck/x.mjs   # 说明` 会把 `# 说明`
>    一起当成模式 ⇒ **这条白名单静默失效**（文件仍被忽略，`git status` 里也看不出来）。写入后用
>    `git check-ignore -v <file>` 逐条自证，或看 `git status` 里有没有变成 `??`。**该坑本批实打实踩到过。**
>
> **回滚**：`git revert` fork 的 T 段提交（`totp-badge.component.ts` + `totp.service.ts` + `select.component.{ts,html}` +
> `domain-rules.component.html` + `vaultwarden.css`）+ warden-worker（CI 第 24 组 + 四处版本默认值）
> 并把 `BW_WEB_VERSION` 改回 `v2026.8.5`（+ 同步 lock 与 `inputs.version` 默认值），再重跑 `Build`。

---

> ### ✅ 遗留已清除：`deploy-dev.yaml` 已删除（2026-09-14）
> `.github/workflows/deploy-dev.yaml`（`name: Deploy Dev`）与 `push-cloudflare.yaml` 共用同一段取产物逻辑，
> 但停留在 P1 之前，有三个坑：① 同样 `tar -xzf ... -C public/` 而缺 `mkdir -p public`；
> ② 它下载的是**官方** `dani-garcia/bw_web_builds` 的 release，**不是我们 fork 的 artifact**
> ⇒ 真跑起来会发布**未打任何定制**的前端；③ 仍 `cp public/css/vaultwarden.css`（该文件 P2 已删，必失败）。
>
> **处置：直接删除。** 依据 —— 没有任何东西依赖它（`dev` 分支不存在；Cloudflare 账号下
> **不存在** `warden-worker-dev` 这个 Worker，只有 `warden-worker`；`[env.dev]` 无域名无路由）。
> 留着它是负资产：跑通反而比不跑危险。将来若真要做独立预览环境，
> 应照 `push-cloudflare.yaml` 的"按 artifact 名反查 + 硬校验"模式**新建一条**，
> 而不是复活这个陈旧件（修它 ≈ 重写，还要长期同步两份近乎重复的反查逻辑）。
>
> 注：`wrangler.toml` 的 `[env.dev]` 段落**保留未动** —— 它是惰性配置（不会自己触发、不会发布错误产物），
> 且是将来搭预览环境的现成脚手架；删它只减少认知噪音，不消除任何隐患，而 `wrangler.toml` 是生产配置，
> 刚修好部署链路，不宜冒险改动。

---

## 2. 功能清单（JS 侧 `custom.js`，14 节）

| # | 功能（你会看到什么） | L4 位置 | 行数 | 源码层落点 | 状态 |
|---|---|---|---|---|---|
| ~~J1~~ | ~~劫持 fetch/XHR 抓 `/api/sync` 与 Authorization 头~~ | §1 (57–162) | 106 | **全删** —— 走官方 `SyncService` / API 客户端 | ✅ **无需源码侧动作** —— 源码层不存在对应实现可搬；L4 那段随 P7 删 `custom/` 一起退役 |
| ~~J2~~ | ~~自实现 Base32 / HOTP / TOTP~~ | §2 (163–262) | 100 | **全删** —— 官方 `totp.service.ts`（Rust SDK `generate_totp`） | ✅ **无需源码侧动作** —— 源码层不存在对应实现可搬；L4 那段随 P7 删 `custom/` 一起退役 |
| ~~J3~~ | ~~通过 DI 容器解密 sync 密文~~ | §3 (263–289) | 27 | **全删** —— 官方 `CryptoService` / `CipherService` | ✅ **无需源码侧动作** —— 源码层不存在对应实现可搬；L4 那段随 P7 删 `custom/` 一起退役 |
| ~~J4~~ | ~~建立 TOTP 索引~~ | §4 (290–352) | 63 | **全删** —— `CipherView.login.totp` 本就是明文 | ✅ **无需源码侧动作** —— 源码层不存在对应实现可搬；L4 那段随 P7 删 `custom/` 一起退役 |
| ~~J5~~ | ~~按 DOM 认行（MutationObserver + 400ms 防抖）~~ | §5 (353–394) | 42 | **全删** —— 行组件手里就有 `cipher`，零匹配 | ✅ **无需源码侧动作** —— 源码层不存在对应实现可搬；L4 那段随 P7 删 `custom/` 一起退役 |
| **J6** | **行内 TOTP 动码徽章**（圆角矩形 + 下沿进度条 + 中间挖空显秒数，<5s 转红） | §6 (395–627) | 233 | ✅ 没用 `BitTotpCountdownComponent`（它的模板只画秒数 + 环形，**不渲染码**，返回值靠 `sendCopyCode` 事件吐出来，拿不到 period/low）—— 改为自建小组件注入官方 `TotpService.getCode$()`，自渲染码 + 下沿线性进度条，阈值 5s。见 §3 第七批 | ✅ `3b2ef3a163` |
| **J7** | **表头工具行**：「选择」+「新增」并入"名称"那一行 | §7 (628–649) | 22 | `vault-items.component.html` 的表头 + `css/vaultwarden.css`（I 段） | 🟡 **「选择」半边** ✅ `6528392574`；**「新增」半边**改由 I 段以**不同方式**落地（`3457e7ccb7`，见 §3 第六批 ②）：不再把菜单搬进表格行，而是让窄屏页头塌成只含「新增」的一条工具行 |
| J8 | 外层网格 `relaxGrid()`（把 `minmax(384px,1fr)` 换成 `minmax(0,1fr)`） | §7.0 (650–769) | 120 | **改 SCSS 源码** —— 不再需要运行期替换 | ✅ `8d4292dee2` |
| J9 | **窄屏筛选抽屉**（11 个 chip 收成按钮 + 竖排面板） | §7.1 (770–840) | 71 | 官方 8.0 新增的 `filter-menu` 组件（`libs/vault/src`，+1253 行）**未采用** → 改在官方 `vault-filter` 组件内加展开态 + 收起 CSS（见 §3 的 ④） | ✅ `2a8039eb24` |
| J10 | 窄屏「设置」页账户卡片 | §7.2 (841–868) | 28 | 新建 `layouts/account-card.component`（挂在 `user-layout`，`/settings*` 显示） | ✅ `3457e7ccb7` —— 锁定/注销改调官方 `LockService`/`LogoutService`，取 token 改走官方 `TokenService`（不再劫持 fetch），标记与 L4 一致 |
| J11 | 窄屏二级导航 chips（设置页 / 工具页） | §7.3 (869–901) | 33 | 新建 `layouts/mobile-sub-nav.component`（挂在 `user-layout` 的 router-outlet 之前） | ✅ `3457e7ccb7` —— `routerLink` + 路由派生条目，标记（`#warden-subnav` / `a[data-href]` / `.warden-subnav-on`）与 L4 一致，G5 不需改 |
| **J12** | **行内三点菜单补「文件夹」**（原「添加到文件夹」；v8 起改名并移到「收藏」之下、「编辑」之上） | §7.4 (902–1240) | 339 | `vault-cipher-row.component.html` 的 `bitMenuItem` 列表 | ✅ `8d4292dee2` |
| **J13** | **头像：点自己头像直接换图（真实上传，跨端同步）** | §7.5 (1241–1524) | 284 | **随 J10 的账户卡片落地**：点卡片头像 → 居中裁方 → 128px jpeg → localStorage + `PUT /api/accounts/avatar/image`（后端在 warden-worker，非上游功能） | ✅ `3457e7ccb7` —— 运行时实测 PUT 返回 200、`body.warden-avatar-on` + `--warden-avatar` 生效、localStorage 落地 |
| **J14** | **移动端选择模式 / 批量操作**（v10 起不自建底部条，复用应用自带） | §8 (1525–1582) | 58 | 与 J7 同处表头；官方 8.0 有 `batchBarService` | ✅ `6528392574` —— 胶囊驱动官方 `SelectionModel`，退出时 `selection.clear()`；官方批量条受 `PM37785` 开关控制而**我们的后端没开**（线上 `/api/config` 的 featureStates 无此项），与 L4 §8 的最终形态一致（不自建底部条） |
| J15 | 移动端 ng-select 面板躲软键盘（v12，按 `visualViewport` 动态算） | §8.5 (1583–1659) | 77 | 官方 `bit-select`；样式侧已在 **M 段**落地 | ✅ `335a6f8ba0` —— 落在 `bit-select`（全应用唯一包装 ng-select 的组件，一处生效）；**只搬算法、不搬调试脚手架**（L4 的 `?sel=` 三模式 + localStorage 记忆刻意不要，见 §3 第九批 ③） |
| **J16** | **独立「验证码」页**（复刻 Bitwarden Authenticator 卡片列表） | §9 (1660–1768) | 109 | 新路由 + 官方 totp 组件 | ✅ `9599eac4ea` —— 真路由 `vault/totp-page` + `oss-routing` 的 `path:"totp"`，复用 J6 的 `vault-totp-badge`（改 standalone）；底栏第 2 项随之由 `/vault` 改指 `/totp` |
| **J17** | **窄屏底部标签栏**（密码库/验证码/发送/工具/报告/设置） | §10 (1769–1856) | 88 | 官方无此物，需新组件 | ✅ `cbab779ca1` |
| ~~J18~~ | ~~每秒 tick~~ | §11 (1857–1872) | 16 | 官方组件的 rxjs interval 自带 | ✅ **无需源码侧动作** —— 源码层不存在对应实现可搬；L4 那段随 P7 删 `custom/` 一起退役 |
| ~~J19~~ | ~~装饰列表 + 主循环~~ | §12 (1873–1983) | 111 | **全删** —— 由源码组件 + Angular 变更检测取代 | ✅ **无需源码侧动作** —— 源码层不存在对应实现可搬；L4 那段随 P7 删 `custom/` 一起退役 |

**小计：可全删 6 节 = 466 行；需重写 13 项 = 1462 行。**

> 标 **粗体** 的是你实际感知最强的功能。

---

## 3. 样式清单（CSS 侧 `custom.css`，14 段）

**关键判据**：这段 CSS 锚在「官方 DOM」上（可以独立搬），还是锚在「`custom.js` 注入的 `warden-*` 元素」上（必须等对应 JS 迁完）？

| 段 | 内容 | 行数 | 依赖的 `warden-*` | 能否独立搬 | 状态 |
|---|---|---|---|---|---|
| A | 塌缩「复选框列」与「站标列」 | 60 | `warden-selecting`（状态类） | 需 JS | ✅ **已落地**（随 J7/J14，`6528392574`）—— 但**只作用于窄屏**（有意差异，见 §3 第五批 ③） |
| B | 行内 TOTP 徽章 | 30 | `warden-totp-host` | — | ✅ `3b2ef3a163`（改绝对定位, 见 §3 第七批 ③坑 2） |
| C | 「名称」表头工具行 + 窄屏筛选抽屉 | 157 | 12 种 | 需 J7/J9 | 🟡 **筛选抽屉半边**随 J9 落地（独立「J9 段」39 行）；**「名称」表头工具行的「选择」半边**随 J7 落地（`6528392574`）；**「新增」不再并入该行** —— 改由 I 段让窄屏页头塌成只含「新增」的一条工具行（`3457e7ccb7`，有意差异见 §3 第六批 ②） |
| E | 独立「验证码」页 | 138 | 17 种 | 需 J16 | ✅ `9599eac4ea` —— 去掉 L4 外层的 `position:fixed;inset:0` 与底色（源码层已是页面而非覆盖层），底部让位交给 H1 的 `padding-bottom:74px`；**不含** `.warden-auth-count`（L4 的 `ensureAuthView()` 从未创建该节点，是死代码） |
| F | **移动端（≤768px）布局** | 188 | `warden-filter-open` 等 4 种 | 部分需 JS | ✅ **F1/F2/F3/F5 已落地**（F5「隐藏 side-nav」随第六批落地，`3457e7ccb7`）—— 只差 L4 里那三条死代码（刻意不搬，见 F 段注释） |
| G | 底部标签栏样式 | 81 | `warden-tabbar` 等 | 需 J17 | ✅ **已落地**（随 J17 同批迁入，去注释后与 L4 **逐字节相同**） |
| **H** | **窄屏留白压缩（全站变紧凑）** | 90 | 仅 H7 一条 | ✅ **可独立搬** | ✅ **已落地** |
| I | 窄屏去重复页头 + 账户动作挪设置页 | 141 | 11 种 | 需 J10/J11 | ✅ **已落地**（`3457e7ccb7`）—— 判定条件从 L4 的 body 类改成 `main:has(#warden-acctcard)` / `:has(#warden-subnav)`，纯 CSS 首帧生效；11 种 `warden-*` 依赖归零 |
| J | 窄屏二级导航 chips | 69 | `warden-subnav` | 需 J11 | ✅ **已落地**（`3457e7ccb7`，标记不变） |
| J2 | 有二级导航时压掉大标题页头 | 22 | `warden-has-subnav` | 需 J11 | ✅ **已落地**（`3457e7ccb7`）—— 条件改成 `main#main-content:has(#warden-subnav)`，不再需要 `warden-has-subnav` body 类 |
| J3 | 藏掉应用自带「64px 大头像 + 自定义」行 | 23 | 2 种 | 需 J13 | ✅ **已落地**（`3457e7ccb7`）—— 改为 `main:has(#warden-acctcard) div:has(> dynamic-avatar)`；L4 的 `.warden-app-avatar-row` JS 兜底路径**整体删除**（G2 的 0 帧要求因此天然成立） |
| **K** | **窄屏对话框压缩（新增/编辑条目、Send）** | 96 | **无** | ✅ **可独立搬** | ✅ **已落地** |
| L | 行内「文件夹」浮层 | 128 | 9 种 | 需 J12 | ✅ **整体淘汰**（J12 改用官方 `bulk-move-dialog`，自建浮层/遮罩/窄屏抽屉全不需要） |
| **M** | **ng-select 下拉加固** | 25 | **无** | ✅ **可独立搬** | ✅ **已落地**（样式半边随第一批；移动端"按 `visualViewport` 动态算"那半边是 **J15**，已随第九批落地 `335a6f8ba0`） |

**小计：1248 行。其中移动端相关（F+G+H+I+J+J2+K）≈ 555 行。**

### 第一批已落地：H + K + M（共约 210 行）

搬进 fork 的 `apps/web/src/css/vaultwarden.css`（fork 提交 **`541d62f5a2`**，+271 行 / 12697 字节）。

| 段 | 效果 | 为什么放这里而不是 SCSS |
|---|---|---|
| H | 全站留白压缩：`main#main-content` 内边距 24px→6px、大标题 30px→22px、卡片/表单/间距统一收紧、生成器勾选项强制一行 | 作用域是 app 外壳，且要统一覆盖 Tailwind 间距类 —— 逐页写 SCSS 反而不如全局覆盖 |
| K | 对话框压缩：字段高度 68px→50px、备注 100px→54px、说明文字降档、区块标题收紧 | 对话框挂在 `.cdk-overlay-pane` 上，**在组件作用域之外**，SCSS 需要 `::ng-deep` |
| M | `ng-dropdown-panel` z-index 抬到 2400；`.ng-select-bottom` 高度上限 46vh | 面板 `appendTo="body"`，同样在组件之外 |

> **为什么这是对的**：上游自己就用 `vaultwarden.css` 做自托管定制（`.vw-hide`、`bit-nav-item[route=...]` 等），
> 它是**声明式样式表**，不是运行期补丁层 —— 与 L4 的性质完全不同。

**唯一改动过的地方**：H7 原锚在 `custom.js` 给「名称」th 加的 `.warden-name-th`，
源码层改为直接锚官方的 `<th bitCell>`（`main#main-content table thead th`），视觉等价。

### 第二批已落地：F（主部）+ J8 + J12（fork 提交 `8d4292dee2`）

这一批开始碰到**需要改组件/模板**的部分，不再是纯 CSS 覆盖。

#### ① F 段：移动端布局（`apps/web/src/css/vaultwarden.css`，+102 行）

| 规则 | 做了什么 | 为什么 |
|---|---|---|
| **F1** | `main#main-content` 的 `min-width` 归零 | 官方给 `<main>` 加了 `tw-min-w-96`（=24rem=**384px**），比 320–430px 的手机屏还宽 —— 不松开这条，**每个页面**都会横向溢出 |
| **F2** | 保险库页「筛选 1/4 + 列表 3/4」横向 flex → **纵向堆叠** | 窄屏下 1/4 只剩约 67px，筛选栏被压成一条、完全没法点 |
| **F3** | 筛选面板整宽 + `max-height:58vh` 内滚 | 11 个筛选项竖排比一屏还高，不设上限会把下方条目列表整个推出屏幕 |

> ⚠️ **原 F 段还有一条「窄屏隐藏 `app-side-nav` / `bit-side-nav`」，这里刻意没有搬。**
> 原因：应用自己的**导航开关按钮就长在 `bit-side-nav` 内部**（`libs/components/src/navigation/side-nav.component.html` 里的 `sideNavService.toggle()`）。
> 窄屏隐藏整个导航 = 移动端**失去唯一的导航入口**。L4 敢这么写，是因为它另建了底部标签栏来替代（J17）。
> **在 J17 落地之前这条不能动**，否则移动端会变成"能看不能用"。这也是为什么第 5 步要把「隐藏 side-nav」和「筛选抽屉」捆在一起做。

#### ② J8：网格最小宽度（`libs/components/src/layout/layout.component.ts`）

`MAIN_MIN_WIDTH_REM = 24` 与 `<main>` 上的 `tw-min-w-96` 是**配套**的（源码注释明写 "matches"），
共同保证桌面三栏每栏不少于 384px。手机上这成了硬溢出源。

新增 `resolveMainMinWidthPx(containerWidth)`：仍以 24rem 为下限，但**不超过容器自身宽度**；
首次测量前（`containerWidth=0`）保持原下限，所以首屏渲染与之前完全一致。
两处调用点（网格轨道计算 + 导航模式判定）都换过去。**桌面端容器远宽于 24rem，行为零变化。**

> 只改 CSS 不改这里会怎样：**列宽仍被网格轨道撑到 384px，页面照旧溢出。** F1 和 J8 是同一件事的两半。

#### ③ J12：行内菜单「文件夹」

需求原文：「**添加到文件夹 改为 文件夹** 这种简略的」。

| | L4 的做法 | 源码层的做法 |
|---|---|---|
| 规模 | `custom.js` 约 339 行 + `custom.css` L 段 128 行 = **467 行** | **11 行** |
| 取条目 ID | 劫持 DI 拿 keyService/encryptService，**解密全部条目名**建「名称→id 映射」，重名还要再解密用户名消歧义 | 不需要（行组件手里就有 `this.cipher`） |
| 写回 | 手写 `GET /api/ciphers/{id}` → 改 `folderId` → `PUT` 回去 | 官方 `CipherService.moveManyWithServer` |
| 安全 | 无主密码复验 | **有**（`repromptCipher`） |
| 弹层 | 自建 DOM + 遮罩 + 窄屏底部抽屉 | 官方 `bulk-move-dialog`（自带窄屏适配） |

实现只是**抛一个事件**，父组件的链路早就存在：

```
vault-cipher-row   onEvent.emit({ type:"moveToFolder", items:[cipher] })
  → vault-items      (onEvent)="event($event)"        ← 纯转发
  → vault.component  case "moveToFolder": await this.bulkMove(event.items)
```

文案取 i18n 的 `folder`（中文正好是「**文件夹**」），位置在「收藏」之下、「编辑」之上；
**表头批量菜单**（原为「添加到文件夹」）同步换成同一个 key，两处口径一致。

> 🐛 **顺带修掉一个上游既有的崩溃**：`bulk-move-dialog` 里的
> `folderId: (await firstValueFrom(this.folders$))[0].id`
> 在用户**没有任何文件夹**时直接抛错（`folderViews$` 返回空数组，不含"无文件夹"占位）。
> 官方批量移动入口也能踩到。已改为 `[0]?.id` —— 为空时不预选，提交即"不放入文件夹"。

> 📌 **L 段（128 行）整体淘汰**：既然走官方对话框，那套自建浮层的样式全部不需要。

#### ④ 把这三块写进 CI 的产物断言（workflow 提交 `dc0463c`）

原来的产物断言只覆盖旧定制（视口 / 主密码长度 / css 是否存在），**F/J8/J12 没有任何守卫** ——
它们将来被上游 rebase 冲掉，CI 照样全绿。本轮补上了，判据都经过**区分度验证**。

> ⚠️ **两个坑（都已踩过）**
> 1. **不能断言函数名**：`resolveMainMinWidthPx` 被生产构建的 terser 改名成了 `D`，
>    按名字 grep 得到的是**假警报**。改为断言**编译后的结构**：
>    `24*(0,<fn>)();return Math.min(` —— 直译自 `Math.min(floor, cw>0?cw:floor)`，
>    与标识符命名无关。
> 2. **不能只看某个字符串**：`moveToFolder` **上游本就有 2 处**
>    （表头 `bulkMoveToFolder()` + `vault.component` 的 `case`），按名字断言**没迁也通过**。
>    改断言官方**没有**的那条行组件独有 emit：`onEvent.emit({type:"moveToFolder"`。

**区分度矩阵**（拿官方基线跑同一段脚本必须 FAIL）：

| 产物 | F 段 | J8 | J12 |
|---|---|---|---|
| 官方基线 | 连 `css/vaultwarden.css` 都没有 | 无 | 无（命中旧的 2 处） |
| fork / fork3（更早） | 无 css | 无 | 无 |
| p2（H/K/M 期，已有 css） | 有 css 但无 F 段标记 | 无 | 无 |
| **当前（run ⑦）** | **有** | **有** | **有** |

CI 实测（run ⑦ `34762363139`，步骤 11 日志）：
`viewport=device-width` / `minimumPasswordLength=8` / `css 16769 bytes` /
`moveToFolder 总出现次数: 5（官方基线为 2）` / `✅ 五项源码级定制均已在实际产物中得到验证`。

#### 验证方式（与 L4 那种"写了但不知生不生效"的区别）

本地 dev server、375×812 iPhone 视口、**连真实后端**，13/13 通过。关键指标不是"声明存在"，而是**计算样式**：

| 项 | 实测 |
|---|---|
| F1 | `min-width: 0px`（原 384px） |
| F2 | 含 `app-vault-filter` 的 flex 容器 `direction: column`（元素类名仍是 `tw-flex-row`，说明是 CSS 覆盖生效） |
| F3 | `max-height: 470.96px`（=812×58vh，**精确匹配**）、`overflow-y: auto`、实高 460 未突破 |
| 布局 | `documentElement.scrollWidth = 375` = 视口宽，**无横向溢出** |
| 菜单 | `["复制用户名","复制密码","复制验证码","收藏","文件夹","编辑","附件","克隆","归档","删除"]` |

### 第三批已落地：J17 + G 段：底部标签栏（fork 提交 `cbab779ca1`）

#### ① 为什么把 J17 从第 11 位提到第 4 位（顺序做了修正）

原计划把 J17 排在最后。做 J7（表头工具行）的前期调研时发现**依赖是倒的**：

```
J7（表头工具行：「新增」搬进表格行）
  ← I 段（窄屏隐藏整条 app-vault-header —— 这正是「新增」必须搬走的原因）
  ← J17（底部标签栏常驻）+ J9（筛选抽屉）
```

L4 在窄屏做的是两件"**去掉入口**"的事：

| L4 动作 | 后果 | 前提 |
|---|---|---|
| F 段：窄屏隐藏 `bit-side-nav` | 应用自己的导航开关按钮就长在它内部（`side-nav.component.html` 的 `sideNavService.toggle()`）→ 移动端失去**唯一**导航入口 | 需要有个**常驻**替代品 |
| I 段：窄屏隐藏整条 `app-vault-header` | 「新增条目」按钮随之消失 | 需要把「新增」搬进表格行（J7） |

两者都以「底部标签栏常驻」为前提 —— **J17 是 keystone**，它一次解锁 F2 / J9 / I 段 / J7 四项。
先做 J7 会卡在 I 段；先做 J16（验证码页）那页在 fork 里没有入口（标签栏就是它的入口）。

#### ② 实现：一个组件 + 一处挂载（vs L4 的注入式 DOM 构建）

L4 是 `custom.js` §10 在**每次路由变化后** `ensureTabbar()`：手写 `innerHTML` 拼 6 个 `<a>`，
再 `appendChild` 到 `document.body`。

源码层：

| 文件 | 作用 |
|---|---|
| `apps/web/src/app/layouts/mobile-tab-bar.component.ts` | 组件：6 项 + 选中态（`Router` 事件 → `signal`） |
| `apps/web/src/app/layouts/mobile-tab-bar.component.html` | 标记（`nav#warden-tabbar`，内联 SVG 图标） |
| `apps/web/src/app/layouts/web-layout.component.html` | 挂到 `app-layout` 外壳（`bit-layout` **之外**：它是 `position:fixed`，不参与三列 grid） |
| `apps/web/src/app/layouts/web-layout.component.ts` | 加进 `imports` |
| `apps/web/src/css/vaultwarden.css` | G 段样式（+81 行，含深色分支） |

**挂载点是关键**：`app-layout` 只被登录后的 `user-layout` / `organization-layout` 使用，
等价于 L4 的 `document.querySelector("bit-layout")` 守卫 —— 登录页 / 前端页不用它，
所以标签栏**不会**出现在那些页面上（实测：登录前页面上没有底栏节点）。

三个刻意保留的设计：

1. **标记与 L4 一致**（同 `id=warden-tabbar` / 同 class / 同 `data-tab`）——
   `tests/mobile-regression.mjs` 的「F1 底栏 6 项」断言（`tabs.length === 6`）不需要改。
2. **显示/隐藏完全交给 CSS**（G 段的 `@media`），组件不做视口判断 ——
   旋转屏幕 / 拖窗口由浏览器直接接管，不经过变更检测，也就不会闪。
3. **选中态用「等值或前缀 + `/`」** 而不是 `startsWith(route)` ——
   后者会让 `/settings` 在 `/settingsomething` 上也亮起来。当前没有这种路由，但规则不该依赖它。

#### ③ 「验证码」这一项为什么暂不点亮选中态

L4 里它也是 `{ route: "/vault", auth: true }` —— 指向 `/vault`，再由 `openAuthView()`
在密码库页上盖一层**自注入**的验证码视图。也就是说它的**目标路由本来就和我们一致**。

那层视图是 J16 要迁的东西，尚未落地，所以这里只做导航、暂不点亮选中态
（`isActive('totp')` 在 `/totp` 出现前恒为 false）。J16 落地后把 `routerLink` 改成 `/totp`，
选中态自动生效 —— 这与回归套件「遍历 5 个真实路由」（第 6 项不参与选中态断言）是吻合的。

> **后续（第八批 `9599eac4ea`）**：J16 已落地为真路由，上面这条"暂时"已经改掉 ——
> `routerLink` 现为 `/totp`，选中态与 `aria-current` 由 `isActive('totp')` 自动生效。

#### ④ 文案为什么是硬编码中文（而不是 `| i18n`）

上游 i18n 里**没有可用的短键**：

| 想要 | 上游实况 |
|---|---|
| 发送 | `send` 在 `zh_CN` 里**根本没翻译**（仍是 `"Send"`）—— L4 的「发送」反而比上游更中文化 |
| 验证码 | 只有 `verificationCodeTotp` = 「验证码 (TOTP)」，塞进 11px 的标签太长 |

L4 上验收过的视觉稿用的就是「密码库 / 验证码 / 发送 / 工具 / 报告 / 设置」，
迁移的验收标准是**功能等价**，故先保留字面量，并在模板注释里写明 i18n 化的前置步骤
（先补 `send` 与「验证码」两个短键）。

#### ⑤ G 段颜色是硬编码的（跟随**系统**深色偏好，不是应用内主题）

逐字沿用 L4，含 `@media (...prefers-color-scheme: dark)` 分支。换成应用自己的主题变量
（`--color-*`）属于**观感改进**、不是迁移的一部分，不夹带进这批提交。

#### ⑥ 顺带核对上批 F 段的"漏迁嫌疑"（结论：没有漏迁）

L4 的 F 段块里除了 `min-width:0` 还有 4 条声明，fork 只迁了 1 条。逐条核对：

| F 段原声明（L4） | 状态 | 处理 |
|---|---|---|
| `min-width: 0` | 生效（防溢出的核心） | ✅ 已迁 |
| `padding` / `padding-top` / `padding-bottom` | **死代码** | ✅ 正确省略 |
| `overflow-x: hidden` | 生效但**冗余** | ⏸️ 刻意不迁 |

`padding` 三条为什么是死的：同一选择器 `main#main-content` 在**更靠后的 H 段**被整体覆盖
（H1：`padding: 6px 10px 74px`）。两者特异性相同、都 `!important` → 级联按**源码顺序**决胜，
H 段赢。fork 的 H1 一字不差地提供了这个生效值（实测 `padding-bottom = 74px`）。

`overflow-x: hidden` 为什么不迁：它的唯一作用是**裁掉**溢出内容，而本轮已从**根因**消除溢出
（`min-width` 放开 + J8 网格封顶）。实测 6 个路由在 375px 下 `main.scrollWidth` 均等于
`clientWidth`，零横溢。且 `<main>` 官方就是 `tw-overflow-auto` —— 保留 `auto` 比 `hidden` 更稳：
万一将来某页溢出，`auto` 至少让内容**可滚可达**，`hidden` 会直接裁掉。判据已写进 F1 的注释。

#### ⑦ 验证（本地 dev server，375×812，走真实后端）

`verify-tabbar.mjs` **27/27 通过**。关键项：

| 项 | 实测 |
|---|---|
| 窄屏显示 | `display=flex` / `position=fixed` / `bottom=812`（贴底）/ 6 项 |
| 文案 | `["密码库","验证码","发送","工具","报告","设置"]` 与 L4 逐字一致 |
| 选中态 | 5 个路由跳转与选中态全对（切到 `/settings` 再切回 `/vault`，选中态跟随） |
| 宽视口（反向） | `display=none`；改回窄屏又出现 → **证明 CSS 分支是活的** |
| 登录前（反向） | 页面上没有底栏节点（登录页不用 `app-layout`） |
| CSP | 3 条违规**全部来自 `app/vendor.*.js`**（登录前就在发生，上游既有噪音）；我们的代码 **0 条** |

另两项专项核对：

- **G 段等价**：机械比对（去掉注释/空行后）与 L4 的 G 段**逐字节相同**（74 行骨架）。
- **底栏遮挡**：`main` 计算得 `padding-bottom=74px`（来自 H1），内容下沿 **738** < 底栏顶 **749**，余量 11px（矮视口 500 时同样余 11px）—— 最后一行不会被盖住。
- **横向溢出**：逐路由实测 6 个（保险库 / 发送 / 生成器 / 报告 / 账户设置 / 偏好设置），375px 下 `main.scrollWidth` 均 == `clientWidth`。

---

### 第四批已落地：J9 窄屏筛选抽屉（fork 提交 `2a8039eb24`）

#### ① 为什么这一条是 J7 的前置

§5 的「顺序修正记录」写了依赖是倒的，这条把那个判断补全。三个功能互相咬住：

| 功能 | 做了什么 | 代价 |
|---|---|---|
| I 段 | 窄屏隐藏整条 `app-vault-header` | 页头里的「新增条目」按钮随之消失 |
| J7 | 把「新增」搬进表格行 | 必须先有 I 段（否则重复） |
| J9 | 筛选抽屉给出替代入口 | 页头的筛选入口消失后，得有个地方进筛选 |

→ I 段同时依赖 J7 与 J9，所以 **J17（keystone）之后、J7 之前必须先落 J9**。至此 I 段两个前置都已就位。

#### ② 实现对照（L4 §7.1 → 源码）

| 环节 | L4 做法 | 源码做法 |
|---|---|---|
| 入口 | 往 `app-vault-filter` 注入 `#warden-filterbar` | 官方 `vault-filter.component.html` 里加一个 `bitButton` 开关（官方组件，模板内直接定） |
| 展开态 | 切 `body` 上的 class | 组件字段 `filterSectionsExpanded`（默认 `false`），模板绑 `[class.warden-filter-collapsed]` |
| 文案 | 从被 I 段藏掉的页头 `h1` 里抓文本 | `i18n` 的 `filters`（不依赖任何 DOM） |
| 选完收起 | 监听点击后 `setTimeout` 关 | 四个 `apply*` 方法开头置 `false`（同步，无定时器） |
| 显隐规则 | JS 切 class + CSS `display` | 全 CSS：`@media (max-width:768px)` 内 `app-vault-filter .warden-filter-collapsed > .filter { display:none !important }` |
| 图标/配色 | 硬编码 `background`/`color` | 用官方 `bitButton`（跟随应用主题）+ `bwi-filter` / `bwi-angle-down` 字体图标 |

**为什么不用官方 8.0 新增的 `filter-menu`**（清单原计划）：官方那个 `filter-menu` 是给 **table-v2** 用的 chip 弹出菜单，与 `vault` 侧栏筛选不是同一套数据流；直接替换要重接 `VaultFilterService`，改动面远大于在现有组件上加一个展开态。**结论：在官方组件内加展开态更小、更稳，且不引入与新组件的耦合**（后续上游若重做 `filter-menu`，我们不受影响）。

#### ③ 桌面端行为零变化（这是最关键的一条）

收起规则**只写在 `@media (max-width: 768px)` 里**，开关本身也只在窄屏 `display:block`。所以：

- 宽屏（≥769px）：开关 `display:none`，筛选区块**照常全展开** —— 即便 `filterSectionsExpanded` 是 `false` 也不会收。
- 实测反向验证：宽屏 1280 下把状态设成收起，6/6 区块**仍全部可见** → 证明收起不是靠 JS 状态直接藏 DOM，而是靠 CSS 分支。

#### ④ CSS 编号为什么不续「C 段」

L4 把「表头工具行」和「筛选抽屉」写在同一个 C 段里（157 行）。但这两半的**前置条件不同**（工具行等 J7、抽屉等 J9），拆开落地时若都叫 C 段，会让「已落地的到底是哪一半」变得不可知。故样式层单独编号 **J9 段**（39 行，其中有效 CSS 21 行），并断言段标记 —— 与 F/G 段的做法一致。

#### ⑤ 验证

**运行时（`verify-j9.mjs`，375×812，走真实后端 `shypwd.cc.cd`）：19/19 通过。**

| 项 | 实测 |
|---|---|
| 窄屏默认 | 开关 `display=block`、文案「筛选」；6 个筛选区块**可见 0**；`warden-filter-collapsed`=true；`aria-expanded`=false |
| 点开 | 6/6 区块可见；`aria-expanded`=true；箭头 `rotate(180deg)` |
| 选「所有密码库」 | 自动收起 → 回 0 可见 |
| **宽屏（反向）** | 开关 `display=none`；区块**仍 6/6 可见**（即便状态是收起） |
| 改回窄屏 | 又收起 → **证明 CSS 分支是活的**（不是一次性初始化） |
| 横向溢出 | `docScrollWidth == 375` == 视口宽，零横溢 |
| CSP | 3 条违规**全部来自 `app/vendor.*.js`**（上游既有噪音）；我们的 `main.*.js` **0 条** |

**产物断言（`probe-j9-assert.mjs`）**：候选判据逐条在我们的产物 / 官方基线上各跑一遍，**只有两边结果不同才算有区分度**。结果：

| 候选 | 我们 | 官方基线 | 采纳 |
|---|---|---|---|
| JS `warden-filter-toggle` | HIT | miss | ✅ |
| JS `warden-filter-collapsed` | HIT | miss | ✅ |
| JS `warden-filter-caret` | HIT | miss | ✅ |
| JS 中文「筛选」 | HIT | miss | ✖ 太弱（i18n 文案会被上游改动，不如类名字面量稳） |
| CSS 段标记 `窄屏筛选抽屉` | HIT | miss | ✅ |
| JS `app-vault-filter` | HIT | HIT | ✖ **无区分度**（官方本就有这个组件） |
| JS `aria-expanded` | HIT | HIT | ✖ **无区分度**（官方别处也在用） |

> 两个被否掉的候选正是「断言无区分度」的典型：不看官方基线就写进去，等于**没迁也能过**。
> 已把「先跑区分度测试再写断言」固化为流程（前两批各踩过一次：J8 按函数名、J12 按 `moveToFolder` 字面量）。

**断言脚本落盘后另跑了两份「反向产物」**（`.deploycheck/wf-yaml-check.py`，直接抽 workflow 的 `run:` 块实跑）：

| 拿去跑的产物 | 结果 | 说明 |
|---|---|---|
| 官方基线（`p1/baseline/web-vault`） | **exit 1**，逐条报出全部 12 条 ❌（含 4 条 J9） | 守卫不是空的 |
| run ⑨ 产物（`p1/p8/web-vault`，= J17 期，**尚无 J9**） | **exit 1**，但**只挂 J9 那 4 条**，其余（视口/主密码/css/F/G/J8/J12/J17）**全过** | 这是最有价值的一份：证明新加的 4 条**既不误报**（老断言全绿）、**也不空转**（它们确实在等 J9 到货） |

> 第二份的意义：只拿官方基线测，无法区分「断言在等 J9」和「断言本来就不可能通过」。
> 拿一份"除 J9 外全都迁好了"的产物测，才能把这两者分开。

---

### 第五批已落地：J7（「选择」半边）+ J14 + A 段（fork 提交 `6528392574`）

这一批把「选择模式」整条链路搬进源码：`vault-items.component.{ts,html}` + `css/vaultwarden.css` 新增
「J7 / J14 / A 段」150 行（含注释）。**「新增」并入那一半刻意没做**，理由见 ①。

#### ① 为什么这批不能连「新增」一起做

J7 的完整定义是「「选择」+「新增」并入"名称"那一行」。但「新增」搬进表格行的**前提**是 I 段
（窄屏隐藏 `app-vault-header`）—— 否则窄屏会同时出现两个「新增」（页头一个、表格行一个）。
而 I 段又依赖 J10/J11（账户动作挪到设置页的卡片），整条链是：

```
J7(新增半边) ← I 段(藏页头) ← J10/J11(账户卡片)     ← 这批只做到这里
J7(选择半边) + J14 + A 段                          ← 无依赖，可独立落地
```

所以拆成两步：本批做完无依赖的「选择」半边，I 段留到下批（那时 J10/J11 一起做）。
**当前窄屏形态**：页头还在（官方样式，带「新增」），表头多了「选择」胶囊 —— 功能齐全，不重复。

#### ② L4 的 4 个运行期机制在源码层怎么消解

| L4 做法（`custom.js`） | 源码层落点 | 为什么更好 |
|---|---|---|
| `ensureHeadbar()`：`document.createElement` 造 `#warden-headbar` + `appendChild` 进「名称」th | `.warden-headbar` 直接写在 `vault-items.component.html` 的「名称」th 里 | 不再靠 `nameTh()` 按 th 的**直属文本节点**认列（那个法子一旦 th 里有别的文本节点就找不到列，L4 注释里专门警告过） |
| `setSelecting(on)`：给 `document.body` 加/摘 `.warden-selecting` | `[class.warden-selecting]="selecting()"` 绑在 `<bit-table>` 上 | 容器不变、位置同步，不依赖"列宽变化"推断状态 |
| `updateSelbar()`：手改按钮文案 + 加 `.warden-selbar-on` | 模板插值 `(selecting() ? "cancel" : "select") \| i18n` + `[class.warden-select-on]` | 文案进 i18n（L4 是硬编码「选择/取消」），状态由 signal 驱动 |
| `uncheckAll()`：遍历 DOM 逐个 `.click()` 取消勾选 | `this.selection.clear()`（官方 `SelectionModel`） | 不碰 DOM，也不依赖"行是否已渲染" |
| `alignHeaderDots()`：连量 2.4s 补表头 ⋯ 与行内 ⋯ 的位移差 | **不需要** | 那个差是 L4 自己的 B 段（`td` 内边距改为 6px）造出来的；源码层没改内边距，两侧本来就对齐 |

#### ③ ★ 与 L4 的有意差异：桌面端不显示「选择」胶囊（用户决策）

用户在真机上发现**桌面端多出一颗「选择」**。根因是 L4 的 A 段（塌缩复选框列）是**全局作用域**：
桌面端复选框列同样被塌成 0 宽，于是桌面端必须靠那颗胶囊才能进选择模式 —— 胶囊在桌面端
"看起来多余"，实际是**唯一的批量选择入口**。

> 实测证据（`shot-l4-select-btn.mjs`，1280×900）：`#warden-headbar` 存在、
> `.warden-selbar-toggle` 可见 `[833,221,64,28]`、th 文本 = **"名称 选择"**；
> 官方是 "名称"。窄屏 375×812 则是"名称 新增 选择"。

改法：**A 段塌缩 + 胶囊一起收进 `@media (max-width: 768px)`**，桌面端回到官方原样。
⚠️ 所以**不能只把胶囊隐藏掉** —— 那样桌面端会连带失去唯一的批量选择入口；必须同时把
复选框列在桌面端放回来。这条已写成 CI 的**负向断言**（顶格的 `.warden-selectable` 规则必须不存在）。

#### ④ `table-fixed` 的几何坑：写 `width: 32px` 实际得到 56.78px

按 L4 原稿只给 `thead th.tw-w-24` 写 `width: 32px !important`，实测选择模式下是 **56.78px**。
原因：`table-fixed` 下列宽由首行单元格决定，而「名称」列是**百分比**（`tw-w-3/5` = 60%，
百分比列拿固定份额），富余宽度会被**按各 px 列的指定值比例**再分给复选框列和操作列：

```
355(表宽) − 213(名称 60%) − 32 − 48 = 62 富余
复选框列 = 32 + 62×32/(32+48) = 56.78   ← 观察值
操作列   = 48 + 62×48/(32+48) = 85.19   ← 观察值
```

副作用：进/出选择模式时名字列整体右移 56.78px、胶囊也跟着移。做法（对当前布局是恒等变换）：

```css
.warden-selectable thead tr > th.tw-w-12 { width: 142px !important; }     /* 钉住操作列 = 收起态实测值 */
.warden-selectable.warden-selecting thead th.tw-w-24 { width: 32px !important; }
.warden-selectable.warden-selecting thead tr > th.warden-name-th { width: auto !important; }  /* 名称列吃掉剩余 181px */
```

结果：复选框列**正好 32px**（与 L4 同值）、名字列右移 32px、**胶囊与 ⋯ 完全不动**（实测两个状态下
`.warden-headbar` 的 rect 都是 `[159,383,64,44]`）。

#### ⑤ 组织保险库管理页为什么排除在外

那一侧 `[showAdminActions]="true"`，「名称」th 是 `bitSortable`，而 `SortableComponent` 的模板
把内容包进了 `<button>`（`libs/components/src/table/sortable.component.ts`）—— 再塞一颗
`<button>` 进去是**非法嵌套**。L4 那个按 th 直属文本节点认列名的 `nameTh()` 在那儿本来也找不到列。
所以标记类 `.warden-selectable` 只在个人保险库的 `<bit-table>` 上挂（`[class.warden-selectable]="!showAdminActions"`），
该页保持官方行为（复选框列常显）。

#### ⑥ 验证

**运行时**（`verify-j7.mjs`，本地 dev server + 真实后端，**27/27 通过**）：

| 场景 | 断言（计算样式/几何，不是"类名写没写"） |
|---|---|
| 窄屏 375 默认 | `.warden-headbar` display:flex、胶囊可见（`选择`）、name th `position:relative`、`th.tw-w-24` = **0px**、行内复选框 hidden、表头 ⋯ hidden |
| 窄屏点胶囊 | `bit-table` 挂 `.warden-selecting`、`th.tw-w-24` = **32px**、复选框 visible、⋯ visible、文案转「取消」、`scrollWidth` = 375（无横向溢出） |
| 窄屏全选→退出 | 勾上 1 行 → 退出后 `.warden-selecting` 摘掉、列宽回 0、**选中项被清空**、文案回「选择」 |
| 桌面 1280 | `.warden-headbar` display:none、胶囊不可见、`th.tw-w-24` = **96px**（官方宽度，没被塌成 0）、复选框 visible、⋯ visible |

**产物断言**（`probe-j7-assert.mjs`，候选逐条在我们/官方基线上各跑一遍）：

| 候选 | 我们 | 官方基线 | 采纳 |
|---|---|---|---|
| JS `warden-headbar` / `warden-select-toggle` / `warden-select-on` | HIT | miss | ✅ |
| JS `warden-name-th` / `warden-selectable` / `warden-selecting` | HIT | miss | ✅ |
| JS i18n key `selectAll`（对照） | HIT | HIT | ✖ 无区分度（官方本就有） |
| CSS 段标记 `J7 / J14 / A 段` ＋ `.warden-headbar` / `.warden-select-toggle` / `.warden-selectable` | HIT | miss | ✅ |

> 6 条 JS 判据全部是**类名字面量**（静态 class 或 `[class.x]` 的键名），不参与 terser 改名 ——
> 不选 TS 属性名（`selecting` / `toggleSelecting` 会被改名，J8 那一批踩过）。

**CI 实跑**（run ⑫ = `34769323569`，commit `c70fc6ce0e`，fork `6528392574`）：
Verify 步全绿，新增那行输出 `warden-select-toggle 总出现次数: 1  (官方基线为 0)`，
结尾 `✅ 十项源码级定制(F/G/J8/J9/J12/J14/J17 + 视口 + 主密码长度 + J7/A段)均已在实际产物中得到验证`。
`css/vaultwarden.css` 从 J9 期的 22401 B 涨到 **29313 B**（+6912 B = A 段 + C 段工具行）。

**三向区分度验证**（`.deploycheck/wf-yaml-check.py` 直接抽 workflow 的 `run:` 块对三份产物实跑）：

| 拿去跑的产物 | exit | 结果 | 说明 |
|---|---|---|---|
| run ⑫ 我们的产物（`p1/p11`） | **0** | 十项全过 | 守卫不是空转 |
| 官方基线（`p1/baseline`） | **1** | 22 条 ❌（含新加 10 条） | 守卫不是空的 |
| run ⑩ 产物（`p1/p10`，= J9 期，**尚无 J7**） | **1** | **只挂新加的 10 条**，视口/主密码/css/F/G/J8/J9/J12/J17 **全过** | 最有价值的一份: 新断言**既不误报也不空转** |

> 第三腿是唯一能把「断言在等 J7 到货」和「断言本来就不可能通过」分开的对照 ——
> 只拿官方基线测做不到这一点（那份产物本来就样样都缺）。

---

### 第六批已落地：4b + 5b + I 段 + J10 + J11 + J13（fork 提交 `3457e7ccb7`）

这一批的指导原则变了：**不再照抄 L4 的实现方式，只要求「功能等价」**（用户明确要求
"你可以以不同的方案实现相同的效果试试，因为确实有一些是冗余的"）。于是逐项问
"L4 为什么要这么绕"，能消解的消解，消解不掉的再照搬。

#### ① 三处运行期机制 → 源码组件 / 官方服务

| L4 的做法 | 源码层做法 | 少了什么 |
|---|---|---|
| J11: custom.js 注入 `<nav id=warden-subnav>`；点击 `preventDefault()` + `location.hash = ...`；"乐观点亮"再靠 MutationObserver 纠正；用 `data-set` 比对在"设置↔工具"间**整套重建**（v6 的"残留条目"bug 就是这套的） | `mobile-sub-nav.component`：`routerLink` + 由 URL 派生条目，`@for` 自动增删 | 点击拦截、乐观高亮、重建记账、`data-set` |
| J10: custom.js 注入卡片；锁定/注销靠"点开官方 account-menu，再按中文文案找到菜单项替它 click"，还得先给浮层挂 `warden-ghost-menu` 隐身类（因为头像被藏后浮层会锚在 (0,0) 闪一下） | `inject(LockService).lock(userId)` / `LogoutService.logout(userId)` | 文案匹配、浮层隐身 hack、点击时序 |
| J13: custom.js 建 `<input type=file>`；token 靠劫持 `window.fetch` + `XMLHttpRequest.prototype.open` **偷 Authorization 头** | 模板里的 `viewChild` 文件选择器 + `TokenService.getAccessToken(userId)` | 两个全局原型劫持 |

> ⚠️ 有意保留的一处 L4 契约：头像地址仍写在 `body` 的 `--warden-avatar` 变量 +
> `warden-avatar-on` 类上 —— 因为 `tests/mobile-regression.mjs` 的 G4 直接断言
> `document.body.classList`。改 CSS 消费点会连带改回归脚本，收益为负。

#### ② 「新增」半边（4b）：**刻意与 L4 不同**

L4 把整个 `app-vault-header` 藏掉，再由 `dockNewBtn()` 在运行期把官方
`vault-new-cipher-menu` 元素 `appendChild` 进表格「名称」表头的工具行
（`#warden-headbar` 里的 `.warden-headslot`），同时记下落点的**父节点 + 后继节点**，
离开窄屏或离开列表页时再拼回去 —— 约 35 行 JS 只为搬一个 DOM 节点，而且每次
Angular 重渲染都要重新判定"落点还在不在"。

这里改成：**页头不整个藏**，只收掉左边那一列（面包屑 + `h1`，含 `title-suffix` 的集合
编辑菜单）与产品切换宫格，页头塌成一条只含「新增」的紧凑工具行。

- 官方组件保持**单实例**、零 DOM 搬运、零 JS 记账，官方内联菜单
  （登录/支付卡/身份/笔记/SSH 密钥/文件夹）原样保留；
- 实测那条工具行高 **56px**，也就是说比 L4 的观感**多占约一行**；
- 要回到"和列头同一行"需要把菜单搬进 `.warden-headbar`，那会引入 `vault-items` 的
  一串输入/输出（`canCreateCipher` / `canCreateFolder` / `disabled` + 三个输出事件都挂在
  页头组件上）—— 为省一行高度换一堆样板，不划算。
  若你更在意那一行高度，这是一处**可以单独回退**的差异。

#### ③ 三处"藏着东西"的规则：判定条件从 body 类改成 `:has()`

L4 用 `body.warden-has-subnav` / `body.warden-has-account-card` 驱动 I 段、J2、J3，
而那三个类由 custom.js 在 Angular 渲染**之前**同步挂上（否则会"先画出来再消失"）。
源码层不再需要这套时序保障 —— 条件直接写成结构判定：

| 段 | L4 条件 | 现在 | 为什么更好 |
|---|---|---|---|
| I | `body.warden-has-account-card` / 路由判定 | `main#main-content app-vault-header ...` 直接写进 `@media` | 无 body 类 |
| J2 | `body.warden-has-subnav` | `main#main-content:has(#warden-subnav)` | chips 只在工具/设置分区渲染 ⇒ 判定完全等价；`:has()` 首帧即生效，天然无闪烁 |
| J3 | `body.warden-has-account-card` + JS 加 `.warden-app-avatar-row` 兜底 | `main#main-content:has(#warden-acctcard) div:has(> dynamic-avatar)` | **兜底路径整体删除**：G2 的"90 帧采样里 0 帧可见"因此天然成立 |

#### ④ ⚠️ 踩坑：CSS 注释里写了 `canCreate*/disabled`，把整段规则吃掉了

`canCreate*/disabled` 里的 `*/` **提前关闭了 `/* ... */` 注释**，注释剩余文字被当作
CSS 选择器解析失败，浏览器于是**跳过了紧随其后的整个 `@media` 块** —— 表现为
I 段的 4 条规则全部不生效（`app-account-menu` 仍是 `inline`），而它后面的 J/J2/J3/J10
全部正常。

- 现象很有误导性：同一批追加的规则**有的生效有的不生效**，看起来像选择器写错；
- 本机诊断路径：`document.styleSheets` 里逐条 dump 顶层规则，
  发现解析后只有 36 条顶层规则、I 段的 `@media` 整块不存在；
- 定位手法（**建议固化成检查习惯**）：
  ```python
  s = open("vaultwarden.css", encoding="utf-8").read()
  assert s.count("/*") == s.count("*/")   # 76/77 就是这么发现的
  assert s.count("{") == s.count("}")
  ```
- 结论：**注释里不要出现 `*/`**（含 `A*/B` 这种"带星号配斜杠"的写法）。

#### ⑤ 验证：运行时 42 条 + 产物区分度 21 条

- 运行时（`.deploycheck/verify-batch6.mjs`，dev server + 真实后端）：**42/42 通过**。
  判据是几何与计算样式，不是"class 写上去了"：
  - 窄屏页头：`app-vault-header` 不是 `display:none`；左列/宫格/头像 `none`；
    「新增」按钮 box `[281,8,84,40]`；工具行高 56px；**点它真的拉出 6 项菜单**；
  - 5b：`bit-side-nav` 为 `none`，且**主列左边界回到 0px**（守"grid 轨道没跟着塌"）、
    底栏仍 6 项；
  - J11：chips 在 `main#main-content` 内、settings 5 项 / tools 3 项、等宽
    `[66,66,66,66,66]`；**点「安全」真的换路由**且高亮跟着走；三级 tabs 未被一起藏掉；
  - J10/J13：名称在头像右侧同一行；`#warden-acctcard` 有隐藏 file input；
    **点头像拉起 filechooser、PUT `/api/accounts/avatar/image` 返回 200**、
    `body.warden-avatar-on` + `background-image: url("data:image/jpeg;base64,...")`、
    localStorage 落地；
  - 桌面 1280：卡片仍渲染（同一套排布）、侧栏**未**被隐藏、chips 不可见、
    页头头像行隐藏、无横向溢出。
- 产物区分度（`.deploycheck/probe-batch6-assert.mjs`）：**21/21**
  "我们的产物 HIT / 官方基线 MISS"（10 个 JS 字面量 + 7 个 CSS 标记/选择器 + 4 条选择器
  + **2 条负向守卫**）。
  > 负向守卫在这条腿上"有区分度"是因为官方基线**根本没有** `css/vaultwarden.css`
  > （只有官方 `styles.*.css`），`!!t.css` 短路为 false。它真正的不变量语义由 CI 对
  > **我们自己的产物** `grep -qE '^app-side-nav,'`（须不命中）来强制 —— 见下条。
- CI 断言升级为 12 组（`b76e994`）：新增组 11（JS 10 字面量）、组 12（CSS 标记 + 选择器
  + 2 条负向守卫）。两条负向守卫针对的是"**藏东西的规则漏出媒体查询**"这一类风险：
  F5 漏出 ⇒ 桌面端丢侧边导航；I 段漏出 ⇒ 桌面端丢账户入口。
- **三向区分度**（`.deploycheck/probe-batch6-thirdleg.mjs`，拿**上一轮产物** `p1/p11`
  复筛，`exit 0`）：

  | 组 | 条数 | 在 p11 上的期望 | 实测 |
  |---|---|---|---|
  | ① 旧断言（F/G/J7/J8/J9/J12/J14/J17，p11 已迁） | 14 | 全 HIT | **14/14 HIT** |
  | ② 第六批正向候选（JS 字面量 + CSS 标记） | 19 | 全 MISS | **19/19 MISS** |
  | ③ 负向守卫（顶层无泄漏） | 2 | 全 PASS | **2/2 PASS** |

  > ① 证明 p11 是"除第六批外都齐了"的有效对照，不是残废产物；
  > ② 证明这些断言确实**在等第六批到货**（我们 HIT / 官方 MISS 不是巧合）；
  > ③ 是**脚本逻辑修正**：负向守卫是"全局不变量"（在 p11 与我们的产物上都该成立），
  > 不是"第六批特性"，原先混进 ② 被 `if (hit) bad++` 误判 —— 单列成组后语义才正确。

---

### 第七批已落地：J6 + B 段（fork 提交 `3b2ef3a163`）

行内 TOTP 动态码徽章。这一批把 L4 里**唯一一处自写密码学**消掉了。

#### ① 五处运行期机制 → 官方服务 / 纯 CSS

| 维度 | L4 的做法 | 源码层做法 | 少了什么 |
|---|---|---|---|
| TOTP 算法 | 自写 Base32 / HOTP / TOTP（RFC 4648 / 4226 / 6238，约 150 行 WebCrypto） | 官方 `TotpService.getCode$(uri)`，底层是 Rust SDK 的 `generate_totp` | 150 行加密代码 + 自测负担 |
| 取密钥 | 运行期拿 `KeyService` + `EncryptService` 解密 `login.totp`；**跳过组织条目**（`c.key` 要另派生密钥） | `CipherView.login.totp` 本来就是明文 | 两处服务注入、组织条目显示不全的缺陷 |
| 行 ↔ 条目匹配 | 按"名称 + 用户名"把 DOM 行对上索引，重名要靠 fallback | 行组件手里就有 `cipher` | 整套匹配逻辑 |
| 进度条宽度 | 量 `offsetWidth` 换算成 px 写内联样式（含"缺口不计入时长"的补偿） | 纯 CSS `calc()`，**左右两段** | `offsetWidth` 读取与缓存 |
| 复制 | 手写 `navigator.clipboard` + `execCommand` 兜底 | 官方 `PlatformUtilsService.copyToClipboard` | 手写兜底分支 |

> ⚠️ 有意保留的一处差异：点击复制**不做 premium 门禁**。官方
> `CopyCipherFieldService.copy(..., "totp")` 会先过 `totpAllowed()`
> （`organizationUseTotp || hasPremiumFromAnySource`），非会员点下去是**静默失败**；
> 而 L4 的语义是"徽章常显、随时可复制"。所以这里只借官方的剪贴板原语。

#### ② 进度条：一段 + JS 补 20px → 两段纯 CSS

L4 是**一条** fill，宽度 `w`，被 `clip-path` 在中间挖掉 20px；为了让"可见长度"对上
剩余时间，它得在跨过中点的一瞬间把宽度 +20px（`w = lit <= track/2 ? lit : lit + GAP`）。

这一版拆成左右两段（`fill-a` / `fill-b`），各自 `calc(剩余比例 × (100% - 20px))`：

| 剩余比例 | 左段 | 右段 | 右端位置 |
|---|---|---|---|
| ≤ 0.5 | `p × track` | 0 | `p × track` |
| > 0.5 | `track/2` | `(p − 0.5) × track` | `50% + 10px + (p−0.5) × track` |

代数上右端位置恒等于 L4 的 `p × track + 20`，**逐像素等价**；但跨过缺口时右端是
连续推进的，不存在 L4 那个 +20px 的"跳一下"。

#### ③ 🔴 两个坑（都写进 B 段注释了）

**坑 1 — 列宽少给 24px 不是"挤一点"，是溢出到表格外。**

⋯ 那一列官方是 `tw-w-12`（48px），装不下 `84(徽章) + 8(间距) + 32(⋯)`。
`bit-table` 是 `layout=fixed`，而 td 又是 `text-align:right` + `white-space:nowrap`：
内容比内容盒宽时，整行**从内容盒左沿排起、向右溢出**，于是行内 ⋯ 跑到表格右边界
**外面 12px**，比表头 ⋯ 右 24px。⇒ 列宽给到 **148**（`12 + 84 + 8 + 32 + 12`），
两侧天然同列。L4 是用 `alignHeaderDots()` 每 2.4s 量一次去追这个差。

**坑 2 — 徽章必须脱离行盒，否则会把 ⋯ 的基线挤走。**

| 写法 | 徽章 vs 格心 | 带徽章行的 ⋯ vs 对照行 |
|---|---|---|
| L4：`::before { height:100%; vertical-align:middle }` 撑杆 | **Δ = 0** | 上移 **8.91px** |
| 只删掉撑杆（徽章留在行盒） | 偏低 2.33px | 上移 **6.58px** |
| **绝对定位（本版）** | **Δ = 0** | **Δ = 0.25px** |

根因：撑杆与 46px 的徽章都会改变**行盒基线**，与基线对齐的 ⋯ 被一起带走。
只有让徽章脱离行盒，⋯ 的基线才一分不动 —— 整列点永远是一条直线。
（对照行本来就偏高 2.75px，那是官方基线对齐的固有行为，量测已确认。）

> ⚠️ 选择器不能写 `td.warden-totp-host > .warden-totp-code`：徽章外面还套着
> `<vault-totp-badge>` 宿主元素，子选择器**命中不到**（踩过一次：结果 position 仍是
> `relative`，徽章被行盒基线带偏 2.33px）。要写
> `td.warden-totp-host > vault-totp-badge > .warden-totp-code`。

#### ④ 验证

**运行时**（`.deploycheck/verify-batch7.mjs`，dev server + 真实后端，**42/42 通过**）：

判据是几何 / 计算样式 / **密码学正确性**：

- **码的值**：播种时给测试条目写的密钥是 RFC 4226 附录 D 的公开向量
  `JBSWY3DPEHPK3PXP`，脚本自己按 RFC 6238 算出期望码再与页面显示值比对
  —— 断言的是"算对了"，不是"像六位数"。脚本自带自检：三条官方向量
  （T=59 / 1111111109 / 1234567890）必须先对上，否则拒绝执行。
- **进度条与秒数自洽**：由 `(左段+右段)/轨道` 反推周期，中位数 **30.006**（合法周期是 30）。
- **配色由数据驱动**：30 帧采样里 `sec ≤ 5 ⇔ #fdecec`、其余 `⇔ #eef3ff`，且两种都出现过。
- **对照行**：不带验证码的「Plain Control」**没有**徽章、也没有 `warden-totp-host` 类。
- **点击复制**：拦 `document.execCommand` 取到实际写入剪贴板的文本 = 6 位纯数字，
  且与点击前的码一致；`.warden-totp-copied` 态与「已复制」文案在 ~1.5s 内自行退场。
- **⋯ 不被挤走**：带徽章行与对照行的 ⋯ 纵向差 **0.25px**；且不越出表格右边界。
- 窄屏：徽章收窄到 78px、字号 12.5px、仍居中、无横向溢出、底栏仍 6 项。

> ⚠️ 测量坑：`transition: width .9s linear` 会让 `getBoundingClientRect` 读到动画中间值。
> 测量前必须关掉它，而 **devServer 的 CSP 不允许 `addStyleTag`**（`style-src` 白名单 + hash），
> 只能用 CSSOM：`el.style.transition = "none"`（程序化改 style 不受 `style-src` 管辖）。

**CI 断言升级为 14 组**：新增组 13（JS 13 个 `warden-totp-*` 字面量）、
组 14（B 段标记 + 6 条选择器 + `width: 148px` + **1 条负向守卫**）。这条负向守卫
`grep -qE 'warden-totp-host::before'` 必须不命中 —— 守的就是坑 2 里那个会挤走 ⋯ 的撑杆写法。

---

### 第八批已落地：J16 + E 段：独立「验证码」页（fork 提交 `9599eac4ea`）

新增 `apps/web/src/app/vault/totp-page/`（组件 93 行 + 模板 39 行）与
`oss-routing.module.ts` 里的一条 `path: "totp"`，**复用** J6 那颗行内徽章组件。

#### ① 三处运行期机制 → 源码结构

| 维度 | L4（运行期注入） | 这里 |
|---|---|---|
| 呈现 | 往 `body` 注入 `#warden-authview`，再靠 `body.warden-authview-on` 开关一层 `position:fixed; inset:0` 覆盖层 | **真路由**：随 `<router-outlet>` 落进 `bit-layout` 的 `main#main-content`，与其它页面同级 |
| 取数据 | 自维护的 `index`（§4 里解密 `name`/`username`/`totp`，且**跳过组织条目**） | 官方 `CipherService.cipherViews$()` —— 拿到的是已解密 `CipherView[]`，组织条目天然在内 |
| 渲染 | 手写 `createElement` + `renderAuthList()` 重入刷新 | `@for` + `computed`，搜索只是改一个 `signal` |
| 徽章 | 自写 Base32 / HOTP / TOTP 约 150 行 | 复用 J6 的 `vault-totp-badge`（底层官方 `TotpService`，即 Rust SDK 的 `generate_totp`） |

**刻意不搬** `.warden-auth-count`：L4 的 `ensureAuthView()` 从未创建过这个节点
（只在 CSS 里写了样式），属死代码。

#### ② 一个组件、两处复用：徽章改为 standalone

`VaultTotpBadgeComponent` 原本是 `standalone: false`、由 `vault-items.module.ts` 声明。
验证码页是**路由级组件**，不挂在任何 NgModule 的 `declarations` 里，于是把它改成
standalone（并在 `vault-items.module.ts` 里从 `declarations` 移到 `imports`）。

> ⚠️ standalone 之后，模板里的 `| i18n` 不再由宿主模块提供 —— 必须自己
> `imports: [I18nPipe]`，否则编译期报 **NG8004**。其余绑定（`@if` / `[class.x]` /
> `[style.width]` / 事件）都是内置的，不用 import。

#### ③ 底栏第 2 项：`/vault` → `/totp`

J17 那批留下的是"暂时指向 `/vault`、不点亮选中态"（见 §3 第三批 ③）。J16 落地后这个
替代方案到期：`routerLink` 改指 `/totp`，并补 `[attr.aria-current]="isActive('totp') ? 'page' : null"`。
选中态完全由 `isActive('totp')` 判定 —— **不需要** L4 那个每 2.4s 遍历一次的 `updateTabbar()`。

#### ④ E 段 CSS 的三处取舍

1. **去掉外层定位与底色**：L4 的 `.warden-authview` 是 `position:fixed; inset:0; background:#fff`，
   因为它是盖在密码库上的覆盖层；源码层它已经是一个正常页面，保留 fixed 会把它从文档流里摘出去
   （CI 里为此加了一条**负向守卫**：`^\.warden-authview` 必须不命中）。
2. **底部让位交给 H1 的 `padding-bottom: 74px`**（而不是像 L4 那样给覆盖层自己加 padding）——
   页面已经是 `main#main-content` 的子节点，H1 就是页面第一个元素。
3. **宽度约束落在宿主上**：`vault-totp-badge.warden-auth-badge { flex: 0 0 auto }` +
   `… .warden-totp-code { min-width: 96px }`。L4 把 `.warden-auth-badge` 加在 `.warden-totp-code`
   自身（那时徽章就是这个元素），而源码层外面多了一层宿主元素
   —— 只写一条 `.warden-auth-badge { flex; min-width }` 会**够不到内层**（踩过一次：
   flex 生效了，但 `min-width` 被 `.warden-totp-code` 的 84px 盖过，徽章比 L4 窄 12px）。

深色分支照旧跟随 `prefers-color-scheme`（跟系统，不跟应用内主题），与 B 段的做法一致。

#### ⑤ 验证

**运行时**（`.deploycheck/verify-batch8.mjs`，dev server + 真实后端，**40/40 通过**）：

- **每行渲染的是它自己的码**：播种两条密钥不同的条目（RFC 4226 附录 D 的
  `JBSWY3DPEHPK3PXP` 与 RFC 6238 附录 B 的 `GEZDGNBV…`），脚本按 RFC 6238 独立算出期望值
  逐行比对 —— "两行码不同且各自都对"才能证明是**按行绑定**，而不是把同一个值刷给所有行。
- **同一集合的第三方互证**：以密码库表格里挂了 `vault-totp-badge` 的行为基准，
  要求 `/totp` 的条目集合与之**严格相等**；不带验证码的对照条目（「Plain Control」）
  在数据层就被排除（`document.body.innerText` 里都不出现）。
- **不是那层 fixed 覆盖层**：徽章仍是 `position: relative`、`transform: none`、
  且不属于 `td.warden-totp-host`（B 段规则的完整选择器作用域）。
- **它是个真页面**：底栏在桌面端被 G 段藏起来（`display:none`）；窄屏 6 项可见，
  从底栏点进去能到 `/totp` 并点亮选中态 + `aria-current="page"`，同时「密码库」项**不**亮
  （验证 `isActive` 的前缀匹配没误伤）；列表底部不被 fixed 底栏遮挡（卡片底 345.59 ≤ 底栏顶 749）。
- **两条腿互证**：`/vault` 列表行与 `/totp` 页对同一条目算出的码一致。
- **搜索/复制**：按名称与用户名都能过滤；空结果是「没有匹配的条目」（而不是「还没有…」）；
  点一下写入剪贴板的正是这一行显示的 6 位数字（拦 `document.execCommand` 取实参核对）。

**CI 断言升级为 16 组**：组 15（J16 的 11 个 `warden-auth-*` JS 字面量 + `"/totp"`）、
组 16（E 段标记 + 9 条选择器 + **1 条负向守卫** `^\.warden-authview` 必须不命中）。
区分度经三向探针核过：官方基线**全 MISS**、上一批产物只命中第七批那几组。

> ⚠️ **不要**拿「验证码」/「搜索条目」这些中文串做 CI 判据 —— 它们从第七批起就已经在
> 底栏里出现过，按它们断言等于分不出第八批到底落没落。

#### ⑥ 🔴 本轮踩的两个坑（都是"判据本身错了"，不是源码错了）

**坑 1：`storageState()` 复制不了登录态 ⇒ 11 条窄屏断言全数误判。**
原写法是"桌面 context 登录一次，把 `storageState()` 交给窄屏 context"。实测窄屏 context
打开就是 `#/login` —— 因为 web-vault 的 token 存在 **sessionStorage**
（`<userId>_token_accessToken` / `_token_refreshToken` / `_crypto_localUserData` …），
而 Playwright 的 `storageState()` **只覆盖 cookies + localStorage**（`IndexedDB` 是空的，
`document.cookie` 也是空的）。dump 三类存储才确认。改法：窄屏一节**不再另开 context**，
而是 `page.setViewportSize({width:375})` 复用同一个已登录的 page —— 这一节的判据全在
CSS / 路由层（底栏显隐由 G 段媒体查询决定，与 UA 无关），语义等价，还顺带把"同一会话内
/vault → /totp 往返"也证了。

> 顺带修正 `b8-lib.mjs` 里一条**错误注释**：原先写着"缓存会话可避免重复登录被限流"，
> 实际 `savedState()` 从来不生效（每次都是真登录）。限流的正解是"一个脚本只登录一次、
> 场景复用同一个 page"，不是换 context。

**坑 2：`left === "auto"` 是个无效的代理判据。**
想用"相对定位的元素 `left` 应为 `auto`"来证明 B 段那条绝对定位规则没漏过来。实测
Chrome 在相对定位元素上把 `left` 报成 **used value（`0px`）**；逐条扫全部样式表确认
**没有任何规则**该元素声明过 `left`。也就是说这条断言必然失败，与被测源码无关。
改法：换成真正有区分度的两个判据 —— 是否落在 `td.warden-totp-host` 里（规则的作用域）
+ `transform === "none"`（那条规则同时带 `translateY(-50%)`）。

> 测试库提示：验证库里有一条早期遗留的、与本批种子无关的条目「TOTP Test」（带验证码）。
> 因此"恰 N 条"这类硬编码计数断言是脆的，本批已改为与徽章列**集合相等**。

---

### 第九批已落地：J15 窄屏下拉面板躲软键盘（fork 提交 `335a6f8ba0`）

这是 **P6 的最后一项**，至此源码侧迁移清单已清空。改动只有 3 个文件、104 行（含注释）。

#### ① 问题是什么

下拉面板是 `appendTo="body"` 的，ng-select 按**布局视口**算它的 `top/left`。
软键盘弹出时**布局视口不变**（键盘只是覆盖在上面），于是面板会被键盘盖住。
而 `visualViewport.height` 会随键盘缩小 —— 所以"键盘之上那块可见区"是**可测量的**，
按它把面板重算一次即可。这与 L4 §8.5 是同一个洞察。

#### ② 为什么落在 `bit-select`

`libs/components/src/select/select.component.ts` 是全应用**唯一**包装 ng-select 的组件，
一处生效、无需逐处适配；也不必像 L4 那样挂全局 `focusin` 监听去猜"哪个面板刚打开"。

算法本身照搬 L4（已验证过的），实现按源码层重写：

| 事项 | 做法 |
|---|---|
| 取面板元素 | `document.getElementById(this.select().dropdownId)` —— `dropdownId` 是 ng-select 的**公开**属性，面板的 `id` 就是它。**不要**用 `document.querySelector(".ng-dropdown-panel")`（"全局猜哪个面板"，同时存在两个面板时会改错对象） |
| 取字段矩形 | `this.select().element.getBoundingClientRect()` —— ng-select 公开的宿主元素 |
| 方向 | 按可见区算上下两侧可用空间，哪边大往哪边展开 |
| 高度 | 卡在可用空间内，并把面板夹进可见区 |
| ⚠️ 定位写法 | **只写 `top`，不写 `bottom`** —— `position: fixed` 的 `bottom` 参照的是**布局视口**，键盘弹起时布局视口不变，用 `bottom` 会正好把面板放到键盘后面 |
| 触发 | `(open)` 时接管；监听 `visualViewport` 的 `resize`/`scroll`；`(close)` 与组件销毁时摘除 |
| 桌面 | `min-width: 769px` 直接返回，一行都不碰（那里没有软键盘） |

与 M 段 CSS 的分工：M 段给"往下弹"的面板留了 `46vh` 兜底上限（桌面端生效）；
窄屏接管后由行内 `maxHeight` 覆盖它 —— 这依赖 M 段**刻意没写 `!important`**。

> `ng-select` 自带的 `position: absolute !important` 只作用于 `.ng-visually-hidden`
> （无障碍隐藏类），不影响面板 —— 行内样式能正常生效（动手前核过）。

#### ③ ★ 刻意**没有**搬的两处 L4 机制（这是"简洁优先"的取舍）

1. **`?sel=auto|above|off` 三模式 + `localStorage` 记忆**。
   那是"改不动代码"时代的调试脚手架：L4 只能往线上注入 JS，真机验证要靠 URL 参数切模式。
   在源码层它变成纯负担 —— 模式判定会渗进每一次定位计算，且多一条要长期维护的分支。
   **要调就直接改 `fitPanelToKeyboard()` 这一个方法。** CI 里加了负向守卫
   （`warden-sel-mode` 不得出现在产物里）防止它被写回来。
2. **v11 那版往应用自己的表单控件写 `readonly`/`inputmode`**。
   越界了 —— 它干扰了焦点与必填校验（用户会先看到应用自己的"必须输入内容。"、点第二次才展开），
   L4 自己也在 v12 全部撤掉。**不要写别人拥有的表单控件的状态属性。**

#### ④ 验证

**运行时**（`.deploycheck/verify-j15.mjs`，**11/11 通过**）：

无头浏览器没有软键盘，但"键盘盖住"的可测量形式就是 `visualViewport.height` 缩小，
所以脚本**注入一个伪造的 `visualViewport`**（真实 `EventTarget`，只是 `height`/`offsetTop` 可写），
`window.__kb(h)` 改值并派发 `resize`+`scroll` 即等价于"键盘弹起"。判的是**几何**，不是"写没写上 fixed"：

- 键盘把字段下方完全盖住（可见区只剩 211px）⇒ 面板**翻到字段上方**：
  面板 `[10,139]`、字段顶 `153`，且整体落在可见区内；行内 `top` 有值、`bottom` 是 `auto`。
- 可见区 700px、下方够 ⇒ 面板留在字段下方（面板顶 199 ≥ 字段底 191），底边 328 不越过键盘线 700。
- 宽度与左沿对齐字段（面板 `[11,353]` = 字段 `[11,353]`）；列表容器同步收窄（135px）。
- **负向**：桌面 1280 下 `position` 仍是 `absolute`、行内无 `fixed` —— 一行都没碰。
- 收尾：关闭后 DOM 里没有残留面板，也没有带行内 `fixed` 的残留。

**CI 断言升级为 17 组**：组 17 断言 `.main.js` 里有 `visualViewport` 与
`.ng-dropdown-panel-items`（官方基线各 **0** 次）+ 负向守卫 `warden-sel-mode` 不得出现。
⚠️ `.ng-dropdown-panel-items` **同时**出现在 `.vw.css` 的 M 段里，所以必须断言在 `.main.js` 里；
断言 `.vw.css` 等于分不出这一批落没落。

#### ⑤ 一处刻意的行为差异：窄屏"一律接管"

本实现（与 L4 同口径）在窄屏下**一律**接管面板定位，判定只看断点，**不看键盘是否弹起**。
原因：各家浏览器"键盘弹起时缩哪个视口"并不一致（有的缩 layout、有的只缩 visual），
把"是否接管"挂在这个判断上，会在部分 Android 上**静默失效** —— 而那正是最需要它的场景。
窄屏下由我们自己按上下两侧实际可用空间展开，是 ng-select 原生行为的**超集**。

> 验证脚本第一版把这条写成了断言（"无键盘时不得接管"），跑出来 FAIL —— **是断言错了不是代码错了**。
> 已改成守真正的不变量："接管后必须紧贴字段且完整落在可见区内"。

---

### 第十批已落地：窄屏省高度 / N 段（fork 提交 `bed28439be`）

> ⚠️ **这一批不是 L4 迁入的** —— `custom.js` / `custom.css` 里没有对应实现，是 P7 上线后
> 按用户反馈新增的。所以样式段标记**不占 L4 的字母/编号**，写成「N 段」（L4 的 J 编号里
> `J18` 已被"每秒 tick"占用，别复用）。

#### ① 改了什么

窄屏上有两行"只占高度、不承载信息"：

| 问题 | 改法 | 落点 |
|---|---|---|
| 页头那一行只剩一颗「新增」（左侧标题/面包屑、产品切换宫格已被 I 段藏掉） | 把「新增」**并进列表的「名称/选择」行**，页头那颗整块藏掉 | `vault-items.component.{ts,html}` + `vault-items.module.ts` + `vault.component.html` + `vault-header.component.{ts,html}` |
| 筛选面板顶部的「筛选」标题行只重复了下面开关上的同一句话 | 窄屏 `display:none` —— **只藏这一行**，`bit-search`（搜索密码库）与 `.warden-filter-toggle`（筛选开关）必须保留，它们是窄屏唯一的两条筛选入口 | `css/vaultwarden.css`（N 段） |

#### ② 权限位不重算：用模板引用变量从页头透传

`vault.component.html` 给 `<app-vault-header>` 加了 `#vaultHeader`，然后

```html
[canCreateCipher]="vaultHeader.canCreateCipher"
[canCreateCollection]="vaultHeader.canCreateCollections"
[newCipherMenuDisabled]="vaultHeader.isOrganizationSuspended"
[showNewCipherMenu]="filter.type !== 'trash'"
```

直接取页头实例上的 **public getter / `@Input`**，不在列表组件里重算一遍 ——
两处"能否新建 / 是否被停用"天然同源，不会出现"页头说能、行里说不能"的漂移。

> `vault-items` 是 `standalone: false`，模板能解析到 `vault-new-cipher-menu` /
> `app-coachmark` 靠的是 **`VaultItemsModule.imports` 里注册**，不是组件 TS 的 import。
> 所以 TS 侧**不要**加 `NewCipherMenuComponent` 的 import —— 那是死代码（加过一次，删了）。

#### ③ coachmark 锚点必须跟着换（最容易漏的一条）

`addItem` 那个 coachmark 步骤是 **`[bitPopoverAnchorFor]` 锚在按钮上**的，而 popover 走
cdk overlay（`new TemplatePortal(...)` 挂到 overlay 容器），**不受祖先 `display:none` 约束**。
所以若两处都挂锚点：两个弹层会**同时打开**，且锚到被藏起来那颗按钮的那个会拿到**全零 rect**
（`getBoundingClientRect()` 全 0）⇒ 弹层掉到视口左上角，`spotlight` 还会罩住一块空区域。

做法：让"当前可见的那颗"挂锚点 —— 列表侧是 `isNarrowViewport`，页头侧是它的取反
（`[coachmarkPopoverOpen]="!isNarrowViewport && addItemCoachmarkOpen()"`）。

> 为什么不引入响应式断点服务：这个判定**只在弹层"要开"时需要正确**，而弹层由
> `CoachmarkService.activeStepId` 信号驱动开合 —— 信号一变必然跟一次变更检测，
> 这个 getter 就会被重新求值。断点写 `window.innerWidth <= 768`，与 CSS 的 `@media`
> 对齐（源码与 CSS 两侧都留了互相指向的注释）。
>
> 这条**没做运行期验证**：coachmark 只在**首登用户第一次进密码库**时出现一次，
> 测试账号早已不是首登，强行重置会污染账号状态。只做了静态核对：两个作用域下各
> 1 个 `addItem` coachmark（运行期脚本里有断言），锚点开关见上。

#### ④ 与 L4 的关系（有意差异）

L4 是把官方 `vault-new-cipher-menu` 的 **DOM 节点**在运行期 `appendChild` 进
`#warden-headbar`，并记下原父节点/后继节点以便拼回（约 35 行 JS，见 I 段注释）。
这里改成**模板里两个实例、CSS 决定显示哪个**：无 DOM 搬运、无记账，且桌面↔窄屏 resize
（不刷新）能立刻跟着切。

代价：窄屏下 DOM 里确实有两个「新增」实体（页头那个 `display:none`），两个按钮共用官方
模板里写死的 `id="newItemDropdown"` ⇒ 窄屏下页面里有**重复 id**。影响面已核：
`<bit-menu aria-labelledby="newItemDropdown">` 会解析到第一个（被藏那颗），但两颗按钮
文案相同，读屏结果不变；除此之外没有任何地方按这个 id 取元素。CSS 侧为避免误伤，
压缩规则用 `.warden-headbar #newItemButton, .warden-headbar #newItemDropdown` 定位
（**不用** `.warden-headbar button`，那会把 `<bit-menu>` 里的菜单项一起压）。

#### ⑤ ⚠️ 踩坑：`header > .warden-head-new` 一条都命中不到

「新增」上面还套着三层 flex 包装，实测真实链是：

```
app-vault-header > app-header > bit-header > header.-tw-mt-6.-tw-mx-8.tw-mb-3
  > div.tw-flex
    > div.tw-ml-auto.tw-flex.tw-flex-col
      > div.tw-flex.tw-min-w-max.tw-items-center
        > div.tw-shrink-0.warden-head-new      ← 「新增」在这里
```

第一版写成**直接子选择器** `header > .warden-head-new`，结果：窄屏下页头那颗照旧显示
（`display: block`）、列表里又多一颗 ⇒ **两个入口**，而且页头那 56px **一点没省下来**。
运行期脚本第一条断言就 FAIL 暴露了它（`{"display":"block"}`）。

**教训**：这个仓库里"页头里的东西"几乎都不在 `header` 直下（I 段的规则也全是后代选择器）。
新增规则时要先落 DOM 链再写选择器，别照着模板层级的直觉写 —— 运行期脚本是唯一能抓到这个的关口
（`grep` 产物只能证明"规则写进去了"）。

#### ⑥ 验证

- 产物断言（CI 升为 **18 组**）：组 18 断言 `.main.js` 有 `warden-head-new`；
  `.vw.css` 有 `窄屏省高度` / `.warden-head-new` / `#newItemDropdown` / `filters-header`；
  外加负向守卫"藏页头那颗的规则不得顶格"。**区分度已核**：官方 v2026.6.4 包里
  `styles.*.css` 对这 5 个字面量全部 **0 次**（`warden-headbar` 也是 0），
  而 `newItemDropdown` / `filters-header` 在官方 **JS** 里有 ⇒ 所以这两条只能断言在
  `.vw.css`，断言 `.main.js` 等于"没迁也能过"。
- 运行期：`.deploycheck/verify-batch10.mjs`（dev server HTTPS :8099，登录一次复用同一个 page，
  375×812 → 1280×900 → 再切回 375，全程不刷新）—— **27/27 PASS**。关键读数：
  - 窄屏页头高度 **56px → 16px**（省掉那一行）；「新增」的垂直中心 320 落在「名称」th 的
    `[298, 343]` 内 ⇒ 与列头同行；`新增.right 139 ≤ 选择.left 159` ⇒ 顺序为 名称…新增 选择。
  - 筛选面板：`[data-testid="filters-header"]` 不可见，`bit-search` / `.warden-filter-toggle`
    都在；点开关能展开 **6/6** 个筛选区块。
  - 点列表里的「新增」真的弹出菜单（overlay 里 6 个 `role="menuitem"`）。
  - 桌面 1280：`app-vault-header` 高度 **93px**、页头「新增」可见、`.warden-headbar`
    `display:none`、「筛选」标题行可见 —— 与改动前一致，无横向溢出。
  - 桌面↔窄屏来回切（**不刷新**）显隐全部跟着走（这条守住"用 CSS 而不是 `@if` 决定显隐"的选型）。
  - 控制台：未捕获异常 **0**。⚠️ 另有 4 条 `Applying inline style violates ... style-src`
    的 CSP 报错，**在登录后、任何点击之前就已经存在**（4 → 4 不增长）⇒ 是 dev server 下
    Angular 走 inline style 注入组件样式、而应用自带 CSP 只放行 `'self'` 的固有噪声，
    与本批无关（脚本里单列 `cspNoise`，不混进 hard error）。

#### ⑦ 上线（2026-09-14 已部署）

用户确认后按「先 build 后 deploy」跑了两条 workflow（见 §1 的「上线记录 · 第十批」）：
build `34794128650` success（约 6 分钟）→ deploy `34794445635` success（约 5 分钟）。

线上复验（**同一个脚本**，只换目标，加 `WARDEN_TEST_PROXY=http://127.0.0.1:7890`）：
**27/27 PASS**，读数与本地完全一致（页头 16px / 桌面 93px / 新增在列头行 / 筛选标题行隐藏）。
线上 asset 哈希由 `main.682291b8…` 变为 `main.bcbe594e8d36993f0697.js`。

⚠️ **注意 dev server 下的 CSP 噪声在线上是 0 条**（线上 CSP 带 inline style 的 sha256 白名单），
所以线上那段读数比本地更干净 —— 别把"线上没有 CSP 报错"误当成"漏了某项断言"。

⚠️ **取线上产物两条路径口径**（写脚本时照这个，别取错）：
- 主包 **`/app/main.<hash>.js`**（本次 5.4MB）。**`/main.<hash>.js` 不存在**，会回 200 的 SPA
  404 HTML（约 23KB），`grep -c` 得 0 ⇒ 会被误读成"定制没上线"。
- 自定义 CSS 在 **`/css/vaultwarden.css`**（本次 58KB），**不在** `styles.<hash>.css` 里。


### 第十一批已落地：窄屏一批体验修复 / O 段（fork 提交 `633854e640`）

> ⚠️ 与第十批同理：**不是 L4 迁入的**，7 条全部来自上线后的用户反馈。段标记续第十批的「N 段」用「O 段」。

#### ① 7 条反馈 → 改法（含落点）

| # | 反馈 | 改法 | 落点 |
|---|---|---|---|
| **O1** | 顶部「搜索密码库」「筛选」外面还套着一层矩形框，白占高度；筛选应当直接贴在搜索框右侧 | 外层框 `border: 0`；`filters-body` 从块级流改 `flex-wrap` —— 搜索 `flex:1 1 0` 吃掉剩余、开关 `flex:0 0 auto` 贴右，两者**同行**；被 J9 收起的各筛选区块改 `flex:1 1 100%` 各占整行 | `css/vaultwarden.css` |
| **O2** | 点「选择」多了复选框列后，「名称」表头被挤到「新增」<u>下面</u> | 「新增」从「名称」列内移到**表头行最右格**（= 每行 ⋮ 所在那一列，`th:last-child`）；进选择模式由 CSS 让「新增」隐、⋮ 显 —— 两者互斥、共用一格 | `vault-items.component.html` + `css/vaultwarden.css` |
| **O3** | TOTP 倒计时从 0 回到 30 时，两根线**并行**涨满，不像"一根线扫过去" | 右段加 `transition-delay: 0.45s`：左段 0→0.45s、右段 0.45→0.9s，接起来正好一次**从左到右** | `css/vaultwarden.css`（**全局**：桌面端也显示这个徽章） |
| **O4** | 设置-我的账户：「保存」独独占一行 | 窄屏把「保存」挪到「名称」输入框**右侧**，官方那颗（表单末尾）藏掉 | `profile.component.{ts,html}` + `account.component.html` |
| **O5** | 「更改电子邮箱」整块常显，很占高度 | 窄屏默认**收起**；邮件行右侧给一颗「更改」入口；展开后「继续/取消」排在字段**上面**、「取消」未验证时也可见 | `profile` + `account` + `change-email.component.{ts,html}` |
| **O6** | 底栏挡住列表最后一条，且滚不动 | 滚动区底部留白改为从底栏**自身高度**推导（含 iOS 安全区），不再写死 `74px` | `css/vaultwarden.css` |

> 7 条反馈 → 6 项改动（O1 含"去掉外框"与"合行"两小条）。
> 除 O3 外**全部只写在 `@media (max-width: 768px)` 里** ⇒ 桌面端零变化（由 56 项断言里的反向检查守住）。

#### ② O2：为什么放到"⋮ 那一格"

这一格平时是官方的 ⋮（选项），而窄屏下 J14 已经把它默认隐掉（它管的全是"选中之后"的批量动作）。
所以窄屏这一格本就是**空的** —— 正好放「新增」，且进选择模式后 ⋮ 要露出来时，「新增」让位即可。
两者在时间上互斥，于是**不需要再给「名称」列让宽度** —— 这正是用户报的那个 bug 的解法。

⚠️ 这里必须同步改 **J14 那条规则**：它原本写的是

```css
.warden-selectable thead tr > th:last-child button   /* 后代选择器 */
```

后代选择器会连**同格内后加的「新增」按钮**一起命中 ⇒ 窄屏下「新增」被 J14 藏掉、页面里两个入口全没了。
改成直接子选择器 `> button` 后只命中 ⋮ 那颗。**这条是运行期脚本抓到的，`grep` 产物完全看不出来。**

#### ③ O3：那个"1 秒"的约束（第一版断言就写错了）

两条线的宽度由组件**每秒**推一帧写进 `[style.width]`。所以 `transition-delay + duration` 一旦 **> 1s**，
下一帧的宽度更新就会在 **delay 阶段**把正在跑的 transition 打断重来 ⇒ 看上去几乎不动。

约束是**每一段各自** `delay + duration ≤ 1s`，**不是**"三段时长相加 ≤ 1s"。
（第一版脚本按后者写，把 0.45+0.45+0.45 判成超限 —— 是**断言错了**，不是代码错了。）
本批取值：左段 `0s/0.45s`、右段 `0.45s/0.45s`。

#### ④ O4/O5：显隐一律走 CSS，不走 `@if`

窄屏隐藏、宽屏显示的东西（行内「保存」、邮件行入口、更改邮箱整块）**全部用 class + CSS 控制**，
不用 `@if`/断点判断。原因：`@if` 会把 DOM 真的摘掉，从窄屏切回宽屏后**再也回不来**；
而断点判断（读 `window.innerWidth`）不会跟着视口变化触发变更检测。
本仓库从 F5 段起就是这个选型，第 ⑤ 节那条"resize 来回切"断言专门守它。

O5 的展开态放在 **`account` 组件**（那一块在它的模板里），`profile` 只管 emit —— 状态只有一个持有者。
`change-email` 的「取消」从"仅在验证通过后渲染"改成**常驻**：窄屏下它就是"收起这一块"的出口。
宽屏用 CSS 还原官方行为（未验证时不显示）⇒ 桌面端零变化。

> 🔴 **本批踩得最狠的一次：CSS 权重**
> 两条都带 `!important`、同在 `@media` 里时，**权重高的赢**（与书写先后无关，`!important` 之间仍比 (a,b,c)）。
> - O1 输给 F3 的 `[data-testid="filters-body"] > div.tw-p-5 { display:block !important }`：F3 是 (1,1,4)、
>   我的是 (1,1,2) ⇒ 加个 `.tw-p-5` 抬到 (1,2,3) 才压住。
> - O5 的窄屏「取消」输给宽屏那条隐藏规则 (1,3,1)：窄屏改用两个选择器、其中带 `:not(.warden-cf-verified)`
>   → (1,3,2) 才赢。
>
> 教训：本仓库里"某某规则没生效"十有八九是权重，不是选择器写错；**写 `!important` 前先把双方的 (a,b,c) 算出来**。

#### ⑤ O6：把底栏高度与安全区抽成变量（共源）

底栏是 `position: fixed`（`.warden-tabbar`，G 段），实高 = **62px 内容 + 1px 上边框 + `env(safe-area-inset-bottom)`**。
H1 原本固定留 `74px`：**不带安全区的机型刚够**（74 > 63），**带安全区的差 23px**（刘海/手势条机型约 34px）；
条目数刚好铺满一屏时又没有可滚动余量 ⇒ 最后一条被压在栏下、还滚不动。

改法：`calc(var(--warden-tabbar-h) + var(--warden-tabbar-border) + var(--warden-safe-bottom) + 12px)`，
三个量在 `:root` 定义**唯一一份**，底栏（G 段）与底部留白共用。

- 少算那 1px 上边框就会出现"差一点点"的溢出（`getBoundingClientRect().height` 是 63 不是 62）。
- **顺带解决了"安全区测不了"的问题**：无刘海设备上 `env()` 恒为 0，浏览器里量不到刘海那一档；
  抽成变量后，测试里把 `--warden-safe-bottom` 改成 `34px` 就能把刘海机型**模拟出来**（见 ⑥）。

#### ⑥ 验证

- **产物断言（CI 升到 19 组）**：第 19 组分两处断言 —— 模板标志必须落进 **`.main.js`**
  （`warden-head-newbar` / `warden-email-row`），样式标志落进 **`.vw.css`**
  （`第十一批 / O 段` / `.warden-head-newbar` / `width 0.45s linear 0.45s` / `.warden-save-inline` /
  `.warden-change-email-open` / `.warden-cf-actions` / `--warden-safe-bottom`），
  外加两条负向守卫：**H1 的 `padding-bottom: 74px` 必须已消失**、**O6 的留白规则不得顶格**（顶格 = 桌面也留白）。
  - O3 断言的是**带 delay 的那条字面量**，不是 `.warden-totp-fill-b` —— 两个 class 是早前批次就有的，
    只喊 class 名字等于"O3 不修也能过"。
  - 不断言 `warden-head-new` 代表本批：它是**第十批**的标记，且是 `warden-head-newbar` 的子串。
- **运行期**：`.deploycheck/verify-batch11.mjs`（dev server HTTPS :8099，登录一次复用同一个 page，
  375×812 → 点「选择」→ 设置页 → 1280×900 → 切回 375 → 注入安全区，**全程不刷新**）—— **56/56 PASS**。
  关键读数：
  - O1 搜索与开关**同行**（`cy` 都是 220）；开关在搜索右侧（`searchRight 263.5 ≤ toggleLeft 271.5`）；外框 `borderTopWidth: 0px`。
  - O2 默认态「新增」在最右格且与「名称」文字不重叠（`btn [295,365]` / `name [22,48]`）；
    选择模式下「名称」文字 `[54,80]` 与「选择」胶囊 `[159,223]` 不重叠（**这就是用户报的那个 bug 的复现点**）。
  - O4 行内「保存」在输入框右侧（`inputRight 270 ≤ btnLeft 303`）、底边对齐差 1px。
  - O5 默认整块隐藏 → 点「更改」展开（`actionsTop 406.6 < fieldTop 454.6`，按钮在字段上方）→ 点「取消」收起。
  - O6 窄屏留白 `75px` ≥ 底栏实高 `63px` + 12；桌面仍是官方的 `32px`。
  - **安全区模拟**：底栏实高 63 → **97**（=62+1+34）、留白 75 → **109**，撤销后精确回到 63/75
    ⇒ 证明留白是**推导**出来的、不是抄的字面量。
  - 控制台：未捕获异常 **0**；CSP 噪声 4 条（`style-src` 的 inline style，dev server 固有，见第十批 ⑥ 的同一解释）。
- **⚠️ 本批新增的一条工程约定**：本仓库 ESLint 规则 `@angular-eslint/prefer-output-emitter-ref`
  会拦住 `@Output() x = new EventEmitter()`，**必须写 `readonly x = output<T>()`**
  （本批第一次提交被 pre-commit 挡下，改完才过）。另外 `output<void>()` 的 `.emit()` 可以直接不传参。

#### ⑦ 上线（2026-09-14 已部署，版本号升到 `v2026.8.1`）

按「先 build 后 deploy」执行。**必须先 build 再 deploy** —— 部署侧按 artifact 名
`bw_web_vault-<version>` 反查、取 `created_at` 最新且未过期的那个，顺序反了就会部署到**旧产物**。
run 明细与踩的两个坑见 §1 的「上线记录 · 第十一批 / O 段」。

**为什么本批要升版本号**：前一批与本批此前共用 `2026.8.0` ⇒ 产出的 artifact **同名**
（本次查证：仓库里 17 个 artifact，绝大多数都叫 `bw_web_vault-v2026.8.0`），
且 `vw-version.json` 在"同版本号重新构建"时**不会变** ⇒ 上线与否只能靠 asset 哈希推断。
升 patch 位后 artifact 名唯一、`vw-version.json` 本身就是上线判据。

> 🔴 **对既有认知的修正：不是"三处联动"，是「两处 + 两处」共四处。**
> 之前记的是"版本三处联动"（fork `package.json` = `inputs.version` 闸门 = `BW_WEB_VERSION` 默认值）——
> 那只覆盖了"改 CI 默认值"。**真要动 fork 的版本号，还得同步 lock 文件**：
>
> | # | 文件 | 改什么 | 不改的后果 |
> |---|---|---|---|
> | 1 | fork `apps/web/package.json` | `"version": "2026.8.1"` | 版本闸门 fail（`Verify version matches the source`） |
> | 2 | fork `package-lock.json` | `packages["apps/web"].version` | 构建走 **`npm ci`**，lock 与 package.json 必须一致 |
> | 3 | `build-web-vault.yaml` | `inputs.version` 的默认值 | 不传 `inputs` 时会用旧默认值 ⇒ 闸门 fail |
> | 4 | `push-cloudflare.yaml` | `BW_WEB_VERSION` 默认值 | **部署侧反查不到 artifact** |
>
> 注：只改 `apps/web`，其余 workspace（`apps/browser`/`cli`/`desktop`）的版本**不动** ——
> 它们不参与 web-vault 产物；`package-lock.json` 里 `node_modules/@bitwarden/web-vault` 是纯 link 条目、无版本。
> 另外 `apps/web/build/version.json` 是构建产物（gitignored），会自动重生成，别手改。
> 改前已用 API 确认**仓库里没有 `BW_WEB_VERSION` 变量**覆盖默认值（`variables total = 0`）。
>
> 🔴 改 workflow 的那次 push **必须带 `[skip ci]`**：推 `main` 会自动触发部署，
> 而此刻新名字的 artifact 还不存在 ⇒ 自动部署必然失败。正确顺序永远是「先 dispatch build → 再 dispatch deploy」。

**回滚**：`git revert` fork 的 `633854e640`（功能）与 `0409832f46`（版本号），
`BW_WEB_VERSION` 改回 `v2026.8.0`（+ 同步 lock 与 `inputs.version` 默认值），再重跑 `Build`。


### 第十二批已落地：搜索框 ↔ 筛选按钮 等高 / P 段（fork 提交 `e0a1f1a230`）

> 与第十/十一批同理：**不是 L4 迁入的**，来自上线后的用户反馈。段标记续「O 段」用「P 段」。

#### ① 反馈 → 改法

| # | 反馈 | 改法 | 落点 |
|---|---|---|---|
| **P1** | 密码库页的「筛选」按钮与「搜索密码库」表单**高度不统一** | O1 那条"把按钮收回内联尺寸"的规则里写的是 `padding: 0 12px !important`（**简写** ⇒ 纵向被一并清零）→ 改成只覆盖 `padding-left/right`，纵向交还 `bitButton` | `css/vaultwarden.css`（单文件） |

#### ② 根因：一个 `padding` 简写 = 18px

```
搜索框  bitFieldContainer(size=base) → tw-min-h-10                  = 40px
按钮    bitButton        (default)   → pt/pb(0.625rem - 1px) = 9px
                                        + 上下各 1px 边框
                                        + tw-text-sm/5 = 20px 行高  = 40px   ← 本来就一致
```

O1 为了让按钮不再是 `block` 整宽，写了 `padding: 0 12px !important`（本意只把横向 `px-4`=16px 收成 12px）。
简写把**纵向**也清成了 0 ⇒ 按钮只剩 `1 + 20 + 1 = 22px`，比搜索框矮 **18px** —— 用户一眼看到的就是这个。

修法（**只覆盖横向**，纵向留给 `bitButton` 自己，上游调尺寸时两边一起走）：

```css
padding-left: 12px !important;
padding-right: 12px !important;
```

> ⚠️ 别改成写死 `9px` 或 `height: 40px`：那是把"设计系统里的一致"换成魔数，上游一调尺寸又会错位。

#### ③ 为什么 56 项断言没拦住它（本批最值得记的一条）

O1 原来的断言是「搜索框与筛选开关**垂直中心差 < 8px**」。而矮按钮被 flex 的 `align-items: center`
居中之后，**中心自然就是齐的** ⇒ 22px vs 40px 照样 PASS。
**并排元素的验收必须直接断尺寸**（外框高度 |Δ| ≤ 1px），中心对齐只能当补充条件。
本批补上 P1（高度相等）与 P5（纵向 padding > 0），判据取**外框**而非内容盒 —— 用户看到的是外框。

#### ④ 负向守卫必须限定在规则块内

`padding: 0 12px !important` 在 CSS 里**还有一处无关的出现**（`.warden-head-newbar #newItemButton`）。
那处同时写了 `height: 28px`，清零纵向是**无害**的（本仓库另有 3 处同类：`.warden-select-toggle`、
`.warden-subnav a`、`.warden-acct-acts button`，都有显式 height）。
所以全局 `grep -qF 'padding: 0 12px !important'` 会**误报**。CI 第 20 组用
`grep -A4 -F -- '> .warden-filter-toggle button {' .vw.css | grep` 把范围收进规则块。

> ★ **判"有意 vs bug"的通用判据**：看同一条规则里有没有**显式 `height`**。
> 有高度 ⇒ 清纵向无害；没有高度（靠自然高度撑开）⇒ 一清就塌。

#### ⑤ 验证

- **运行期** `.deploycheck/verify-batch12.mjs`（8 项）：修前 40 vs **22**（FAIL 2 项），修后 40 vs 40；
- **回归**：第十一批 56/56 PASS（本地与线上各跑一次）；
- **CI**：第 20 组断言，用"从 workflow 抽取的命令原文"做了**双向预演** —— 修复后的 CSS `fail=0`、
  修复前的 CSS `fail=1` 且两条 ❌ 都触发（**只在修复后成立才算真守卫**）；
- **上线**：run 明细见 §1「上线记录 · 第十二批 / P 段」。

#### ⑥ 顺带修掉的一个真 bug：`.env.local` 里的注释会打断 shell 版加载器

跑 `poll-progress.sh` 时暴露：`.env.local` 开头是几行 `#` 注释，而两个 poll 脚本的加载器原本是朴素的
`while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done` ——
注释整行被当成**变量名**，`export` 报 `invalid variable name` 并**中断脚本** ⇒ 表现为"读不到 GH_PAT"。
已改为跳过空行 / 注释 / 非法 key，并剥掉可能的 CRLF。

> 为什么上一轮没发现：`b8-lib.mjs` 的加载器用正则 `^\s*([A-Z0-9_]+)\s*=` 筛 key，**天生不受影响** ——
> 所以只测 Node 侧根本测不出这个 bug。**"带注释的 `.env.local` + shell 加载器"这个组合必须单独跑一次。**


### 第十三批已落地：窄屏设置页的间距/换行 + 下拉面板跟随输入框 / Q 段（fork 提交 `3f26c76552`）

> 与第十/十一/十二批同理：**不是 L4 迁入的**，来自上线后的用户反馈（本次一次性 6 条）。段标记续「P 段」用「Q 段」。

#### ① 反馈 → 改法

| # | 反馈（用户原话要点） | 根因 | 改法 | 落点 |
|---|---|---|---|---|
| **Q1** | 发送页「新增文本/新增文件」后的删除日期、谁可以查看，工具页导入页的全部下拉**点箭头展不开，只能输入**；设置页的会话超时、密钥算法、外观页同理 | `bit-select` 为躲软键盘把面板改成 `fixed`（视口坐标），而 ng-select 的 `_handleWindowScroll()` 用**文档坐标**重写 `panel.top` ⇒ 页面一滚就把面板从输入框上方甩回下方（实测 508~585px），正好塞到键盘后面 | 见 ②：MutationObserver 盯 `style` | `libs/components/src/select/select.component.ts` |
| **Q2a** | 设置页改名字「似乎并不成功，名称一直都是 user」 | `PUT /api/accounts/profile` **本来就 200**，但顶部卡片读 `activeAccount$.name`，它只在登录/解锁时写过 | `submit()` 里补 `accountService.setAccountName(userId, name)` | `auth/settings/account/profile.component.ts` |
| **Q2b** | 账户页「指纹短语 → 名称」之间有空白行 | 40px = 指纹块 `margin-bottom` 16px + `.tw-grid.tw-gap-6` 的**行间距** 24px；改完还剩 16px，来自**指纹组件内部的 `<p>`** | 见 ④ | `css/vaultwarden.css`（Q1 段） |
| **Q2c** | 账户页「电子邮箱 → 危险操作区」之间有空白行 | 危险区首行是 `<h1 class="tw-mt-16">`，H3 段已把窄屏 `.tw-mt-16` 节流到 24px | 见 ⑤（权重坑） | `css/vaultwarden.css`（Q2 段） |
| **Q3** | 二级导航「我的账户/安全/外观…」下面一直横着一张 user/头像/邮箱/锁定/注销的卡片，希望**只在「我的账户」页**出现 | 卡片 `visible` 的路径判据是"以 `/settings` 开头" | 收窄到 `/settings/account` | `layouts/account-card.component.ts` |
| **Q4** | 域名规则新增自定义域名后弹出的表单是**双行**，希望默认一行、可换行再展第二行 | 模板写死 `rows="2"`（=40px） | `rows="1"`；折行后由 `bitInput` 自带的 `adjustTextareaHeight()` 自己长高（**这条依赖不能删**） | `settings/domain-rules.component.html` |
| **Q5** | 紧急访问页「已信任的紧急联系人」与「添加紧急联系人」字数多，希望拆成两行（标题一行、按钮第二行） | 那一行是 `tw-flex tw-items-center`（nowrap），标题被挤到 198px 折成 **3 行**（h=72px），按钮也被挤成 2 行（h=60px） | 见 ③：加标记类 + Q 段改 `flex-direction: column` | `auth/settings/emergency-access/emergency-access.component.html` + `css/vaultwarden.css`（Q3 段） |

#### ② 本批最硬的一条：`!important` **挡不住 ng-select 的 CSSOM 赋值**

`bit-select` 的 `fitPanelToKeyboard()` 把面板改成 `position: fixed`（否则软键盘会盖住它），这本身没错。
问题在 ng-select 的 `_handleWindowScroll()`：它监听 `document` 上的 `scroll`（**capture** ⇒ 抽屉里那个滚动区的滚动也算），
然后按 `containerRect.bottom - body.getBoundingClientRect().top` 算 `top` —— 那是**文档坐标**，只对 `position: absolute` 成立。

于是"点开 → 软键盘弹起 → 页面为把输入框顶进可见区而滚动"这一下，它会把我们刚放到**输入框上方**的面板又甩回**下方**
（实测 security-keys 页那一跳 **585px**、算法页 **508px**），正好塞到键盘后面 ⇒ 用户看到的就是"点下箭头没反应，只能输入"。

第一版按常规写法给行内值加 `!important` 钉死 —— **实测无效**：

```
滚动前  el.style.top = "8px"    priority = "important"
滚动后  el.style.top = "518px"  priority = ""          ← 被 ng-select 覆盖
```

原因：`CSSStyleDeclaration.top = "518px"`（ng-select 的 `_updateYPosition()` 就是这么做的）是**替换整个声明**，
会把优先级一起清成普通。**`!important` 只挡得住别的样式表规则，挡不住后写的 CSSOM 赋值。**

而且"比谁后写"也必输：我们自己的 `document` scroll 监听是同步跑的，ng-select 那一下走 `auditTime(0, …)`（延后到调度器）。
唯一稳的解法是**事件驱动地"它写一次、我们纠一次"** —— `MutationObserver` 盯面板的 `style` 属性，
回调里**先 `disconnect()` 再写、写完再 `observe()`**（防死循环；只观察面板自身且不开 `subtree`，所以子节点 `.ng-dropdown-panel-items` 的 `maxHeight` 不会反过来触发）。

另外补了两个"交还桌面端"的收尾（漏了会留下"桌面端面板再也回不到原生定位"的偶发 bug）：
`onClose()` 与 `DestroyRef.onDestroy` 里都 `stopGeometryWatch()`；进入宽屏分支时先 `clearGeometry()` 再停盯梢。

#### ③ 组件没有 `selector` ⇒ DOM 里根本不存在 `app-emergency-access`

紧急访问那个组件的 `@Component` **只声明了 `templateUrl`/`imports`，没有 `selector`** —— 路由直接实例化它，
Angular 渲染出来的是 `<ng-component>`。实测宿主链：
`h2 > div > section > bit-section > div > bit-container > ng-component > main` ⇒ CSS 里 `app-emergency-access` 永远选不中。

而 `div.tw-flex:has(> h2)` 这类结构选择器又会误伤别处（发件菜单里也有 `div.tw-flex`）。
所以照仓库既有的 `.warden-name-row` / `.warden-acctcard` / `.warden-head-newbar` 的路子，
在模板上加了**标记类 `warden-ea-head`**。（这条也是 CI 第 21 组的判据之一。）

#### ④ 空白行"修不净"时，往组件内部再挖一层

Q2b 先改了两条（`.tw-grid` 的 `row-gap` + 指纹块的 `margin-bottom`），实测**还剩 16px**。
用 `probe-b13-fingerprint.mjs` 逐层量下去：`div.bottom=190 / fp.bottom=174 / p.bottom=174 / p.margin-bottom=16px`
—— 那 16px 是 `account-fingerprint.component.html` 里那个短语段落的 `<p>` 自带的，
**不是 APP 自己的样式表给的**，所以只改外面那两条永远差 16px。补 `app-profile app-account-fingerprint p { margin-bottom: 0 }` 后落到 8px。

#### ⑤ 权重坑：`.tw-mt-16` 那个类名不能省

Q2c 第一版写的是 `main#main-content app-danger-zone > h1` —— **(1,0,3)**；
而 H3 段的 `main#main-content .tw-mt-16` 是 **(1,1,1)** ⇒ **H3 赢**（同为 `!important` 时比权重，与书写先后无关）。
补上 `.tw-mt-16`（变成 `h1.tw-mt-16` = (1,1,3)）才压得住。与 O5「取消」那条是同一类坑，选择器必须**照抄被覆盖的那条的类名**。

#### ⑥ 验收：判据本身也要先被证明

`verify-batch13.mjs` 共 22 条断言，本地与线上各跑一次全绿。**但判据写错过两次，都是"先假定、后实测"造成的**：

1. 「真实滚动后面板仍贴着输入框」原判据是"gap 差值 ≤ 3px" —— 面板高 466px 被视口上沿钳住，gap **必然**变。
   改为"**仍在上方**（`gap < 0`）且 top 没往下掉"。
2. 「紧急访问标题只占一行」原判据是 `height / lineHeight <= 1.2` —— 取到的却是**父容器**的 `lineHeight`
   （`normal` → 24px），而 h2 自身是 36px ⇒ `36/24=1.5`，把**已经修好的单行**判成失败。
   改为用 `Range.getClientRects()` **数真实行数**：按纵向重叠聚类（容差 4px）——
   不去重的话，按钮里"图标 + 文字"两个 rect 的 top 差 1~3px，会把**单行按钮**数成 2 行（这条也踩了一次）。

> ★ 通用教训：**断言的条件必须先在一个"已知修好"的界面上验证它能给出通过值**，否则你验的是判据不是功能。
> 这与第十二批 P 段那条（"垂直中心对齐"在按钮矮 18px 时照样通过）是同一个病：**弱判据会静默放行**。

#### ⑦ 验证

- **运行期** `.deploycheck/verify-batch13.mjs`（22 条）：本地 22/22、线上 22/22，读数完全一致
  （面板 gap −508px 稳定、两处留白 40/24px → **8px**、改名 PUT 200 且卡片**立即**变、卡片只在账户页、
  textarea 30px 单行且填长内容长到 40px、紧急访问标题 1 行 / 按钮第二行）；
- **CI**：第 21 组断言（`warden-ea-head` / `attributeFilter:["style"]` / `Q. 第十三批` / 三条选择器 +
  "拆行规则必须在 @media 内"的负向守卫）。判据全部做过**基线取证**：`v2026.8.2` 线上产物里
  `warden-ea-head` / `attributeFilter` / `Q. 第十三批` **都是 0 次**（`setAccountName` 是 1 次，故弃用）；
  并用 `run-artifact-asserts.py` 在**本机生产产物**上预演 21 组全绿（避免断言写错让 CI 红一轮）；
- **上线**：run 明细见 §1「上线记录 · 第十三批 / Q 段」。


## 4. 移动端专项（你特别强调的部分）

`custom.css` 里 `@media` 共 **17 处，全部是 `max-width: 768px`**（另有 3 处 `prefers-color-scheme: dark` 深色模式）。

### 移动端不适配的 4 个根因（来自 L4 头部实测记录）

| # | 根因 | 处理 |
|---|---|---|
| 1 | `index.html` 的 `<meta viewport content="width=1010">` —— 强制整页缩放 | ✅ **P2 已修**（源码级 `device-width`） |
| 2 | `bit-layout > .tw-grid` 被 Angular 写成内联 `grid-template-columns: 0px minmax(384px,1fr) 0px` —— <384px 屏必溢出 | ✅ **已修**（J8，`8d4292dee2`） |
| 3 | 保险库页内部 flex 三栏（筛选 1/4 + 列表 3/4），窄屏筛选列只剩 **67px** | ✅ **已修**：F2 改纵向堆叠（`8d4292dee2`）+ J9 把 11 个筛选区块收进默认收起的开关（`2a8039eb24`） |
| 4 | 全局侧边导航窄屏被应用自身收成 0px 且**无汉堡按钮** | ✅ **已修**：J17 底部标签栏（`cbab779ca1`）提供一级入口 + **F5 段隐藏原生侧栏**（`3457e7ccb7`）；二级由 J11 的 chips 接管（设置 5 项 / 工具 3 项） |

> ⚠️ **已知血案（务必避免重犯）**：v5 曾用 `grid-template-columns: 0 minmax(0,1fr) 0 !important` 锁死三列网格，
> 导致第 3 列（承载 `bit-dialog` 的"浮层列"）被压成 0，Send 的新增对话框变成 `width:0 / left:视口宽`，
> 整个跑到屏幕外 —— 表现为「点新增没反应」。**源码层绝不能给那一列写 `!important`。**

---

## 5. 建议的迁移顺序（每步都可独立验证）

| 序 | 内容 | 类型 | 风险 | 依赖 | 状态 |
|---|---|---|---|---|---|
| ~~1~~ | ~~H + K + M（留白 / 对话框 / 下拉加固）~~ | CSS | 极低 | — | ✅ `541d62f5a2` |
| ~~2~~ | ~~F 段里不依赖 JS 的部分：F1 溢出锁 / F2 纵向堆叠 / F3 高度上限~~ | CSS | 低 | — | ✅ `8d4292dee2` |
| ~~3~~ | ~~J8：网格最小宽度按容器封顶~~ | TS | 低 | — | ✅ `8d4292dee2` |
| ~~11~~ | ~~**J17 + G 段：底部标签栏**~~ | 新组件 | **高** | 官方无对应物 | ✅ `cbab779ca1` ⬅ **keystone，已提前完成**（理由见 §3 第三批 ①） |
| ~~5a~~ | ~~**J9：窄屏筛选抽屉** + C 段筛选半边~~ | 组件 | 中 | `app-vault-filter` | ✅ `2a8039eb24`（理由见 §3 第四批 ①） |
| ~~4a~~ | ~~**J7「选择」半边 + J14 选择模式 + A 段**~~ | 模板 | 中 | — | ✅ `6528392574`（见 §3 第五批） |
| ~~4b~~ | ~~J7「新增」半边 + **I 段**：把 `vault-new-cipher-menu` 搬进表格行 + 藏掉窄屏重复页头~~ | 模板+CSS | 中 | **J10/J11** | ✅ `3457e7ccb7` —— 「新增」改以**不同方式**落地：页头塌成只含「新增」的紧凑工具行，不做 DOM 搬运（见 §3 第六批 ②） |
| ~~5b~~ | ~~F 段其余：**「隐藏 side-nav」**~~ | CSS | 中 | J17 + 4b | ✅ `3457e7ccb7`（F5 段） |
| ~~6~~ | ~~J6 + B 段：TOTP 徽章（换官方 `totp-countdown` + 改视觉形态）~~ | 组件 | 中 | 官方组件已存在 | ✅ `3b2ef3a163`（见 §3 第七批） |
| ~~7~~ | ~~J12：行内菜单「文件夹」~~ | 模板 | 低 | — | ✅ `8d4292dee2`（L 段 CSS 一并淘汰） |
| ~~8~~ | ~~J11 + J10 + I/J/J2/J3 段：二级导航 + 账户卡片~~ | 组件 | 中 | — | ✅ `3457e7ccb7`（见 §3 第六批） |
| ~~9~~ | ~~J13：头像上传~~ | 组件 | 中 | 后端已就绪 | ✅ `3457e7ccb7`（随 J10 的账户卡片落地） |
| ~~10~~ | ~~J16 + E 段：独立「验证码」页~~ | 路由+组件 | 中 | — | ✅ `9599eac4ea`（见 §3 第八批；底栏第 2 项已由 `/vault` 改为 `/totp`） |
| ~~12~~ | ~~J1–J5 + J18–J19：删除绕路代码~~ | 清理 | 低 | 前置全部完成 | ✅ **无源码侧动作** —— 这 7 项全是 L4 的运行期绕路代码（劫持 fetch+Authorization / 自写 Base32+HOTP+TOTP / 走 DI 解密 sync 密文 / 自建 TOTP 索引 / MutationObserver 认行 / 每秒 tick / 装饰列表主循环）。源码层由官方服务与组件直接替代，**不存在对应实现可删**；它们的"退役"就等于 P7 删掉整个 `custom/`，所以随第 13 项一起收口 |
| ~~12b~~ | ~~J15：窄屏 ng-select 面板躲软键盘~~ | 组件 | 低 | — | ✅ `335a6f8ba0`（见 §3 第九批） |
| ~~13~~ | ~~**P7**：删 `custom/` + 切线上~~ | — | **高** | — | ✅ 已执行：`custom/`（3262 行）与 CI 注入步骤已删、加负向守卫、`BW_WEB_VERSION` 默认改 `v2026.8.0`；线上切换记录见 §1 说明 |

> **顺序修正记录（2026-09-13）**：原表把 J17 放在第 11 位、J7 放在第 4 位。
> 调研 J7 时发现真实依赖是 `J7 ← I 段 ← J17 + J9`，即**先做 J17 才能做 J7**。
> 已把 J17 提前完成（`cbab779ca1`）、随后完成 J9（`2a8039eb24`，见 §3 第四批 ①）。
> **再拆一轮**：J7 其实有两半 —— 「选择」半边无依赖（已随 `6528392574` 落地，见 §3 第五批），
> 「新增」半边要等 I 段，而 I 段要等 J10/J11。所以第 4 行拆成 4a（已完成）/ 4b（下一步），
> 4b 与 5b 必须同批：藏掉页头的同时要把 side-nav 与「新增」的去处安排好，
> 否则移动端会分别失去导航入口和新增入口。

> **验收口径修正（2026-09-13，第六批）**：用户明确 "**你可以以不同的方案实现相同的效果试试，
> 因为确实有一些是冗余的**"。此后验收标准从"逐条复刻 L4 的实现方式"改为
> **「功能等价 + 运行时可测量」**：
> - L4 的运行期机制（注入 DOM / 劫持 fetch / body 类驱动 / 按文案点菜单）只有在
>   **没有官方对应物**时才照搬；
> - 有官方服务/组件可用的（锁定、注销、取 token、路由跳转）一律走官方；
> - 判定条件一律用**结构判定**（`:has()`）代替 JS 挂 body 类；
> - 唯一的硬约束是 `tests/mobile-regression.mjs` 已经断言过的 DOM 标记
>   （`#warden-tabbar` / `#warden-subnav` / `#warden-acctcard` / `.warden-acct-*` /
>   `body.warden-avatar-on`）—— 动它们要连回归脚本一起改，收益为负。
> - 允许的差异必须**写进 §3 对应批次**并注明可回退性（如 4b 多占一行高度）。

---

## 6. 两个并行原则

1. ~~**双轨期**~~（**已结束**）：迁移期间 `custom.css` 保持不动（线上还在用）。CSS 重复声明是幂等的，不会互相干扰。
   P7 已一次性删掉整个 `custom/`，双轨期随之结束。
2. **每步都要能验收**：`localhost:8080`（改完即时可见）→ CI 产物断言 → 真机走查。
   仓库里已有 `tests/mobile-regression.mjs`（39 KB 移动端回归脚本）可复用。
