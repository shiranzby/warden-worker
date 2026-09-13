# custom/ 定制层设计方案

> 目的：把 `custom/` 从"一堆互相打架的补丁"变成**边界清楚、失效可预警、可逐个重构**的定制层。
> 本文只描述**设计与边界**，不含具体实现改动。实现按 §6 的顺序逐个来。

---

## 1. 为什么要重写这份设计

`custom/` 是在 **L3（`public/web-vault/`，预编译的 Bitwarden Angular 应用，142 MB，不进仓库）**
之上做 DOM 猴补丁：没有组件接口、没有类型、没有稳定契约，只能靠
`MutationObserver` + 2s 轮询去"认" DOM 形状。后果：

| 症状 | 实例 |
|---|---|
| 补丁之间互相打架 | v10 动 `bit-layout > .tw-grid` 的列定义 → Send 对话框跑到屏幕外 |
| 越界改了别人的东西 | v11 把 `readonly`/`inputmode` 写进 ng-select 的表单控件 → 触发应用的必填校验「必须输入内容。」 |
| 上游一变就崩 | web-vault 版本由 CI 从 `bw_web_builds` 下载，换版本时所有选择器都要重验 |
| 只能靠测试堆兜 | `tests/mobile-regression.mjs` 从 G1 涨到 G7 |

**根因不是"改得不够小心"，而是这层没有架构。** 本文给出架构。

### 1.1 先纠正一个前提：L3 不是黑盒

原稿只说"预编译、不进仓库"，容易让人以为它是不可读的黑盒。**实测并非如此。**

发布包里的 `.js.map` 带着 `sourcesContent`，**内嵌了完整原始源码**：

| 指标 | 实测值 |
|---|---|
| `app/main.*.js.map` | 12.25 MB，`sources` 2502 项，`sourcesContent` **887 万字符** |
| 三个 map 合并后的项目源文件 | **3227 个**（`ts` 2844 + `html` 380） |
| 覆盖模块 | `common` 745 / `components` 264 / `tools` 164 / `vault` 164 / `importer` 131 … |

也就是说：**不需要反编译，直接读原文。** 例如

- 导入页三个下拉的真实写法 → `libs/importer/src/components/import.component.html`
  （`formControlName="vaultSelector"` / `"targetSelector"` / `"format"`——**都在同一个 Angular 响应式表单里**）
- 下拉组件本体 → `libs/components/src/select/select.component.html|ts`
  （`appendTo="body"`、`outsideClickEvent="mousedown"`、`hostDirectives: [{ directive: BitFormFieldControlDirective, inputs: ["required","id"] }]`）
- 「必须输入内容」的唯一来源 → `libs/components/src/form-control/form-control-base.directive.ts:53`
  `get displayError()` 里 `case "required": return this.i18nService.t("inputRequired")`

> 这同时**从源码层面坐实了 v11 事故**：`bit-select` 是响应式表单控件、且宿主绑定了
> `[attr.required]`。我们往它内部的 search input 写 `readonly`，等于在表单机器运转时
> 去动它的零件 —— 控件被判为 `required` 未满足，于是弹出 `inputRequired`。

**注意：CI 部署时会 `find -name '*.map' -delete`**（为过 Cloudflare 单文件体积限制），
所以线上没有 map；**本地那份才是完整的**。要读源码就本地读，别去线上找。

**工具**：`skill: warden-worker-shypwd-deploy/scripts/vault-src.py`
（`stats` / `list` / `cat` / `grep` / `dump`——`dump` 可把原始源码导成真实文件树，用编辑器看，比 grep 舒服得多）。
契约提取应从**这里**出发，而不是从压缩代码里猜字符串。

### 1.2 许可证：L3 是 GPL-3.0，不是"不开源"

| 组件 | 许可证 |
|---|---|
| **Bitwarden clients（含 Web vault，即 L3）** | **GPL 3.0** |
| Bitwarden server | AGPL 3.0 |
| 面向大企业的部分模块（`Commercial.Core`、SSO 等） | Bitwarden License（source-available，非 OSI 开源） |

- 2024-10 曾有"Bitwarden 不再开源"的风波（SDK 被换成自家许可）；**2024-11 官方把 SDK 改回纯 GPLv3**，
  并调整打包方式，使"只含 GPL/OSI 许可"即可构建整个客户端。
