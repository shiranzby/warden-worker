# AI_Skill.md — 把这份仓库交给 AI，让 AI 帮你部署

> **这份文档的读者是 AI（你）。**
> 用户把仓库丢给你，说"帮我部署"，你就要按这篇跑完：**先提问索取信息 → 校验 → 执行 → 验证 → 排错**。
> 人类可读的说明书在 [`README.md`](README.md)（快速上手）和 [`docs/交付文档.md`](docs/交付文档.md)（迁移/开源/跟进上游）。

---

## 0. 你的角色与铁律

你是**部署执行者**，不是架构师。这个项目已经有人把坑全踩过一遍并写成了断言和脚本，
**不要自作主张改方案**（比如"我觉得用 Cloudflare Pages 更好"），照做即可。

### 🔴 铁律（违反会造成真实损失）

1. **用户给的密钥只进 GitHub Secrets / 本地 `.env.local`，绝不写进任何会被 commit 的文件。**
   本仓库是 **public**。写完用 `git status` + `git diff --cached` 自查。
2. **不要把用户的账号/密钥前缀写进命令、日志、文档、commit message**（等于给线索）。
3. `warden-worker` 的 **`origin` 是上游，永远别往 `origin` 推**。只有 `fork`（用户自己的）能推。
4. **触发 workflow 的 POST 只能发一次**：`curl --retry 3` 可以，
   **绝不能加 `--retry-all-errors`**（会把非幂等的 dispatch 重复发送，实测一次触发了 3 个构建）。
5. **改 workflow 的那次 push，commit message 必须带 `[skip ci]`**
   （否则自动部署会去找一个还不存在的 artifact，必挂）。
6. **先 build 后 deploy**，顺序不能反（部署侧是按 artifact 名反查的）。
7. **版本号四处必须同时改**（见 §3.3），少一处 CI 就红或部署错位。
8. `.deploycheck/` 里的文件**默认整体 gitignore**，只有逐个加白名单的才入库；
   **绝不能按扩展名批量放行**（目录里有带测试账号明文的文件）。
9. **拿不准就问用户**，不要猜。尤其是：要往哪个环境部署、要不要自定义域名、是否已有数据要迁移。
10. **每一步做完都要向用户汇报**（做了什么 / 结果 / 下一步），不要闷头跑完才说话。

---

## 1. 先向用户提问（唯一一次集中索取）

> 建议**一次性**把问题问完，别挤牙膏。下面的措辞可以直接复制发给用户。
> 标注【必填】的没有就干不了；【可选】的可以先说"跳过就用默认值"。

### 1.1 直接复制这段发给用户

```
为了把密码库部署到你的 Cloudflare 账号，我需要下面这些信息。
（标 ⭐ 的是必填；其余你可以直接回"用默认"。）

【A. 身份与凭据】
⭐1. Cloudflare 登录邮箱：______
⭐2. Cloudflare Global API Key：______
     获取方式：Cloudflare 控制台 → 右上角头像 → My Profile → API Tokens
              → Global API Key → View
     （注意：本项目用的是"邮箱 + Global Key"，不是 Bearer Token 方式）
⭐3. Cloudflare Account ID：______
     获取方式：控制台右侧边栏，或任一域名首页的右下角 "Account ID"
⭐4. GitHub 用户名：______
⭐5. GitHub Personal Access Token（需要 repo + workflow 权限）：______
     获取方式：GitHub → Settings → Developer settings → Personal access tokens

【B. 资源】
⭐6. 是否已经 fork 了本仓库？如果是，fork 后的地址是：
     https://github.com/______/warden-worker
     （回"还没有"的话我可以给你 fork 的命令/API）
7. 是否已有 D1 数据库？有就给我 Database ID，没有我帮你建（名字用 vault1）：______
8. 是否已有 KV 命名空间（存附件用）？有就给 Namespace ID，没有我帮你建：______

【C. 部署选项】
9. 要用自定义域名吗？要的话给我域名（且该域名的 DNS 必须托管在同一个 Cloudflare 账号下）：
     ______     （回"不用"就用 *.workers.dev，需要我在 wrangler.toml 里开 workers_dev）
10. 允许哪些邮箱注册？（逗号分隔；留空 = 不限制注册）：______
11. 前端版本：直接回"默认"就用 v2026.8.9（当前稳定版，已验证）

【我可以自己生成的（不用你管）】
- JWT_SECRET / JWT_REFRESH_SECRET：我会生成随机串并直接写进你的 GitHub Secrets，
  你不需要看到也不需要保存（丢了不影响已有数据，只影响已登录设备需要重登）。
```

