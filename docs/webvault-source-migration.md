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
│   ├── build-web-vault.yaml          ← 【新增】构建我们自己的前端，产出 Release 资产
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
    → npm ci + npm run dist:oss:selfhost（约 20–35 分钟）
    → 打包 tar.gz → 发 Release 资产
push-cloudflare.yaml → 下载该资产 → 部署（仍然很快）
```

**关键：重量级构建与部署解耦。** 构建只在"改了前端"时跑一次；
日常部署仍然只是"下载 + 部署"，速度不变。

---

## 4. 分阶段迁移（每步都可验证、可回退）

### Phase 0 — 打通流水线（零行为变化）
- 新增 `build-web-vault.yaml`：clone `v2026.6.4` + **空补丁** → 构建 → 上传 artifact
- **验证**：产物能构建出来；解包后 `index.html`、`app/main.*.js` 存在；与
  `dani-garcia` 官方 `v2026.6.4` 产物做**结构对比**（文件清单、关键文件大小在同一量级）
- **不切线上**。这一步只证明"我们造得出来"。
- 退出条件：构建成功且产物结构与官方一致。

### Phase 1 — 迁移"本来就该在源码里"的改动（低风险）
这三件事**现在就在 CI 里用 sed/python 硬替换**，属于路径 (a)，搬进源码后天然更干净：

| 现在 | 迁移后 |
|---|---|
| `sed 's/minimumPasswordLength=12/=8/'` 扫压缩产物 | 改源码里那个常量的真实出处 |
| python 替换 `index.html` 的 `width=1010` 视口 | 直接改 `apps/web/src/index.html` |
| 自动生成 `vw-version.json` 之外的品牌/文案 | 按需改源码 |

- **验证**：部署后逐条跑 `tests/mobile-regression.mjs --only=guard`（G1–G7 全绿）
- 退出条件：CI 里不再有 `sed`/视口替换步骤。

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
- `Patch web vault master password minimum length`（→ 进源码）
- `Inject shypwd custom frontend`（→ 进源码）
- `cp public/css/vaultwarden.css`（按需保留，它本来就是覆盖层）

**改动的步骤（1 个）**：下载地址
```diff
- wget -q "https://github.com/dani-garcia/bw_web_builds/releases/download/${TAG}/bw_web_${TAG}.tar.gz"
+ wget -q "${WEBVAULT_TARBALL_URL}"   # 我们自己的 Release 资产
```

**新增的步骤**：保留 `*.map` 删除（Cloudflare 单文件体积限制，与构建方式无关）。

---

## 6. 代价与风险（实测数据，不是估算）

> **Phase 0 实跑数据（run #1，`v2026.6.4`）** —— 我原先估"20–35 分钟"，**实测只有 5.5 分钟**：

| 步骤 | 实测耗时 |
|---|---|
| 克隆 `vw_web_builds`（浅克隆） | ~0 分钟 |
| `npm ci`（**2885 个包**） | **1.3 分钟** |
| `npm run dist:oss:selfhost`（Angular 生产构建） | **3.9 分钟** |
| 打包 | <0.1 分钟 |
| **整次构建合计** | **5.5 分钟** |

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

## 7. 待确认

1. **Phase 0 是否现在就做**？（只加一个 workflow，构建出产物但不切线上；不影响现有部署）
2. **补丁的组织方式**：一个特性一个 `.patch`（便于 review 与升级，我推荐）
   还是全部合并成一个大 `.patch`？
3. **升级策略**：跟随 `vaultwarden/vw_web_builds` 的版本节奏（他们出新分支我们跟），
   还是我们长期钉在一个版本、只在需要时才升？
4. Phase 2 的**迁移顺序**是否认可（先把"移动端下拉"和"表格结构"这两个重灾区做掉）？
