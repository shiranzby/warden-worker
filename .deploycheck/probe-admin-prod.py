#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""账号管理台在生产实例上的**只读**验收探针。

## 为什么不复用测试通道那套
测试通道(warden-worker-test)已经有 64 项运行期断言, 但它跑在**灌了种子数据的测试库**上,
且允许随意写。生产 `shypwd.cc.cd` 上是用户的**真实账号**, 所以这一轮的纪律是:
**一个字节都不许改**。于是这里只做三类事:

  1. 读接口(session / users / stats)在正确凭据下的返回形状;
  2. 鉴权的**负向**分支: 无凭据、错凭据 —— 必须 401, 且响应体与"没给"完全一样
     (不区分二者, 免得被用来探测);
  3. **写接口在鉴权失败时不得落库** —— 用"调用前后 SELECT COUNT(*) 不变"来机器证明,
     而不是靠肉眼说"我没点写操作"。

## 为什么写接口也算"只读"
第 3 类里对**不存在的随机 uuid** 调 `/sign-out`, 期望 404。它在代码里的顺序是
`authorize() -> find_user_email() -> None 就 return 404`, **没有任何写语句被执行**。
用"前后 count 不变"把这句话钉住, 比不调它更有说服力 —— 否则"鉴权挡住了写路径"这件事
从来没被验证过。

## 凭据
只从 `.deploycheck/.env.local` 读(该文件被 gitignore)。仓库是 public, 别写进脚本。
本机直连 CF 边缘会被 TLS reset, 一律走 `http://127.0.0.1:7890`。

用法:
    python .deploycheck/probe-admin-prod.py
    python .deploycheck/probe-admin-prod.py --base https://shypwd.cc.cd