### 1.2 提问要点（给你自己看的）

| 项 | 为什么需要 | 校验方式 |
|---|---|---|
| Cloudflare 邮箱 + Global Key | 部署 workflow 用 `CLOUDFLARE_EMAIL` + `CLOUDFLARE_API_KEY` 调 Wrangler | 见 §2 校验命令 |
| Account ID | 所有 Cloudflare API / wrangler 的作用域 | 32 位十六进制 |
| GitHub PAT | fork、设 Secrets、触发 workflow | 见 §2 校验命令 |
| fork 地址 | 部署的目标仓库 | `GET /repos/{owner}/warden-worker` 返回 200 |
| D1 Database ID | 主数据库 | UUID 格式 |
| KV Namespace ID | 附件存储（不启用附件也不是硬需求，但 wrangler.toml 里绑定了就要有） | 32 位十六进制 |
| 域名 | 自定义域 | 必须能查到对应 zone |
| ALLOWED_EMAILS | 限制谁能注册 | 逗号分隔 |

> ⚠️ **关于"用户名/邮箱要不要写进文档"**：
> 公开文件里**连账号前缀都不能写**。你索取到的邮箱只用于 §2 的 API 调用和设 Secret，
> 不要出现在任何 commit、issue、日志输出里。

---

## 2. 拿到答案后，先校验（动手前必做）

```bash
# ① Cloudflare 凭据 + Account ID 是否有效（200 = 正常）
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_KEY" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID"

# ② GitHub PAT 是否有效
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $GH_PAT" \
  https://api.github.com/user

# ③ fork 是否存在
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $GH_PAT" \
  https://api.github.com/repos/<owner>/warden-worker

# ④ 自定义域名的 zone 是否在这个账号下（拿到 zone_id 后面要用）
curl -s -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_KEY" \
  "https://api.cloudflare.com/client/v4/zones?name=<域名>" | grep -o '"id":"[^"]*"'
```

**任何一项不是 200 就先停下来问用户**，不要带着坏凭据往下跑 —— 后面每一步都要 5 分钟，
排错成本远高于先校验。

---

## 3. 部署流程

### Step 0 · 准备本地环境

```bash
git clone https://github.com/<owner>/warden-worker.git && cd warden-worker
```
需要：`git`、`curl`、Node（`wrangler` 用 `npx` 即可，不用全局装）。
**别 clone 那个 1.2 GB 的前端仓库** —— 构建 workflow 里的 `VAULT_REPO` 指向公开的
`shiranzby/vw_web_builds`，直接就能构建出完全一样的定制前端。

### Step 1 · 建 D1（用户没有才建）

```bash
curl -s -X POST -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_KEY" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/d1/database" \
  -d '{"name":"vault1"}'
# → 记下 result.uuid，这就是 D1_DATABASE_ID
```

### Step 2 · 建 KV（附件用；用户没有才建）

```bash
curl -s -X POST -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_KEY" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces" \
  -d '{"title":"warden-attachments"}'
# → 记下 result.id
```

### Step 3 · 把 ID 填进 `wrangler.toml`

`wrangler.toml` 里 `database_id = "${D1_DATABASE_ID}"`、KV 的 `id` 是占位符。
**两种做法，选其一**：

- **（推荐）不动文件**：把 ID 作为 GitHub Secret（`D1_DATABASE_ID`）设进去，
  部署 workflow 会 `sed` 替换。KV 的 id 则**必须**改进 `wrangler.toml`（流程没有替它做），
  改完这次提交**要带 `[skip ci]`**。