- `sdk-secrets`（原 `sdk`，Secrets Manager 用）仍是 Bitwarden License，但**客户端不再引用它**。
- 结论：**我们这个个人密码库场景，L3 完全在 GPL-3.0 之下**，改它、重发它都合法
  （GPL 的义务是：对外分发修改版时须一并提供源码）。

### 1.3 所以"能不能改 L3"——能，有三条路，我们已经用了一条

| 路径 | 做法 | 现状 | 代价 |
|---|---|---|---|
| **(a) 构建期打补丁** | CI 里对压缩产物做定值替换 | **已在用**：`sed 's/minimumPasswordLength=12/=8/'`（`push-cloudflare.yaml`） | 低。但依赖压缩后的字面量，**上游一改就静默失效** |
| **(b) 运行期改 DOM** | 就是 `custom/` 这一层 | 在用（本文对象） | 中。上游改结构即失效 → 靠 §4 契约探针兜 |
| **(c) 从源码重建自己的 web-vault** | fork `bitwarden/clients`，自行构建 | **不做**（§8.1） | **高**：要拉整个 nx monorepo + Angular 工具链，且永久跟随上游改动 |

**为什么不选 (c)：不是法律/黑盒限制，纯粹是成本。** 而既然 (a) 已经在用、且 §1.1 让我们
能读到原文，(a) 的性价比明显上升：**凡是"用 CSS/DOM 很难做干净、但源码里是个明确字面量"的改动，
优先考虑 (a)**。典型候选见 §9.5。

---

## 2. 分层边界（三层职责，不许越界）

| 层 | 允许做什么 | 禁止做什么 |
|---|---|---|
| **① 呈现层（CSS 为主）** | 改外观、尺寸、间距、可见性、层级；给 `body` 挂状态 class | 改布局骨架（列定义、grid 模板）；改别人控件的属性 |
| **② 结构层（JS 搬 DOM / 插节点）** | 把已有节点搬到更合适的位置；插入**我们自己的**新节点；只读 DOM | 往别人的控件里写状态；依赖压缩后的类名哈希 |
| **③ 能力层（JS 取数据 / 调接口）** | 只读地取数据（解密、TOTP）；调**我们自己后端**的接口 | 伪造/篡改应用的状态；替应用做它该做的状态变更 |

**铁律**：一旦某个改动需要"写应用拥有的状态"（表单值、控件属性、组件数据），
就说明它**不该由我们做** —— 改用 ①/② 层实现，或者不做。

---

## 3. 功能清单（现状 · 风险 · 依赖契约）

图例：风险 ▁ 低（纯呈现） / ▃ 中（搬 DOM） / █ 高（侵入状态）

| # | 功能 | 实现位置 | 风险 | 依赖的上游契约 |
|---|---|---|---|---|
| 1 | 列表列宽塌缩（复选框/站标列） | css A | ▁ | 表头 `th` 的 `colspan` 映射 |
| 2 | TOTP 行内徽章 | js §2–§6 + css B | █ | `tr[appvaultcipherrow]` 的 5 个 `td`；行内 `button[bitlink]` 的名称；菜单单元格 |
| 3 | 表头工具行（选择/新增 并入"名称"行） | js §7 + css C | ▃ | `thead th` 的宽度设定；`th.tw-w-24` 的 `colspan=2` |
| 4 | 行内菜单「添加到文件夹」 | js §7.4 + css L | █ | 应用菜单浮层的挂载方式；`/api/folders` REST |
| 5 | 头像上传 + 跨端同步 | js §7.5 + 后端 `avatar_image` | █ | 应用账户卡片 DOM；我们自己的 3 个端点 |
| 6 | 选择模式（放复选框列） | js §8 | █ | 表头复选框、行内复选框、应用自带批量菜单 |
| 7 | **移动端下拉面板定位** | js §8.5 + css M | ▃ | `ng-select.ng-select-opened`；`.ng-dropdown-panel` 挂 `<body>`；`appendTo="body"` |
| 8 | 独立「验证码」页 | js §9 + css E | ▃ | 底栏挂载点；应用路由（`#/…`） |
| 9 | 底部标签栏 | js §10 + css G | ▃ | `main#main-content`、应用侧栏的一级导航项 |
| 10 | 二级导航 chips（工具/设置） | js + css J/J2 | ▃ | 各页路由名；`app-account-menu` |
| 11 | 窄屏布局适配（留白/页头/对话框） | css F/H/I/K | ▁ | `bit-dialog`、`cdk-overlay-pane` |
| 12 | 劫持 `fetch`/XHR 取 `sync` 明文与 token | js §1 | █ | 应用请求路径与头；**签名/加密方式** |
| 13 | 走 DI 容器解密 | js §3 | █ | `window.bitwardenContainerService` 只挂 3 个方法 |

