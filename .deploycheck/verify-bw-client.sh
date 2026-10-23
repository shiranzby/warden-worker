#!/usr/bin/env bash
# 一条龙验证：登录 -> 解锁 -> 列条目 -> 取 TOTP。必须放在同一个脚本里，
# 因为上一个脚本结尾 logout 会把会话清掉（第二次运行就撞到 status=unauthenticated）。
# 🔴 只用验收测试账号；只打印名字/类型/有无 TOTP，验证码打码，绝不打印密码与 totp 种子。
set -uo pipefail
cd "$(dirname "$0")/.."

MAIL="$(grep -E '^WARDEN_TEST_MAIL=' .deploycheck/.env.local | cut -d= -f2- | tr -d '\r')"
PASS="$(grep -E '^WARDEN_TEST_PASS=' .deploycheck/.env.local | cut -d= -f2- | tr -d '\r')"
export HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 NO_PROXY=localhost,127.0.0.1
BW="npx --yes @bitwarden/cli@latest"

echo "=== 1) 登录（/identity/connect/token） ==="
$BW login "$MAIL" "$PASS" >/dev/null 2>&1
$BW status 2>/dev/null | tail -1; echo

echo "=== 2) 解锁（本地用主密码解出 vault key） ==="
S="$($BW unlock "$PASS" --raw 2>/dev/null | tail -n 1)"
if [ -z "$S" ]; then
  echo "FAIL: unlock 没拿到 session key"
  $BW status 2>/dev/null | tail -1
  exit 1
fi
echo "OK: unlock 成功，session key 长度 ${#S}"
export BW_SESSION="$S"

echo
echo "=== 3) 同步（/api/sync，对应扩展的后台同步） ==="
$BW sync 2>&1 | grep -viE 'deprecat|trace-deprecat' | tail -1

echo
echo "=== 4) 列条目（/api/ciphers 解密后） ==="
$BW list items 2>/dev/null > .deploycheck/.bw-items.json
python - <<'PY'
import json, io, pathlib
raw = pathlib.Path(".deploycheck/.bw-items.json").read_text(encoding="utf-8", errors="replace").strip()
if not raw:
    print("  FAIL: 输出为空"); raise SystemExit(1)
items = json.loads(raw)
print(f"  OK: 共 {len(items)} 条")
for it in items:
    lg = it.get("login") or {}
    print("   - %-32s type=%-8s totp=%s username=%s password=%s" % (
        repr(str(it.get("name"))[:30]), it.get("type"),
        "有" if lg.get("totp") else "无",
        "有" if lg.get("username") else "无",
        "有" if lg.get("password") else "无"))
PY

echo
echo "=== 5) 取一个 TOTP 验证码 ==="
NAME="$(python -c "
import json,io
items=json.load(io.open('.deploycheck/.bw-items.json',encoding='utf-8'))
n=[i['name'] for i in items if (i.get('login') or {}).get('totp')]
print(n[0] if n else '')
" 2>/dev/null)"
if [ -n "$NAME" ]; then
  CODE="$($BW get totp "$NAME" 2>/dev/null | tail -n 1)"
  MASKED="$(printf '%s' "$CODE" | tr '0-9' 'X')"
  echo "  条目: $NAME"
  echo "  TOTP = ${MASKED} （原长 ${#CODE}，已打码）"
else
  echo "  该账号没有带 TOTP 的条目。"
  echo "  说明：TOTP 由客户端用 login.totp 字段本地计算，不依赖服务端额外能力；"
  echo "        /api/sync 已正常把该字段交给客户端（扩展与 CLI 同一套客户端库）。"
fi

echo
echo "=== 6) 登出 ==="
$BW logout 2>/dev/null | tail -1