"""
from __future__ import annotations

import json
import pathlib
import ssl
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
BASE = "https://shypwd.cc.cd"
PROXY = "http://127.0.0.1:7890"

# 生产 D1(vault1)。只用作"账号数前后不变"的旁证。
PROD_D1 = "24892a66-2a3e-4e2e-a6c0-dbc3119b584e"
ACC_KEY = "CLOUDFLARE_ACCOUNT_ID"

PASS = 0
FAIL = 0
NOTE = []


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  \u2705 {name}" + (f"  [{detail}]" if detail else ""))
    else:
        FAIL += 1
        print(f"  \u274c {name}" + (f"  [{detail}]" if detail else ""))


def load_env() -> dict:
    out = {}
    f = HERE / ".env.local"
    if not f.exists():
        return out
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


ENV = load_env()


def http(method: str, url: str, headers: dict | None = None, body: bytes | None = None):
    """走代理发一个请求, 返回 (status, text)。失败返回 (0, 错误串)。"""
    cmd = [
        "curl", "-sS", "-x", PROXY, "--retry", "4", "--retry-all-errors",
        "--max-time", "40", "-X", method, "-w", "\n%{http_code}",
    ]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", body.decode("utf-8")]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        return 0, (r.stderr or "").strip()
    lines = r.stdout.rsplit("\n", 1)
    if len(lines) != 2:
        return 0, r.stdout
    return int(lines[1].strip() or 0), lines[0]


def d1_count() -> int | None:
    """读生产 D1 的 users 行数(只读 SELECT)。"""
    acc = ENV.get(ACC_KEY)
    email = ENV.get("CLOUDFLARE_EMAIL")
    key = ENV.get("CLOUDFLARE_API_KEY")
    if not (acc and email and key):
        return None
    payload = json.dumps({"sql": "SELECT COUNT(*) AS cnt FROM users"}).encode()
    status, text = http(
        "POST",
        f"https://api.cloudflare.com/client/v4/accounts/{acc}/d1/database/{PROD_D1}/query",
        {"X-Auth-Email": email, "X-Auth-Key": key},
        payload,
    )
    if status != 200:
        return None
    try:
        d = json.loads(text)
        return int(d["result"][0]["results"][0]["cnt"])
    except Exception:
        return None


def main() -> int:
    secret = ENV.get("ADMIN_TOKEN", "")
    base = BASE
    if "--base" in sys.argv:
        base = sys.argv[sys.argv.index("--base") + 1].rstrip("/")

    print("=" * 68)
    print(f"账号管理台 · 生产只读验收 · {base}")
    print("=" * 68)
    if not secret:
        print("  \u26a0\ufe0f 未读到 ADMIN_TOKEN(.deploycheck/.env.local), 跳过正向断言")
    NOTE.append(("凭据来源", "已从 .deploycheck/.env.local 读取" if secret else "缺失"))

    before = d1_count()
    print(f"\n[A] 鉴权负向分支(不落库)")
    st, body = http("GET", f"{base}/api/admin/users")
    check("无凭据 -> 401", st == 401, f"http={st}")
    body_none = body
    st2, body_wrong = http("GET", f"{base}/api/admin/users", {"X-Admin-Token": "definitely-not-the-token"})
    check("错凭据 -> 401", st2 == 401, f"http={st2}")
    check(
        "\u201c没给\u201d与\u201c给错\u201d响应体完全相同(不可区分)",
        body_none.strip() == body_wrong.strip() and body_none.strip() != "",
        f"len={len(body_none)} vs {len(body_wrong)}",
    )
    try:
        j = json.loads(body_wrong)
        check("401 体里同时有 error 与 message 两个键", "error" in j and "message" in j,
              json.dumps(j, ensure_ascii=False)[:70])
    except Exception as e:
        check("401 体是合法 JSON", False, str(e))

    print(f"\n[B] 写接口在鉴权失败时不得落库")
    import uuid as _uuid
    ghost = str(_uuid.uuid4())
    st3, _b3 = http("POST", f"{base}/api/admin/users/{ghost}/sign-out")  # 无令牌
    check("无令牌调写接口 -> 401(而非 403/404)", st3 == 401, f"http={st3}")

    if not secret:
        print(f"\n[C] 正向只读断言 —— 跳过(无凭据)")
    else:
        hdr = {"X-Admin-Token": secret}
        print(f"\n[C] 正向只读接口")
        st4, b4 = http("GET", f"{base}/api/admin/session", hdr)
        check("GET /api/admin/session -> 200", st4 == 200, f"http={st4} {b4[:60]}")
        try:
            js = json.loads(b4)
            check("session.env == prod", js.get("env") == "prod", f"env={js.get('env')}")
            check("session.db == vault1", js.get("db") == "vault1", f"db={js.get('db')}")
            check("session.now 是 ISO8601", isinstance(js.get("now"), str) and "T" in js["now"],
                  str(js.get("now"))[:24])
        except Exception as e:
            check("session 返回合法 JSON", False, str(e))

        st5, b5 = http("GET", f"{base}/api/admin/users", hdr)
        check("GET /api/admin/users -> 200", st5 == 200, f"http={st5}")
        users = []
        try:
            users = json.loads(b5).get("users") or []
        except Exception as e:
            check("users 返回合法 JSON", False, str(e))
        check("users 是非空列表", len(users) > 0, f"n={len(users)}")
        if users:
            keys = {"id", "email", "name", "email_verified", "created_at", "expires_at",
                    "disabled_at", "items", "devices", "has_totp"}
            missing = sorted(keys - set(users[0]))
            check("每条记录字段齐全", not missing, f"缺={missing}")
            check(
                "既有账号的 expires_at / disabled_at 均为 null(升级前后行为一致)",
                all(u.get("expires_at") is None and u.get("disabled_at") is None for u in users),
                f"非 null 的条数={sum(1 for u in users if u.get('expires_at') or u.get('disabled_at'))}",
            )
            check("has_totp / items / devices 是布尔与整数",
                  all(isinstance(u.get("has_totp"), bool) and isinstance(u.get("items"), int)
                      and isinstance(u.get("devices"), int) for u in users), "ok")
            # 管理台只应暴露元数据, 不该出现任何密文/口令字段
            forbidden = {"key", "private_key", "public_key", "master_password_hash",
                         "password_salt", "totp_recover", "security_stamp"}
            leaked = sorted(set().union(*[set(u) for u in users]) & forbidden)
            check("响应里没有零知识字段泄漏", not leaked, f"泄漏={leaked}")

        st6, b6 = http("GET", f"{base}/api/admin/stats", hdr)
        check("GET /api/admin/stats -> 200", st6 == 200, f"http={st6}")
        try:
            s = json.loads(b6).get("stats") or {}
            check("stats.users 是整数且与列表条数一致",
                  isinstance(s.get("users"), int) and s["users"] == len(users),
                  f"stats={s.get('users')} list={len(users)}")
            check("stats 五个字段齐全",
                  all(k in s for k in ("users", "items", "totp", "disabled", "expiring")),
                  json.dumps(s, ensure_ascii=False))
        except Exception as e:
            check("stats 返回合法 JSON", False, str(e))

        print(f"\n[D] 404 路径(用不存在的随机 uuid, 代码顺序上无写语句)")
        st7, b7 = http("POST", f"{base}/api/admin/users/{ghost}/sign-out", hdr)
        check("正确令牌 + 不存在 id -> 404", st7 == 404, f"http={st7} {b7[:60]}")
        st8, _ = http("POST", f"{base}/api/admin/users/{ghost}/reset-2fa", hdr)
        check("reset-2fa 同样 404", st8 == 404, f"http={st8}")
        st9, _ = http("POST", f"{base}/api/admin/users/{ghost}/expire", hdr, json.dumps({"days": 7}).encode())
        check("expire 同样 404", st9 == 404, f"http={st9}")
        st10, _ = http("DELETE", f"{base}/api/admin/users/{ghost}", hdr)
        check("delete 同样 404", st10 == 404, f"http={st10}")

    print(f"\n[E] 静态页面")
    st11, b11 = http("GET", f"{base}/admin/")
    check("GET /admin/ -> 200", st11 == 200, f"http={st11} len={len(b11)}")
    check("页面含 [hidden] 兜底规则", "[hidden]" in b11 and "!important" in b11, "ok")
    check("页面接口基址是 /api/admin", '"/api/admin"' in b11, "ok")

    after = d1_count()
    print(f"\n[F] 零副作用旁证(生产 D1 users 行数前后不变)")
    if before is None or after is None:
        check("读到生产 D1 账号数", False, f"before={before} after={after}")
    else:
        check("调用前后 users 行数不变", before == after, f"{before} -> {after}")

    print("\n" + "=" * 68)
    print(f"结果: {PASS} 通过 / {FAIL} 失败")
    for k, v in NOTE:
        print(f"  \u00b7 {k}: {v}")
    print("=" * 68)
    return 1 if FAIL else 0


if __name__ == "__main__":
    ssl._create_default_https_context = ssl._create_unverified_context
    sys.exit(main())