> 注：`custom.css` 的段号从 A 跳到 E（D 段是 v10 删掉的底部操作条），**编号本身已经不可靠**，
> 重构时应改为按 feature 命名文件，不再用字母段。

### 3.1 三条已被证伪的做法（写下来防止再犯）

1. **不给 `<td>` 写 `display:flex`** —— td 会退化成匿名单元格，高度只按内容算，"相对整行居中"永远做不到。
2. **不写死 `max-height`** 在会向上展开的浮层上 —— 会把面板顶部顶出屏幕，且面板只能向下滚，够不回来。
3. **不写应用拥有的表单控件的状态属性** —— v11 的 `readonly` 事故（触发 `inputRequired` 必填校验）。

---

## 4. DOM 契约与失效预警（本方案的核心新增）

现在的失效模式是"**上游改了 → 我们静默失效 → 用户报 bug → 我们再排查**"。
要把它变成"**上游改了 → 我们立刻知道**"。

### 4.1 契约集中声明

所有依赖上游 DOM 的东西收进 `core/contracts.js`，一处声明、多处引用，禁止散落的字符串选择器。

**下面这份不是"形状示意"，已在 §1.1 的原始源码里逐条核实**（`vault-src.py cat/grep` 可复核）：

```js
// 出处标注格式: <源文件>:<行> —— 契约失效时可直接回源头看
export const NGSELECT = {
  // libs/components/src/select/select.component.html —— 宿主
  opened: "ng-select.ng-select-opened",
  // src/ng-select/lib/ng-dropdown-panel.component.ts —— 模板里的 <ng-dropdown-panel>
  panel: ".ng-dropdown-panel",
  // 同上: <div #scroll role="listbox" class="ng-dropdown-panel-items scroll-host">
  // ⚠️ 真正滚动的是这个 #scroll 元素, 所以改高度要改它, 不是改外层
  items: ".ng-dropdown-panel-items",
  // select.component.html 里写死 appendTo="body" → 面板一定挂在 body 下, 不在宿主里
  panelHost: "body",
  // 同上: outsideClickEvent="mousedown"(不是 click) → 我们的"点外面关掉"要用 mousedown 对齐
  outsideClick: "mousedown",
};

export const IMPORT_PAGE = {
  // libs/importer/src/components/import.component.html:16/33/67
  // ⚠️ 三个下拉都在同一个 Angular 响应式表单里 —— 这是 v11 事故的地形图
  selects: ["vaultSelector", "targetSelector", "format"],
  formBound: true,
};

export const VAULT_TABLE = {
  // 待用 vault-src.py 从 libs/vault/** 核实后填入(§6 第 2 步之前必须补齐)
  row: "tr[appvaultcipherrow]",
  cells: 5,                       // [复选框][站标][名称][组织][菜单]
  name: "td:nth-child(3) button[bitlink]",
};
```

**规则**：每条契约必须带出处注释；**没有出处的选择器不许进 `contracts.js`**
（要么去源码里找到出处，要么承认它只是在猜、并据此降低该 feature 的优先级）。

### 4.2 启动自检（契约探针）

`custom.js` 启动时（以及路由变化时）跑一次"契约体检"：关键选择器**是否命中**、
行结构**是不是 5 格**、面板**是不是挂在 body**……不满足时：

- `console.warn` 打印**具体哪条契约失效**（带期望值 / 实际值）
- 在页面上挂一个不显眼的标记（如 `body.warden-contract-broken`，配合一行 CSS 显示小角标）
- **对应的 feature 主动降级**（不执行、而不是执行一半留下残骸）