- 直接在 `wrangler.toml` 里写死 ID（简单，但会把 ID 提交进 public 仓库 —— **ID 本身不是密钥**，
  不过用户介意的话就走上面那条）。

### Step 4 · 设 GitHub Secrets

用 `gh` 最省事（每个 secret 一条命令，不会进 git）：

```bash
gh auth login --with-token <<< "$GH_PAT"
cd warden-worker
gh secret set CLOUDFLARE_EMAIL        -b"$CF_EMAIL"
gh secret set CLOUDFLARE_API_KEY      -b"$CF_KEY"
gh secret set CLOUDFLARE_ACCOUNT_ID   -b"$CF_ACCOUNT_ID"
gh secret set D1_DATABASE_ID          -b"<Step 1 的 uuid>"
gh secret set ALLOWED_EMAILS          -b"<用户给的第 10 项，留空则设为空字符串>"
gh secret set JWT_SECRET              -b"$(openssl rand -hex 32)"
gh secret set JWT_REFRESH_SECRET      -b"$(openssl rand -hex 32)"
# 用 R2 存附件才需要：gh secret set R2_NAME -b"<bucket 名>"
```

> 🔴 JWT 两个密钥**由你生成即可**，不要回显给用户、也不要写进仓库。

### Step 5 · 触发前端构建（`version` 用 v2026.8.9）

```bash
curl -s --retry 3 -w "HTTP=%{http_code}\n" -X POST \
  -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/warden-worker/actions/workflows/build-web-vault.yaml/dispatches \
  -d '{"ref":"main","inputs":{"version":"v2026.8.9"}}'
# → 期望 204
```

然后**轮询到 success**（约 5 分钟）：

```bash
curl -s -H "Authorization: Bearer $GH_PAT" \
  https://api.github.com/repos/<owner>/warden-worker/actions/runs?per_page=1 \
  | grep -o '"status":"[^"]*","conclusion":[^,]*' | head -1
```

> ❗ 每次轮询间隔 ≥30 秒，**别用死循环猛刷**（会被 API 限流）。
> ❗ 若意外触发了多个 run，用 `POST /repos/<owner>/warden-worker/actions/runs/<id>/cancel` 取消多余的。

### Step 6 · 触发部署

```bash
curl -s --retry 3 -w "HTTP=%{http_code}\n" -X POST \
  -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/warden-worker/actions/workflows/push-cloudflare.yaml/dispatches \
  -d '{"ref":"main"}'
# → 期望 204；轮询到 success（约 4~5 分钟）
```

### Step 7 · 自定义域名（用户给了域名才做）

```bash
# ① 加 DNS：A 记录指向 192.0.2.1（假源站，实际由 Worker 接管），proxied=true
curl -s -X POST -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_KEY" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -d '{"type":"A","name":"<域名>","content":"192.0.2.1","ttl":1,"proxied":true}'

# ② 加 Worker 路由：<域名>/* → warden-worker
curl -s -X POST -H "X-Auth-Email: $CF_EMAIL" -H "X-Auth-Key: $CF_KEY" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -d '{"pattern":"<域名>/*","service":"warden-worker"}'
```

不用自定义域的话：在 `wrangler.toml` 里把 `workers_dev = true` 打开（默认关，
因为 `*.workers.dev` 容易出 1101）。

### Step 8 · 把"版本号四处"记下来（只有在升版本时才需要动）

| # | 位置 | 当前值 |
|---|---|---|
| 1 | fork `apps/web/package.json` 的 `version` | `2026.8.9` |
| 2 | fork `package-lock.json` 的 `packages["apps/web"].version` | `2026.8.9` |
| 3 | `build-web-vault.yaml` 的 `inputs.version` | `v2026.8.9` |
| 4 | `push-cloudflare.yaml` 的 `BW_WEB_VERSION` | `v2026.8.9` |

**这一版部署不需要动它们**（Step 5 传的 `v2026.8.9` 与四处默认值一致）。
只有将来要升前端版本时才需要四处同改，改完记得 `[skip ci]`。

---

## 4. 验证清单（部署完必须逐条过）

