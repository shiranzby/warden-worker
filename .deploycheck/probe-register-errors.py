#!/usr/bin/env python3
"""注册接口「错误可见性」回归探针（零副作用）。

背景
----
Bitwarden 客户端只认错误体里的 `message` 键：
`libs/common/src/models/response/base.response.ts` 的 `getResponseProperty`
依次尝试 `Message` → `message` → `MESSAGE`，**从不读 `error`**。
服务端若只返回 `{"error": ...}`，前端一律回退到通用文案「发生意外错误。」，
真实原因被吞掉 —— 这正是「一直提示意外错误」的放大器（P0）。

本探针只发**两类必然失败**的注册请求，永远不会写库：

  1. 已注册邮箱（`--existing`）→ 修复前 500 `{"error":"Database error"}`；
     修复后应为 400 且给出「该邮箱已注册…」的可读提示。
     安全性：该邮箱**必须已经存在**，否则请求会真的创建账号 —— 见下方警告。
  2. 白名单外邮箱（`--blocked`）→ 401，且在 format 校验之外，
     必然在写库前终止（`ALLOWED_EMAILS` 检查在 INSERT 之前）。
  3. **负向对照**：白名单内、但**从未注册**的邮箱 + 非法 KDF（`iterations:1`）→
     必须撞到 `ensure_supported_kdf` 的 400，而**不是**撞到查重的「已注册」。
     这一条专门证伪"查重对不存在的邮箱产生假阳性"，同样零副作用
     （KDF 校验在生成盐/哈希之前，永远走不到 INSERT）。

判据（不变量，不绑定具体文案）
------------------------------
  A. 响应体必须是 JSON 对象
  B. 必须**同时**含 `error` 与 `message` 两个键（P0 修复点）
  C. `message` 必须非空字符串（客户端真正读的就是它）
  D. ③ 的 `message` 必须提到 iterations，且**不得**含「已注册」

⚠️ 一次跑 3 个请求；`LOGIN_RATE_LIMITER` 是 **5 次 / 60 秒**（按 `register:<ip>` 计、不分成败）
   ⇒ 两次连跑会 429。跑之前确认距上次已过 60 秒。

用法
----
  python probe-register-errors.py --existing <已注册邮箱> --blocked x@163.com

真实邮箱**不写进本文件**（仓库是 public）—— 每次从命令行传，或从
`.deploycheck/.env.local` 的 `WARDEN_TEST_MAIL` 取。缺参数直接报错退出。

⚠️ `--existing` 必须是**已注册**的邮箱。若它其实没注册，探针会创建出真账号
   （脚本会检测到 HTTP 200 并高喊警告，但木已成舟）。

代理
----
直连 Cloudflare 边缘会被 TLS reset，一律走本机代理。
"""

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

PROXY = "http://127.0.0.1:7890"
TIMEOUT = 45


