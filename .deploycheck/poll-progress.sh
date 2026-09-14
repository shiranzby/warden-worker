#!/usr/bin/env bash
# 带分步进度的 workflow run 轮询。用法: poll-progress.sh <run_id> <watch_seconds> [interval]
# 依赖: curl 经本地代理 7890; python 解析 JSON
set -u
RUN_ID="${1:?need run id}"
WATCH="${2:-480}"
INTERVAL="${3:-30}"
# 凭据从环境变量取(**别硬编码** —— 本文件要进版本控制, 而仓库是 public)。
# 本地把 GH_PAT 写在同目录 .env.local(已 gitignore) 即可, 下面会自动加载。
ENV_FILE="$(dirname "$0")/.env.local"
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    # 跳过空行与注释行, 且只接受 shell 变量名形态的 key。
    # ⛔ 不能只判 `[ -n "$k" ]`: `.env.local` 开头是几行 `#` 注释,
    #    朴素写法会把整行注释当成变量名去 export ⇒ "invalid variable name" 直接中断,
    #    脚本永远拿不到 GH_PAT(2026-09-14 踩到)。
    case "$k" in ''|\#*|*[!A-Za-z0-9_]*) continue ;; esac
    v="${v%$'\r'}"                       # Windows 上写过的文件可能带 CRLF
    [ -z "${!k:-}" ] && export "$k=$v"
  done < "$ENV_FILE"
fi
PAT="${GH_PAT:?需要 GH_PAT —— 请写在 .deploycheck/.env.local 或直接 export}"
PROXY="http://127.0.0.1:7890"
API="https://api.github.com/repos/shiranzby/warden-worker/actions/runs/$RUN_ID"

tick() {
  echo "----- [$(date +%H:%M:%S)] -----"
  curl -s -x "$PROXY" -H "Authorization: Bearer $PAT" \
    "https://api.github.com/repos/shiranzby/warden-worker/actions/runs/$RUN_ID/jobs" \
  | python -c "
import sys, json, datetime
d = json.load(sys.stdin)
now = datetime.datetime.now(datetime.timezone.utc)
for j in d.get('jobs', []):
    st = j.get('started_at')
    el = ''
    if st:
        t = datetime.datetime.strptime(st, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
        el = ' 已跑 %dm%02ds' % divmod(int((now - t).total_seconds()), 60)
    print('JOB [%s] %s%s' % (j['status'], j['name'], el))
    cur = None
    for s in j.get('steps', []):
        if s['status'] == 'in_progress':
            cur = s
        if s['status'] == 'completed' and s['conclusion'] != 'success':
            print('   !! 步骤 %s 失败: %s -> %s' % (s['number'], s['name'], s['conclusion']))
    if cur:
        print('   当前 -> 步骤 %s/%s: %s' % (cur['number'], len(j.get('steps', [])), cur['name']))
    done = sum(1 for s in j.get('steps', []) if s['status'] == 'completed')
    print('   进度 -> %d/%d 步已完成' % (done, len(j.get('steps', []))))
"
  curl -s -x "$PROXY" -H "Authorization: Bearer $PAT" "$API" \
  | python -c "
import sys, json
d = json.load(sys.stdin)
print('RUN 状态: %s | 结论: %s' % (d.get('status'), d.get('conclusion') or '(未结束)'))
"
}

elapsed=0
while [ "$elapsed" -lt "$WATCH" ]; do
  tick
  status="$(curl -s -x "$PROXY" -H "Authorization: Bearer $PAT" "$API" | python -c "import sys,json;print(json.load(sys.stdin).get('status'))")"
  if [ "$status" = "completed" ]; then
    echo "=== RUN $RUN_ID 已完成 ==="
    exit 0
  fi
  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL + 2))
done
echo "=== 本轮观察窗口结束（run 仍在进行中） ==="
