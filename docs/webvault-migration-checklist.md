# L4 → 源码 迁移对照清单

> 生成 2026-09-13 ｜ 对照对象：`custom/custom.js`（**1983 行**）+ `custom/custom.css`（**1279 行**）
> 结论一句话：**P0–P4 换的是"地基"，功能迁移（P5/P6）刚开始。**
> 状态：⬜ 未开始 ｜ 🟡 进行中 ｜ ✅ 已完成

---

## 0. 为什么 localhost:8080 上看不到你的功能

这是最容易被误解的一点，先讲清楚：

| | 线上 shypwd.cc.cd | localhost:8080（dev server） |
|---|---|---|
| 前端产物 | 旧：`v2026.6.4` 官方 tarball | 新：**fork 源码**实时构建的 `v2026.8.0` |
| 你的 L4 定制 | **有** —— `push-cloudflare.yaml` 部署时注入 `custom.js` / `custom.css` | **没有** —— dev server 不做注入那一步 |
| 源码级定制 | 无 | 有：视口 / 密码下限 / `vaultwarden.css`（含本轮新加的 H+K+M） |

所以 8080 上看到的是**官方原版 UI**，不是你熟悉的那套。你的功能**一个都没丢**，它们还在 `custom/` 里、线上仍在用。

迁移的本质：把「部署时从外面注入」改成「构建时就在源码里」。做完之后，8080 上会**直接出现**那些功能。

---

## 1. 阶段完成度

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** 建 fork | `shiranzby/vw_web_builds` @ `shypwd`，fork 点 = 官方 `v2026.8.0` 的 `a868ea0` | ✅ |
| **P1** 安全阀 | `VAULT_REPO` 换 fork，产物与官方**逐字节同源**（281 文件 / 272 SHA256 相同 / 总字节相同） | ✅ |
| **P2** 收编注入 | 视口 + 密码下限 + `vaultwarden.css` 进源码；`webvault/patches/` 退役 | ✅ |
| **P3** 本地热重载 | `https://localhost:8080`，改源码即时生效（已实测逐字节验证） | ✅ |
| **P4** 版本兼容评估 | 结论：**零后端改动**，新功能默认全关，UI 行为 ≈ 6.4 | ✅ |
| **P5** 迁样式类改动 | A/B/C/E/F/G/H/I/J/J2/J3/K/L/M 共 14 段 / 1248 行 | 🟡 **H+K+M 已落地**（210 行）、**F 主部已落地**（102 行）、**G 段随 J17 落地**（81 行）、**C 段筛选抽屉半边随 J9 落地**（39 行）、**A 段 + C 段「名称」表头工具行随 J7 落地**（150 行，见 §3 第五批）、**L 整体淘汰**（J12 改走官方对话框） |
| **P6** 迁结构类改动 | TOTP 徽章 / 表头工具行 / 头像卡片 / 验证码页 / 底部标签栏 等 | 🟡 **已落地：J12「文件夹」+ J8 网格 + J17 底部标签栏 + J9 筛选抽屉 + J14 选择模式（＋J7 的「选择」半边）**；其余待做：J7「新增」半边 + I 段、J6、J10/J11、J13、J16、J15 |
| **P7** 拆 L4 + 切线上 | 删 `custom/`、删 CI 注入步骤、独立预览环境验收后切换 | ⬜ |

---

## 2. 功能清单（JS 侧 `custom.js`，14 节）