```bash
# ① 版本对不对
curl -s https://<域名>/vw-version.json
#    期望：{"version":"2026.8.9"}

# ② 注入层必须是 404（返回 200 说明有东西不对）
curl -s -o /dev/null -w "%{http_code}\n" https://<域名>/custom.js     # 期望 404
curl -s -o /dev/null -w "%{http_code}\n" https://<域名>/custom.css    # 期望 404

# ③ 首页能打开、能取到主 JS
curl -s https://<域名>/ | grep -oE 'app/main\.[a-f0-9]+\.js' | head -1
```

然后**让用户自己在浏览器里确认**（你没法替他点）：
- [ ] 能注册 / 能登录，能新建并保存一条密码
- [ ] **手机浏览器**打开：底部有导航栏、输入框高度一致、设置→外观能切深色

可选：跑线上验收脚本（需本地能访问该域名；本机直连不通要挂代理）：

```bash
WARDEN_TEST_BASE=https://<域名> WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
  node .deploycheck/probe-w19-verify.mjs
# 期望 16 通过 / 0 失败
```

> 🔴 **有没有真的部署成功，最硬的证据是 run 列表里 build 和 deploy 两条都 success**。
> `vw-version.json` 在同版本号重建时**不会变**，不能单独当判据。

---

## 5. 失败决策树

| 现象 | 原因 | 动作 |
|---|---|---|
| `❌ 版本不一致` | `inputs.version` 与 fork 源码 `package.json` 的版本不符 | 两者对齐（通常是你传错了 version） |
| 部署报找不到 artifact | ① 还没 build ② build 失败了 ③ artifact 名/版本对不上 ④ 超 90 天过期 | 按顺序排查；重跑 build 再 deploy |
| 部署成功但页面还是旧的 | 浏览器/Service Worker 缓存 | 让用户硬刷新 / 无痕窗口；确认 `vw-version.json` 已是新值 |
| `/custom.js` 返回 200 | 注入层复活（不该发生） | 检查 `public/` 是不是被塞进了旧文件 |
| workflow 立刻失败、日志里出现 API 401/403 | Cloudflare 凭据错或 Account ID 错 | 回 §2 重新校验；注意是 **Global Key + 邮箱**，不是 Bearer Token |
| D1 迁移步骤报错 | 数据库 id 占位没被替换，`sed` 没匹配上 | 确认 Secret `D1_DATABASE_ID` 已设且非空 |
| 一次 curl 触发出好几个 run | 用了 `--retry-all-errors` | 取消多余 run；以后只保留 `--retry 3` |
| push 后马上自动部署失败 | 改了 workflow 却没带 `[skip ci]` | 正常现象：先把 commit 补齐 `[skip ci]`，再手动跑 build → deploy |
| 本地开发时登录没反应 | webpack-dev-server 的 proxy 不读系统代理 | 必须用 `.deploycheck/devserver-b8.config.js` 起 8099 |

**排错时拉日志的正确姿势**：CI 会把整段断言脚本也打印进日志，
所以 `grep -c "❌"` 数出几十个**不代表失败**；真正的判据是
**断言那个步骤的 conclusion == success**。

---

## 6. 你（AI）在这一版里不需要做的事

- ❌ 不需要 fork / clone 那个 1.2 GB 的前端仓库
- ❌ 不需要改任何前端源码（那是有 27 组 CI 断言守着的定制，改坏了会红）
- ❌ 不需要升版本号（这一版就用 `v2026.8.9`）
- ❌ 不需要碰 `migrations/`（部署流程会自动 apply，空库还有 bootstrap 兜底）
- ❌ 不需要把用户的凭据写进任何文件

---

## 7. 汇报模板（每完成一步用这个格式）

```
【Step N · <名字>】
做了什么：<一句话>
结果：✅ / ❌  <关键输出，如 HTTP 204、run id、D1 uuid 后 8 位>
下一步：<下一步是什么 / 需要你确认什么>
```

全部完成后给一份总览：版本、域名、`vw-version.json` 实测值、两条 run 链接、
以及"需要你自己在浏览器里确认的三件事"。
