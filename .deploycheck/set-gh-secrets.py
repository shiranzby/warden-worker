#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 `.deploycheck/.env.local` 里的凭据写进 GitHub 仓库 secret（走 libsodium sealed box）。

为什么要有这个脚本：workflow 里 `${{ secrets.X }}` 只能从 GitHub 侧读，本机没有 `gh` CLI；
而"看起来配了"和"真的配了"是两件事 —— 写完必须回读确认（回读只给 name/created_at，不给值）。

🔴 安全边界：
   · 值只从 `.env.local`（被 gitignore）读，**绝不硬编码在本文件里**，也**绝不打印**；
   · 只写命令行显式列出的那几个键，不会"顺手"把 .env.local 全量推上去；
   · 本文件本身可以进 public 仓库（无凭据）。

用法（在 warden-worker 目录下，用带 PyNaCl 的那个 python）：
    python .deploycheck/set-gh-secrets.py WEBDAV_URL WEBDAV_USER WEBDAV_PASSWORD
    python .deploycheck/set-gh-secrets.py WEBDAV_URL --list      # 只列已有 secret 名
"""
from __future__ import annotations

import base64
import json
import pathlib
import sys
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = "shiranzby/warden-worker"
PROXY = "http://127.0.0.1:7890"


def env_of(key: str) -> str:
    f = HERE / ".env.local"
    if not f.exists():
        sys.exit("❌ 找不到 .deploycheck/.env.local")
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"❌ .env.local 里没有 {key}")


def token() -> str:
    return env_of("GH_PAT")


def api(method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"https://api.github.com{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token()}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    # 本机代理经 TLS 偶发 SSLEOFError ⇒ 重试几次，别把"网络抖"当成"没权限"
    last: Exception | None = None
    for _ in range(4):
        try:
            with opener.open(req, timeout=60) as r:
                raw = r.read().decode("utf-8", "replace")
                return r.status, (json.loads(raw) if raw.strip() else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(raw)
            except json.JSONDecodeError:
                return e.code, {"raw": raw[:500]}
        except Exception as e:  # noqa: BLE001
            last = e
    raise SystemExit(f"❌ 4 次重试后仍失败: {last!r}")


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--list"]
    if not args or "--list" in sys.argv[1:]:
        st, d = api("GET", f"/repos/{REPO}/actions/secrets?per_page=100")
        if st != 200:
            print(f"❌ HTTP {st}: {d}")
            return 1
        names = [s["name"] for s in d.get("secrets", [])]
        print(f"仓库 {REPO} 现有 secret {d.get('total_count')} 个：")
        for n in sorted(names):
            print("   ", n)
        return 0

    import nacl.public  # noqa: PLC0415

    st, key = api("GET", f"/repos/{REPO}/actions/secrets/public-key")
    if st != 200:
        print(f"❌ 取公钥失败 HTTP {st}: {key}")
        return 1
    box = nacl.public.SealedBox(nacl.public.PublicKey(base64.b64decode(key["key"])))

    ok = 0
    for name in args:
        value = env_of(name)
        enc = base64.b64encode(box.encrypt(value.encode())).decode()
        st, d = api("PUT", f"/repos/{REPO}/actions/secrets/{name}", {"encrypted_value": enc, "key_id": key["key_id"]})
        if st in (201, 204):
            ok += 1
            print(f"  ✅ {name} 已写入（值长 {len(value)}，未回显）")
        else:
            print(f"  ❌ {name} 写入失败 HTTP {st}: {json.dumps(d, ensure_ascii=False)[:300]}")

    # 回读确认（只给名字和时间，不给值）—— "写成功了"和"真的在那儿"要分开证明
    st, d = api("GET", f"/repos/{REPO}/actions/secrets?per_page=100")
    have = {s["name"] for s in (d.get("secrets") or [])} if st == 200 else set()
    missing = [n for n in args if n not in have]
    print(f"\n回读确认：{len(args) - len(missing)}/{len(args)} 在位" + (f"；缺 {missing}" if missing else ""))
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main())