| # | 功能（你会看到什么） | L4 位置 | 行数 | 源码层落点 | 状态 |
|---|---|---|---|---|---|
| J1 | 劫持 fetch/XHR 抓 `/api/sync` 与 Authorization 头 | §1 (57–162) | 106 | **全删** —— 源码层直接用 `SyncService` / API 客户端 | ⬜ |
| J2 | 自实现 Base32 / HOTP / TOTP | §2 (163–262) | 100 | **全删** —— 官方已有 `totp.service.ts` | ⬜ |
| J3 | 通过 DI 容器解密 sync 密文 | §3 (263–289) | 27 | **全删** —— 用官方 `CryptoService` / `CipherService` | ⬜ |
| J4 | 建立 TOTP 索引 | §4 (290–352) | 63 | **全删** —— 官方 `CipherView` 直接带 `totp` 字段 | ⬜ |
| J5 | 按 DOM 认行（MutationObserver + 400ms 防抖） | §5 (353–394) | 42 | **全删** —— Angular 数据绑定替代 | ⬜ |
| **J6** | **行内 TOTP 动码徽章**（圆角矩形 + 下沿进度条 + 中间挖空显秒数，<5s 转红） | §6 (395–627) | 233 | 用官方 `BitTotpCountdownComponent`（`libs/vault/src/components/totp-countdown/`）改视觉形态：环形→下边缘线性、阈值 7s→5s | ⬜ |
| **J7** | **表头工具行**：「选择」+「新增」并入"名称"那一行 | §7 (628–649) | 22 | `vault-items.component.html` 的表头 | ⬜ |
| J8 | 外层网格 `relaxGrid()`（把 `minmax(384px,1fr)` 换成 `minmax(0,1fr)`） | §7.0 (650–769) | 120 | **改 SCSS 源码** —— 不再需要运行期替换 | ✅ `8d4292dee2` |
| J9 | **窄屏筛选抽屉**（11 个 chip 收成按钮 + 竖排面板） | §7.1 (770–840) | 71 | 官方 8.0 新增的 `filter-menu` 组件（`libs/vault/src`，+1253 行）**未采用** → 改在官方 `vault-filter` 组件内加展开态 + 收起 CSS（见 §3 的 ④） | ✅ `2a8039eb24` |
| J10 | 窄屏「设置」页账户卡片 | §7.2 (841–868) | 28 | 设置页组件 | ⬜ |
| J11 | 窄屏二级导航 chips（设置页 / 工具页） | §7.3 (869–901) | 33 | 官方侧栏组件 | ⬜ |
| **J12** | **行内三点菜单补「文件夹」**（原「添加到文件夹」；v8 起改名并移到「收藏」之下、「编辑」之上） | §7.4 (902–1240) | 339 | `vault-cipher-row.component.html` 的 `bitMenuItem` 列表 | ✅ `8d4292dee2` |
| **J13** | **头像：点自己头像直接换图（真实上传，跨端同步）** | §7.5 (1241–1524) | 284 | 官方 `bit-avatar` + **后端已就绪**（`PUT\|DELETE /api/accounts/avatar/image`） | ⬜ |
| **J14** | **移动端选择模式 / 批量操作**（v10 起不自建底部条，复用应用自带） | §8 (1525–1582) | 58 | 与 J7 同处表头；官方 8.0 有 `batchBarService` | ✅ `6528392574` —— 胶囊驱动官方 `SelectionModel`，退出时 `selection.clear()`；官方批量条受 `PM37785` 开关控制而**我们的后端没开**（线上 `/api/config` 的 featureStates 无此项），与 L4 §8 的最终形态一致（不自建底部条） |
| J15 | 移动端 ng-select 面板躲软键盘（v12，按 `visualViewport` 动态算） | §8.5 (1583–1659) | 77 | 官方 `bit-select`；样式侧已在 **M 段**落地，动态部分待迁 | ⬜ |
| **J16** | **独立「验证码」页**（复刻 Bitwarden Authenticator 卡片列表） | §9 (1660–1768) | 109 | 新路由 + 官方 totp 组件 | ⬜ |
| **J17** | **窄屏底部标签栏**（密码库/验证码/发送/工具/报告/设置） | §10 (1769–1856) | 88 | 官方无此物，需新组件 | ✅ `cbab779ca1` |
| J18 | 每秒 tick | §11 (1857–1872) | 16 | 官方组件的 rxjs interval 自带 | ⬜ |
| J19 | 装饰列表 + 主循环 | §12 (1873–1983) | 111 | **全删** | ⬜ |

**小计：可全删 6 节 = 466 行；需重写 13 项 = 1462 行。**

> 标 **粗体** 的是你实际感知最强的功能。

---

## 3. 样式清单（CSS 侧 `custom.css`，14 段）

**关键判据**：这段 CSS 锚在「官方 DOM」上（可以独立搬），还是锚在「`custom.js` 注入的 `warden-*` 元素」上（必须等对应 JS 迁完）？

| 段 | 内容 | 行数 | 依赖的 `warden-*` | 能否独立搬 | 状态 |
|---|---|---|---|---|---|
| A | 塌缩「复选框列」与「站标列」 | 60 | `warden-selecting`（状态类） | 需 JS | ✅ **已落地**（随 J7/J14，`6528392574`）—— 但**只作用于窄屏**（有意差异，见 §3 第五批 ③） |
| B | 行内 TOTP 徽章 | 30 | `warden-totp-host` | 需 J6 | ⬜ |
| C | 「名称」表头工具行 + 窄屏筛选抽屉 | 157 | 12 种 | 需 J7/J9 | 🟡 **筛选抽屉半边**随 J9 落地（独立「J9 段」39 行）；**「名称」表头工具行的「选择」半边**随 J7 落地（`6528392574`）；「新增」并入待 I 段 |
| E | 独立「验证码」页 | 138 | 17 种 | 需 J16 | ⬜ |
| F | **移动端（≤768px）布局** | 188 | `warden-filter-open` 等 4 种 | 部分需 JS | 🟡 **F1/F2/F3 已落地**（102 行）；「隐藏 side-nav」的阻塞已解除（J17 就位）—— 待与 J9 一同收尾 |
| G | 底部标签栏样式 | 81 | `warden-tabbar` 等 | 需 J17 | ✅ **已落地**（随 J17 同批迁入，去注释后与 L4 **逐字节相同**） |
| **H** | **窄屏留白压缩（全站变紧凑）** | 90 | 仅 H7 一条 | ✅ **可独立搬** | ✅ **已落地** |
| I | 窄屏去重复页头 + 账户动作挪设置页 | 141 | 11 种 | 需 J10/J11 | ⬜ |
| J | 窄屏二级导航 chips | 69 | `warden-subnav` | 需 J11 | ⬜ |
| J2 | 有二级导航时压掉大标题页头 | 22 | `warden-has-subnav` | 需 J11 | ⬜ |
| J3 | 藏掉应用自带「64px 大头像 + 自定义」行 | 23 | 2 种 | 需 J13 | ⬜ |
| **K** | **窄屏对话框压缩（新增/编辑条目、Send）** | 96 | **无** | ✅ **可独立搬** | ✅ **已落地** |
| L | 行内「文件夹」浮层 | 128 | 9 种 | 需 J12 | ✅ **整体淘汰**（J12 改用官方 `bulk-move-dialog`，自建浮层/遮罩/窄屏抽屉全不需要） |
| **M** | **ng-select 下拉加固** | 25 | **无** | ✅ **可独立搬** | ✅ **已落地** |

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

