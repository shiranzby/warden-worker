# `.deploycheck/` —— web-vault 部署后验证目录

这个目录是**本机的验证工作区**，不是构建输入。CI 完全不读它。

## 为什么这里既有入库文件、又有 GB 级的忽略文件

目录里混着两类东西，所以 `.gitignore` 用**显式白名单**处理（见仓库根 `.gitignore` 的注释）：

| 类别 | 是否入库 | 例子 |
|---|---|---|
| **回归脚本**（真正的知识资产） | ✅ 入库（逐个白名单） | `b8-lib.mjs`、`verify-batch10.mjs`、`verify-batch11.mjs`、`verify-batch12.mjs`、`verify-j15.mjs`、`verify-p7-browser.mjs`、`devserver-b8.config.js`、`poll-progress.sh`、`run-artifact-asserts.py` |
| 产物快照 / 离线包 / 抓下来的 bundle | ❌ 忽略（GB 级、可再生） | `p1/`、`sh-test/`、`patched/`、`ours/`、`*.zip`、`*.tar.gz`、`dvmain*.js` |
| 凭据与登录态 | ❌ 忽略 | `.env.local`、`shypwd-auth.json` |
| 其余一次性诊断脚本 | ❌ 忽略 | `diag-*.mjs`、`probe-*.mjs`、`shot-*.mjs` … （⚠️ 这批多数带明文凭据，见下） |

> 还有一批**当年一起写、暂未入库**的脚本，想入库请照同样的"扫描 → 脱敏 → 加白名单"流程：
> `verify-batch6/7/8.mjs`、`verify-j7/j9.mjs`、`verify-local.mjs`、`verify-tabbar.mjs`、`probe-*-assert.mjs`。
> ⚠️ **别以为它们已经脱敏**：实测只有 `verify-batch8.mjs` 和 `probe-*-assert.mjs` 是干净的；
> `verify-batch6/7.mjs`、`verify-j7/j9.mjs`、`verify-local.mjs`、`verify-tabbar.mjs` 都写着
> `process.env.WARDEN_TEST_MAIL || "<真实邮箱>"` 这种**兜底明文**。

## 🔴 凭据规矩（本仓库是 **public**，别踩）

2026-09-14 审计（用下面那条扫描命令跑的）：**18 个文件**里带着测试账号 + 主密码 ——

- **9 个直接硬编码**：`diag-b6-css/why`、`diag-b7-column`、`diag-live-login`、`diag-occluder`、`login-probe`、`probe-setupext`、`shot-b6`、`shot-l4-select-btn`
- **9 个是 `process.env.X || "<字面量>"` 兜底**：`verify-batch6/7`、`verify-j7/j9`、`verify-local`、`verify-tabbar`、`seed-b7`、`probe-b7-rows`、`probe-j7-width`
  —— 这类**最容易被误当成"已脱敏"**，一定要扫出来。

另有 **2 个脚本曾把 GitHub PAT 直接写在文件里**（`poll-progress.sh` / `poll-run.sh`），已改为读环境变量。
以上文件**全在 `.gitignore` 覆盖范围内，从未进过远端**（已用 GitHub raw 逐字核对：账号/密码/PAT 共 5 个真实值命中 0 次）。

要入库的脚本已经脱敏 —— 凭据统一放 **`.deploycheck/.env.local`**（已 gitignore），脚本从环境变量读：

- `b8-lib.mjs` → 读 `.env.local` / `WARDEN_TEST_MAIL` + `WARDEN_TEST_PASS`
- `poll-progress.sh` → 读 `.env.local` / `GH_PAT`

**新增要入库的脚本时，必须逐个加白名单，且加之前先在 `.deploycheck/` 里跑这条扫描：**

```bash
PAT='(ACCOUNT|MAIL|EMAIL|PASSWORD|PASS|TOKEN|SECRET)[A-Za-z_]*[[:space:]]*[:=][^"]{0,60}"[A-Za-z0-9._@!-]{8,}|ghp_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9_]{20}'
grep -lE -- "$PAT" * 2>/dev/null      # 目录名会报"是不是目录"，被 2>/dev/null 吞掉，看输出列表即可
```

**每条约束都是踩出来的，别简化：**