这样 web-vault 换版本当天就能发现，而不是等用户截图。

### 4.3 变化判定写入

沿用现有铁律：**任何写 DOM 之前先判变化**（`MutationObserver` 会因此空转）。
统一收敛到 `core/dom.js` 的 `setTextIfChanged / setStyleIfChanged`。

---

## 5. 目标目录结构（构建产物不变，部署链路零改动）

**关键约束：CI 仍然只做 `cp custom/custom.js public/web-vault/` + 注入 `<script>`/`<link>`。**
所以重构**不能改变交付物形态** —— 产物仍是 `custom/custom.js` 与 `custom/custom.css` 两个文件。
用 esbuild 把源码打成一个 IIFE 即可，CI 一行都不用改。

```
custom/
  src/
    index.js                  入口：按顺序装配 features，跑契约探针
    core/
      contracts.js            ← 上游 DOM/接口契约集中声明
      dom.js                  setTextIfChanged / setStyleIfChanged / waitFor
      sched.js                MutationObserver + tick 统一调度（取代散落的 2s 轮询）
      route.js                路由识别 + 挂载点
      probe.js                契约探针（§4.2）
      log.js
    adapters/
      vault-table.js          保险库表格读写契约
      ngselect.js             ng-select 面板契约（含 v12 的可见区定位）
      dialog.js               bit-dialog / bit-form-field / cdk-overlay
      app-api.js              §1 fetch/XHR 劫持 + §3 DI 解密（唯一碰应用接口的地方）
    features/
      totp-badge.js           §2–§6
      header-toolbar.js       §7
      folder-menu.js          §7.4
      avatar.js               §7.5
      selection.js            §8
      select-panel.js         §8.5（v12 已落地，按本结构回填）
      authenticator.js        §9
      tabbar.js               §10
      subnav.js               §10 的 chips 部分
    styles/                   css 按 feature 拆，构建时合并
  custom.js                   ← 构建产物（保持同名同路径）
  custom.css                  ← 构建产物
  build.mjs                   esbuild 打包（CI 里不需要跑 —— 产物入库）
```

> 产物入库、CI 不构建，是为了**不引入新的失败点**：CI 现在只做 `cp`，任何构建步骤
> 都可能成为新的"部署失败原因"。源码与产物一起提交，用 CI 里的一个 diff 检查保证
> "产物 == 源码构建结果"。

---

## 6. 逐个功能的重构顺序（按痛点，不按序号）

每步都要求：**行为不变（除该步声明的变化） + 契约断言进回归套件 + 真机可验证**。

| 步 | 功能 | 为什么排这个位置 |
|---|---|---|
| 1 | **select-panel（移动端下拉）** | 已连续出问题 3 轮，且 v12 刚落地，先把结构立起来 |
| 2 | **selection（选择模式）** | 与表格列宽/表头结构纠缠最深，是列表页一切问题的上游 |
| 3 | **totp-badge** | 依赖表结构 + 每行匹配，与 2 共用 `vault-table` 适配器 |
| 4 | **header-toolbar + folder-menu** | 都往表头/菜单里插东西，共用同一套契约 |
| 5 | **tabbar + subnav + authenticator** | 相对独立，以搬 DOM 为主，风险可控 |
| 6 | **avatar + app-api** | 涉及后端与请求劫持，边界最清楚（我们自己的端点），留到最后 |
| 7 | **styles 拆分** | 段号已乱（A…E…M），映射到 feature 文件后再收尾 |

---

## 7. 真机验证回路（解决"我看不到软键盘"）

现状是"改 → 部署 4 分钟 → 用户手机试 → 还不对"，成本高且每次都动生产。

1. **URL 开关**：凡行为不确定的改动，实现就带开关（v12 已落地 `?sel=auto|above|off`，
   并记进 `localStorage`）。用户在同一台真机上切换对比，选定后固化为默认。
2. **契约探针**（§4.2）：把"上游变了"与"我们写错了"区分开，减少来回。
3. **本地可造假条件**：`visualViewport` 可以**伪造**（v12 就是这么验证软键盘路径的：
   把 `height` 改成 500 模拟键盘）。凡是"真机才有的条件"，优先想能不能造假出来，
   而不是留给用户当测试员。