## 4. 移动端专项（你特别强调的部分）

`custom.css` 里 `@media` 共 **17 处，全部是 `max-width: 768px`**（另有 3 处 `prefers-color-scheme: dark` 深色模式）。

### 移动端不适配的 4 个根因（来自 L4 头部实测记录）

| # | 根因 | 处理 |
|---|---|---|
| 1 | `index.html` 的 `<meta viewport content="width=1010">` —— 强制整页缩放 | ✅ **P2 已修**（源码级 `device-width`） |
| 2 | `bit-layout > .tw-grid` 被 Angular 写成内联 `grid-template-columns: 0px minmax(384px,1fr) 0px` —— <384px 屏必溢出 | ✅ **已修**（J8，`8d4292dee2`） |
| 3 | 保险库页内部 flex 三栏（筛选 1/4 + 列表 3/4），窄屏筛选列只剩 **67px** | ✅ **已修**：F2 改纵向堆叠（`8d4292dee2`）+ J9 把 11 个筛选区块收进默认收起的开关（`2a8039eb24`） |
| 4 | 全局侧边导航窄屏被应用自身收成 0px 且**无汉堡按钮** | 🟡 **J17 底部标签栏已落地**（`cbab779ca1`）替代入口；「窄屏隐藏 side-nav」那半边仍**刻意未做**，待与 J9 同批收尾（见 §3 的 ⚠️） |

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
| **4b** | J7「新增」半边 + **I 段**：把 `vault-new-cipher-menu` 搬进表格行 + 藏掉窄屏重复页头 | 模板+CSS | 中 | **J10/J11**（账户动作要有地方去） | ⬅ **下一步**（必须与 5b 同批） |
| 5b | F 段其余：**「隐藏 side-nav」**（J17 就位后阻塞已解除，须与 I 段同批，见 §3 的 ⚠️） | CSS | 中 | J17 + 4b | ⬜ |
| 6 | J6 + B 段：TOTP 徽章（换官方 `totp-countdown` + 改视觉形态） | 组件 | 中 | 官方组件已存在 | ⬜ |
| ~~7~~ | ~~J12：行内菜单「文件夹」~~ | 模板 | 低 | — | ✅ `8d4292dee2`（L 段 CSS 一并淘汰） |
| 8 | J11 + J10 + I/J/J2/J3 段：二级导航 + 账户卡片 | 组件 | 中 | — | ⬜ |
| 9 | J13：头像上传 | 组件 | 中 | 后端已就绪 | ⬜ |
| 10 | J16 + E 段：独立「验证码」页 | 路由+组件 | 中 | — | ⬜（落地后把底栏第 2 项的 `routerLink` 由 `/vault` 改为 `/totp`） |
| 12 | J1–J5 + J18–J19：删除绕路代码 | 清理 | 低 | 前置全部完成 | ⬜ |
| 13 | **P7**：删 `custom/` + 切线上 | — | **高** | 需独立预览环境 | ⬜ |

> **顺序修正记录（2026-09-13）**：原表把 J17 放在第 11 位、J7 放在第 4 位。
> 调研 J7 时发现真实依赖是 `J7 ← I 段 ← J17 + J9`，即**先做 J17 才能做 J7**。
> 已把 J17 提前完成（`cbab779ca1`）、随后完成 J9（`2a8039eb24`，见 §3 第四批 ①）。
> **再拆一轮**：J7 其实有两半 —— 「选择」半边无依赖（已随 `6528392574` 落地，见 §3 第五批），
> 「新增」半边要等 I 段，而 I 段要等 J10/J11。所以第 4 行拆成 4a（已完成）/ 4b（下一步），
> 4b 与 5b 必须同批：藏掉页头的同时要把 side-nav 与「新增」的去处安排好，
> 否则移动端会分别失去导航入口和新增入口。

---

## 6. 两个并行原则

1. **双轨期**：迁移期间 `custom.css` 保持不动（线上还在用）。CSS 重复声明是幂等的，不会互相干扰。
   等 P7 切换时，一次性删掉 `custom/` 里已迁完的段落。
2. **每步都要能验收**：`localhost:8080`（改完即时可见）→ CI 产物断言 → 真机走查。
   仓库里已有 `tests/mobile-regression.mjs`（39 KB 移动端回归脚本）可复用。