- `[:=][^"]{0,60}"` —— 中间故意允许 60 个字符，是为了把 `X = process.env.Y || "明文"` 这种**兜底**一起抓出来；
  只写 `= *"` 会漏掉它（`verify-batch7.mjs` 就是这么漏的）。
- `[A-Za-z0-9._@!-]{8,}` —— 要求引号后是"类密钥字符且 ≥8 位"，这样 `'^GH_PAT='`（正则字面量）、`"$(...)"`（命令替换）、
  `""`（空兜底）都不会误报。
- **不要**把裸 `PAT` 加进变量名列表 —— `PATCHED` / `PATH` 会误伤。
- **不要**把真实的账号/密码前缀写进本文件或 `.gitignore`（两者都是**公开**的），也别拿 `.env.local` 的真实值当样例。
- 实测：这条命令对本目录命中 **18/18** 个含明文凭据的文件，对本表已入库的 9 个文件**零误报**。

> 命中的不一定是真密钥：`verify-batch7.mjs` 的 `KNOWN_SECRET` 是 RFC 4226 附录 D 的**公开测试向量**，人工看一眼即可。

**绝对不要**把 `.gitignore` 写成按扩展名放行（如 `!.deploycheck/*.mjs`）—— 那会把上面那 18 个
带明文凭据的历史脚本一起提交。也**不要** `git add -f` 本目录。

## 怎么跑验证

```bash
# ① 先起本地 dev server（HTTPS :8099，必须用 Windows 绝对路径传 --config，等编译完再跑）
cd ../vw_web_builds/apps/web && ENV=selfhosted npx webpack serve \
  --config "F:/WorkSpace/Workbuddy/Github项目分析部署/warden-worker/.deploycheck/devserver-b8.config.js" --port 8099

# ② 本地跑（默认打 https://localhost:8099）
node .deploycheck/verify-batch11.mjs

# ③ 打线上（后端本机不通，必须经代理 7890）
WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
  node .deploycheck/verify-batch11.mjs
```

- 脚本登录**一次**后复用同一个 page（登录态在 sessionStorage，`storageState()` 带不过去），
  靠改视口而不是换 context 来覆盖窄屏/桌面。
- 退出码：有 FAIL 就是 1，可直接串进流程。
- 截图落在 `shots-b11/`（已忽略）。

## 被删掉的 2.8GB 是什么（需要时怎么拿回来）

2026-09-14 清理，删除的都是**派生数据**，没有唯一信息：

| 删除项 | 原来是什么 | 怎么再生 |
|---|---|---|
| `p1/`（2.3G） | P1–P9 各轮 `bw_web_vault.tar.gz` 的解包快照（baseline / fork / p2…p11 / prod8 / prod9 / z*） | 从对应 build run 的 artifact 重新下载解包 |
| `sh-test/`（283M） | 同上，供 shell 断言用的两份解包 | 同上 |
| `patched/`+`patched.zip`、`ours/`+`ours-artifact.zip`（各 35M） | 官方包 vs 我们产物的对比素材 | 官方包重新下载；我们的产物从 artifact 取 |
| `official-v2026.6.4.tar.gz`（35M） | **上一版**基线的官方包（现已 8.1） | 重新下载 |
| `dvmain.js`、`dvmain6.js`（各 19.5M） | b6 时期下载的 dev 主包 | 从 dev server 的 `/app/main.<hash>.js` 重抓 |
| `live-app-main.js`（5.3M） | 某次线上主包 | 从线上重抓 |

> ⚠️ 删 `dvmain*.js` 会让 `probe-batch6-assert.mjs` / `probe-j7-assert.mjs` / `probe-j9-assert.mjs`
> 的"产物比对"部分退化成只用 CSS —— 那三个是历史批次的探针，其断言已被 CI 覆盖，影响可接受。
> 同理 `compare3.py` / `compare4.py` 的输入（两个 zip）也没了。

## 相关文档

- 权威记录：`../docs/webvault-migration-checklist.md`（每批的改法、踩坑、上线 run、线上读数）
- CI 侧的产物断言在 `../.github/workflows/build-web-vault.yaml`（**20 组**，不依赖本目录）
