#!/usr/bin/env python3
"""部署测试通道 `warden-worker-test`（shytest.cc.cd）：前端 + 账号管理台。

做四件事：
  1. 把仓库根的 `admin/index.html` 复制到 `test-proxy/dist/admin/index.html`
     （同一份页面两处用：这里是 assets，生产由 CI 复制进 public/web-vault/admin/）
  2. 体检 `dist/`（必须是剔掉 *.map 的前端产物，否则 25 MiB 单文件上限会让部署中止）
  3. 确保 `ADMIN_TOKEN` secret 存在 —— 值从 `.deploycheck/.env.local` 读；没有就随机生成一个
     写回去（**只落本地，不入库**）
  4. `npx wrangler deploy --config test-proxy/wrangler.test.toml`

用法（在 warden-worker 目录下）：
  python test-proxy/deploy-test.py
  python test-proxy/deploy-test.py --skip-frontend   # 只更管理台与 worker.js，不动 dist 前端

⚠️ 这个脚本只碰 `warden-worker-test`（测试通道）。生产走 `.github/workflows/push-cloudflare.yaml`。
"""

import os
import re
import secrets
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(ROOT, ".deploycheck", ".env.local")
ADMIN_SRC = os.path.join(ROOT, "admin", "index.html")
DIST = os.path.join(ROOT, "test-proxy", "dist")
CONFIG = "test-proxy/wrangler.test.toml"
SECRET_NAME = "ADMIN_TOKEN"
ENV_KEY = "ADMIN_TOKEN_TEST"


def read_env():
    data = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    data[k.strip()] = v.strip()
    return data


def upsert_env(key, value):
    lines = []
    found = False
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as fh:
            for line in fh:
                if line.strip().startswith(key + "="):
                    lines.append(f"{key}={value}\n")
                    found = True
                else:
                    lines.append(line)
    if not found:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(f"{key}={value}\n")
    with open(ENV_FILE, "w", encoding="utf-8") as fh:
        fh.writelines(lines)


def run(cmd, **kw):
    print("  $ " + " ".join(cmd))
    return subprocess.run(cmd, cwd=ROOT, text=True, encoding="utf-8", **kw)


def main():
    skip_frontend = "--skip-frontend" in sys.argv
    env = read_env()

    # ---------- 1. 管理台页面 ----------
    if not os.path.exists(ADMIN_SRC):
        print(f"❌ 找不到管理台页面: {ADMIN_SRC}")
        return 1
    dst_dir = os.path.join(DIST, "admin")
    os.makedirs(dst_dir, exist_ok=True)
    shutil.copyfile(ADMIN_SRC, os.path.join(dst_dir, "index.html"))
    size = os.path.getsize(ADMIN_SRC)
    print(f"[1/4] 管理台页面 -> dist/admin/index.html（{size} 字节）")

    # ---------- 2. 前端产物体检 ----------
    if not skip_frontend:
        # ⚠️ 必须**递归**找：主包在 dist/app/ 下，不在 dist/ 顶层。
        #    第一版写成顶层 listdir，结果在产物完全正常的情况下报"产物不完整、拒绝部署"。
        mains, maps, biggest = [], [], 0
        for dirpath, _dirs, files in os.walk(DIST):
            for f in files:
                full = os.path.join(dirpath, f)
                if f.endswith(".map"):
                    maps.append(full)
                if re.match(r"^main\.[a-z0-9]+\.js$", f):
                    mains.append(os.path.relpath(full, DIST))
                biggest = max(biggest, os.path.getsize(full))
        if not mains:
            print("❌ dist/ 里没有 main.*.js —— 前端产物不完整，拒绝部署")
            return 1
        if maps:
            print(f"❌ dist/ 里有 {len(maps)} 个 *.map —— 单文件可能超过 25 MiB，先剔掉再部署")
            return 1
        print(f"[2/4] dist 体检通过：main={mains[0]}，最大单文件 {biggest / 1048576:.1f} MiB"
              f"（Cloudflare 单资源上限 25 MiB）")
    else:
        print("[2/4] 跳过前端体检（--skip-frontend）")

    # ---------- 3. 管理令牌 ----------
    token = env.get(ENV_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        upsert_env(ENV_KEY, token)
        print(f"[3/4] 生成了新的管理令牌并写入 .deploycheck/.env.local 的 {ENV_KEY}")
    else:
        print(f"[3/4] 复用 .env.local 里已有的 {ENV_KEY}（前 6 位 {token[:6]}…）")

    npx = shutil.which("npx") or shutil.which("npx.cmd") or "npx"
    cf_env = dict(os.environ)
    if env.get("CLOUDFLARE_EMAIL"):
        cf_env["CLOUDFLARE_EMAIL"] = env["CLOUDFLARE_EMAIL"]
    if env.get("CLOUDFLARE_API_KEY"):
        cf_env["CLOUDFLARE_API_KEY"] = env["CLOUDFLARE_API_KEY"]

    # ---------- 4a. secret ----------
    print(f"[4/4] 写入 secret {SECRET_NAME}")
    r = run([npx, "wrangler", "secret", "put", SECRET_NAME, "--config", CONFIG],
            input=token + "\n", capture_output=True, env=cf_env)
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    if r.returncode != 0:
        print(out[-1200:])
        print("❌ secret 写入失败")
        return 1
    print("  ✅ secret 已更新（线上立即生效，不必等部署）")

    # ---------- 4b. deploy ----------
    print("[4/4] wrangler deploy")
    r = run([npx, "wrangler", "deploy", "--config", CONFIG], env=cf_env)
    if r.returncode != 0:
        print("❌ 部署失败")
        return 1
    print("\n✅ 测试通道已部署: https://test.shytest.cc.cd  （管理台在 /admin/）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