---

## 8. 明确"不做"的事（避免重复讨论）

1. **不从 Bitwarden 源码重建自己的 web-vault**（路径 (c)）——
   **注意：这不是因为"L3 不开源"或"是黑盒"**（见 §1.1/§1.2：L3 是 GPL-3.0，且原始源码随 map 可读）。
   纯粹是成本：需要完整 nx monorepo + Angular 工具链，且永久跟随上游。
   **但 (a) 构建期打补丁是允许且已在用的**（§1.3），别把它和 (c) 一起排除掉。
2. **不尝试注入 Angular 组件 / 拿组件实例** —— 生产构建下 `__ngContext__` 是数字、`window.ng` 不存在；DI 容器只挂 `attachToGlobal / getKeyService / getEncryptService`（已实测）。
3. **不改别人拥有的状态** —— 见 §2 铁律。
4. **不新增 CI 构建步骤** —— 产物入库，CI 保持"只 cp"。

---

## 9. 待你确认的点

### 9.1 源码组织方式（三选一）

| 方案 | 做法 | 代价 | 风险 |
|---|---|---|---|
| **A（§5 原案）** | `custom/src/**` 多文件 → esbuild 打包成 `custom.js`，**产物入库** | 多一个 esbuild 开发依赖；需要一条"产物==源码"的 diff 检查 | 低：CI 完全不变 |
| **B** | `custom/src/**` 多文件 → **不构建**，CI 改成 `cp -r`，注入 `<script type="module">` | 无任何构建工具 | 中：`type="module"` 是 **defer 语义**，执行时机变了；且改动 CI 注入方式 |
| **C** | 保持单文件 `custom.js` 手写，只做"内部分层"（用注释分区、统一调度器） | 不需要构建 | 低但收益有限：仍然是 2000 行一个文件，边界靠自觉 |

**我的建议：A。** 理由是 §2 的铁律只有靠"文件边界"才能强制住 —— 单文件里"谁都不许写应用状态"这件事只能靠人记住（v11 就是这么犯的）。
不建议 B：`type="module"` 改变脚本执行时机（defer），等于在现在**已经正常**的加载链上引入新变量，与我们"不新增失败点"的原则冲突。

### 9.2 契约探针失效时的可见性

除了 `console.warn`，要不要在页面上显示可见角标？（角标对你有用，但用户也会看到 —— 我倾向默认**不显示**，改成写进 `localStorage` 供你远程排查。）

### 9.3 重构顺序

§6 的顺序是否认可（先把 `select-panel` 和 `selection` 这两个"重灾区"做掉）？

### 9.4 附带说明：v12 已在线上

v12（方案 B：不动控件、只按可见区重定位面板）已部署并验证：
线上 `custom.js` / `custom.css` 与仓库源码**字节一致**，线上 guard 回归 **105 PASS / 0 FAIL**。
真机上请你打开一次下拉确认：键盘弹出时面板是否往**上方**展开、且**不再**弹"必须输入内容"。
若还不对，用 `?sel=above` 和 `?sel=off` 各试一次，把结果告诉我即可定位。

### 9.5 要不要把"构建期打补丁"(a) 正式纳入手段？

既然 §1.1 能读到原文、且 (a) 已经在用（`minimumPasswordLength`），建议给它一个**明确的使用判据**：

> **当"某个行为在源码里就是一个明确字面量／一个固定默认值"时，用 (a) 打补丁；**
> **当它涉及 DOM 结构、布局、响应式行为时，才用 (b)。**

(a) 的代价是"上游换版本可能静默失效"，所以每打一处补丁，**必须配一条 CI 断言**
（`grep` 不到目标字面量就 fail，而不是继续往下跑）。现在的 `minimumPasswordLength` 补丁
其实**已经有**半条保护（`if count -eq 0` 会 WARNING），但只 WARNING、不 fail，属于"会静默失效"。

**想请你补充**：有没有哪些**具体行为**你希望"根上就改掉"，而不是在界面层绕？
（例如某个默认值、某个固定文案、某处不希望出现的入口。）
有的话我按上面的判据评估走 (a) 还是 (b)；没有就按 §6 顺序从 `select-panel` 开始。