def load_env_local() -> None:
    """把 `.deploycheck/.env.local` 里的键灌进 os.environ（不覆盖已有的）。

    沿用仓库既有约定：凭据只放 .env.local（已 gitignore），脚本从环境变量读。
    跳过空行/注释，并容忍 CRLF —— `.env.local` 在 Windows 上写的会带 \\r。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, ".env.local")
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            key, sep, value = line.partition("=")
            key = key.strip()
            if not sep or not key or key.startswith("#"):
                continue
            if not all(c.isalnum() or c == "_" for c in key):
                continue
            os.environ.setdefault(key, value.rstrip("\r\n"))


def resolve_existing_email(cli_value: str | None) -> str:
    email = cli_value or os.environ.get("WARDEN_TEST_MAIL") or ""
    if not email.strip():
        sys.exit(
            "缺少 --existing（已注册邮箱）。也可在 .deploycheck/.env.local 里设 WARDEN_TEST_MAIL。"
        )
    return email.strip()


def build_payload(email: str) -> dict:
    """构造**合法**的 Current 兼容格式注册载荷。

    只给一种拼写：`KdfParams` 带 `alias = "iterations"`、`kdfType` 等别名，
    同一字段给两种拼写会触发 serde 重复字段 ⇒
    `data did not match any variant of untagged enum RegisterRequestCompat` (422)。
    """
    normalized = email.strip().lower()
    kdf = {"kdf": 0, "kdfIterations": 600_000}
    return {
        "name": "reg-error-probe",
        "email": email,
        "masterPasswordHint": None,
        "userAsymmetricKeys": {"publicKey": "probe-pub", "encryptedPrivateKey": "probe-priv"},
        "masterPasswordAuthentication": {"kdf": kdf, "salt": normalized, "hash": "probe-hash"},
        "masterPasswordUnlock": {"kdf": kdf, "salt": normalized, "key": "probe-key"},
    }


def post(base: str, path: str, payload: dict | None) -> tuple[int, str]:
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            # 老客户端只会带 UA; 这里刻意冒充真实客户端以免被当作爬虫。
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) probe",
        },
    )
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def check(label: str, status: int, body: str, expect_status: set[int]) -> bool:
    print(f"\n--- {label} ---")
    print(f"HTTP {status}")
    print(f"body: {body[:400]}")

    ok = True
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        print("  ✗ A. 响应体不是 JSON")
        return False

    if not isinstance(parsed, dict):
        print("  ✗ A. 响应体不是 JSON 对象")
        return False
    print("  ✓ A. 响应体是 JSON 对象")

    if "error" in parsed and "message" in parsed:
        print("  ✓ B. 同时含 error / message 两个键")
    else:
        print(f"  ✗ B. 缺键 —— 实际键: {sorted(parsed.keys())}")
        ok = False

    message = parsed.get("message")
    if isinstance(message, str) and message.strip():
        print(f"  ✓ C. message 非空: {message!r}")
    else:
        print(f"  ✗ C. message 为空/非字符串: {message!r}")
        ok = False

    if status in expect_status:
        print(f"  ✓ 状态码符合预期 {sorted(expect_status)}")
    else:
        print(f"  ✗ 状态码 {status} 不在预期 {sorted(expect_status)} 内")
        ok = False
    return ok


def build_bad_kdf_payload(email: str) -> dict:
    """合法 Current 形状, 但把 PBKDF2 迭代数写成非法值 (1)。

    服务端 `ensure_supported_kdf` 要求 ≥100000 ⇒ 必然在
    "生成盐/哈希 → INSERT" 之前终止 ⇒ **零副作用**。
    用来探测处理顺序与查重的**假阳性**:
      - 若返回 KDF 报错 ⇒ 白名单放行 且 查重**没有**误判该邮箱不存在这一事实;
      - 若返回「该邮箱已注册」⇒ 查重对不存在的邮箱产生了假阳性(真 bug);
      - 若返回 401 ⇒ 该邮箱不在白名单。
    """
    payload = build_payload(email)
    kdf = {"kdf": 0, "kdfIterations": 1}
    payload["masterPasswordAuthentication"]["kdf"] = kdf
    payload["masterPasswordUnlock"]["kdf"] = kdf
    return payload


def check_negative_control(status: int, body: str) -> bool:
    """③ 负向对照: 未注册邮箱 + 非法 KDF, 必须撞 KDF 校验而不是撞查重。"""
    print("\n--- ③ 未注册邮箱 + 非法 KDF（负向对照: 查重不得假阳性）---")
    print(f"HTTP {status}")
    print(f"body: {body[:400]}")

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        print("  ✗ 响应体不是 JSON")
        return False

    message = parsed.get("message") if isinstance(parsed, dict) else None
    ok = True

    if status != 400:
        print(f"  ✗ 期望 400, 实际 {status}")
        ok = False
    if not isinstance(message, str) or "iterations" not in message:
        print(f"  ✗ 没撞到 KDF 校验, message={message!r}（很可能是查重假阳性!）")
        ok = False
    if isinstance(message, str) and "已注册" in message:
        print("  ✗ 查重对**不存在**的邮箱报了「已注册」—— 假阳性 bug!")
        ok = False
    if ok:
        print("  ✓ 撞到 KDF 校验 ⇒ 白名单放行 + 查重无假阳性 + 零副作用")
    return ok


def main() -> int:
    load_env_local()

    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://shypwd.cc.cd")
    ap.add_argument(
        "--existing",
        default=None,
        help="**已注册**的邮箱（否则会真建账号!）。缺省读 .env.local 的 WARDEN_TEST_MAIL。",
    )
    ap.add_argument("--blocked", default="x@163.com", help="白名单外的邮箱（401）")
    ap.add_argument(
        "--negative",
        default="reg-probe-never-registered@qq.com",
        help="**未被注册**且在白名单内的邮箱，用于查重假阳性的负向对照（不写库）",
    )
    args = ap.parse_args()

    args.existing = resolve_existing_email(args.existing)
    masked = args.existing[:2] + "***@" + args.existing.partition("@")[2]

    print("=" * 68)
    print("注册错误可见性探针 · 零副作用版")
    print(f"base = {args.base}")
    print(f"existing (必须已注册) = {masked}")
    print(f"blocked  (白名单外)   = {args.blocked}")
    print("=" * 68)

    results = []

    # 1. 已注册邮箱。修复前 = 500 Database error / 修复后 = 400 明确提示。
    st, body = post(args.base, "/identity/accounts/register/finish", build_payload(args.existing))
    if st == 200:
        print("\n🔴🔴 警告：该邮箱其实**没有注册**，探针刚刚创建了一个真账号！")
        print("     请到 D1 里删掉它，并把 --existing 换成真正已注册的邮箱。")
    results.append(check("① 已注册邮箱（应被明确拒绝）", st, body, {400, 409}))

    # 2. 白名单外邮箱。必然在写库前终止。
    st, body = post(args.base, "/identity/accounts/register", build_payload(args.blocked))
    if st == 200:
        print(f"\n🔴🔴 警告：{args.blocked} 竟然注册成功了 —— 白名单配置与预期不符！")
    results.append(check("② 白名单外邮箱（应被拒绝）", st, body, {401, 400}))

    # 3. 负向对照: 未被注册的邮箱 + 非法 KDF。
    st, body = post(
        args.base, "/identity/accounts/register", build_bad_kdf_payload(args.negative)
    )
    if st == 200:
        print(f"\n🔴🔴 警告：{args.negative} 竟然注册成功了 —— 非法 KDF 本该被拒！")
    results.append(check_negative_control(st, body))

    print("\n" + "=" * 68)
    passed = sum(1 for r in results if r)
    print(f"结果: {passed}/{len(results)} 通过")
    print("=" * 68)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
