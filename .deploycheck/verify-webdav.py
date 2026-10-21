#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证坚果云（或任意 WebDAV）凭据能不能真的读写 —— 配 Backup D1 Database 的 WEBDAV_* 之前必须先过这关。

为什么不能只"看起来配好了"：`WEBDAV_*` 四个 secret 缺一个、密码过期、URL 少了 `/dav/`，
workflow 的表现都是同一个 —— 上传步骤静默跳过或报错，而备份"看起来在跑"。
本脚本做一次完整的**往返**：认证 → 建目录 → 上传 → 列目录确认大小 → 删除 → 删目录，
最后**不留任何痕迹**（不往用户的云盘里丢垃圾）。

凭据只从 `.deploycheck/.env.local` 读（该文件被 gitignore，不会进 public 仓库）。

用法:
    python .deploycheck/verify-webdav.py            # 默认读 WEBDAV_URL/USER/PASSWORD
    python .deploycheck/verify-webdav.py --keep      # 保留目录不删（调试用）
退出码：全过 0，任何一步不过 1。
"""
from __future__ import annotations

import base64
import pathlib
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
PROXY = "http://127.0.0.1:7890"
TIMEOUT = 45


def env_of(key: str) -> str:
    f = HERE / ".env.local"
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"❌ .env.local 里找不到 {key}")


URL = env_of("WEBDAV_URL").rstrip("/") + "/"
USER = env_of("WEBDAV_USER")
PASS = env_of("WEBDAV_PASSWORD")
BASE = env_of("WEBDAV_BASE_PATH") or "warden-worker"
AUTH = "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()

# 用一个明显是测试的名字，避免和真实备份混淆
TEST_DIR = f"{BASE}-selftest"
TEST_FILE = "webdav-selftest.txt"


def req(method: str, path: str, body: bytes | None = None, headers: dict | None = None, depth: str | None = None):
    h = {"Authorization": AUTH, "User-Agent": "warden-backup-selftest/1.0"}
    if headers:
        h.update(headers)
    if depth is not None:
        h["Depth"] = depth
    r = urllib.request.Request(URL + path, data=body, method=method, headers=h)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    try:
        with opener.open(r, timeout=TIMEOUT) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return -1, str(e).encode()


PROPFIND_BODY = b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/></d:prop></d:propfind>'

ok_n = 0
fail_n = 0


def check(name: str, cond: bool, extra: str = "") -> None:
    global ok_n, fail_n
    if cond:
        ok_n += 1
        print(f"  ✅ {name}{'  ' + extra if extra else ''}")
    else:
        fail_n += 1
        print(f"  ❌ {name}{'  ' + extra if extra else ''}")


def propfind_len(path: str) -> dict[str, int]:
    """列一层目录，返回 {文件名: 大小}。"""
    st, raw = req("PROPFIND", path, PROPFIND_BODY, {"Content-Type": "application/xml"}, depth="1")
    if st != 207 and st != 200:
        return {"__error__": st}
    out: dict[str, int] = {}
    try:
        root = ET.fromstring(raw)
        for resp in root.iter():
            if resp.tag.endswith("}response"):
                href = next((e.text for e in resp.iter() if e.tag.endswith("}href")), "")
                ln = next((e.text for e in resp.iter() if e.tag.endswith("}getcontentlength")), "0")
                name = href.rstrip("/").split("/")[-1]
                if name:
                    out[name] = int(ln or 0)
    except ET.ParseError:
        return {"__parse_error__": 0}
    return out


def cleanup() -> int:
    """只做清理（自检被中断、或想重试删除时用）。坚果云删目录偶发 403，带重试。"""
    import time
    d = f"{BASE}-selftest"
    print(f"\n===== 清理 {d}/ =====")
    for attempt in range(1, 6):
        inside = propfind_len(d)
        if "__error__" in inside:
            print(f"  [{attempt}] 目录已不存在（{inside['__error__']}）—— 无需清理")
            return 0
        print(f"  [{attempt}] 目录内容: {inside}")
        st, raw = req("DELETE", d)
        print(f"       DELETE -> {st}" + (f"  body={raw[:120]!r}" if st not in (200, 204) else ""))
        if st in (200, 204):
            print("  ✅ 已删除")
            return 0
        time.sleep(4)
    print("  ⚠️ 仍删不掉，请到坚果云客户端里手工删一下（不影响备份本身）")
    return 1


def main() -> int:
    if "--cleanup" in sys.argv:
        return cleanup()
    print(f"\n========== WebDAV 凭据自检（{URL}）==========")
    print(f"账号 = {USER}    目标目录 = {BASE}/")

    # ① 认证 + 根目录可读
    st, _ = req("PROPFIND", "", PROPFIND_BODY, {"Content-Type": "application/xml"}, depth="0")
    check("① 认证与根目录可读（PROPFIND → 207）", st in (207, 200), f"http={st}"
          + ("  ⇒ 密码/URL 不对" if st == 401 else ""))

    # ② 建目录（父 → 子，坚果云不支持一次建多层）
    st1, _ = req("MKCOL", TEST_DIR)
    st2, _ = req("MKCOL", f"{TEST_DIR}/production")
    check("② 能建目录（MKCOL → 201 或 405 已存在）", st1 in (201, 405) and st2 in (201, 405),
          f"{TEST_DIR}={st1}  {TEST_DIR}/production={st2}")

    # ③ 上传
    payload = b"warden-worker webdav selftest\n"
    st3, _ = req("PUT", f"{TEST_DIR}/production/{TEST_FILE}", payload, {"Content-Type": "text/plain"})
    check("③ 能上传文件（PUT → 201/204）", st3 in (201, 204), f"http={st3}")

    # ④ 列目录，确认**字节数对得上**（证明不是"返回 201 但内容没落地"）
    listed = propfind_len(f"{TEST_DIR}/production")
    got = listed.get(TEST_FILE)
    check("④ 上传后列得到、且字节数一致", got == len(payload),
          f"期望 {len(payload)} 实际 {got}（目录内容: {listed}）")

    # ⑤ 删除文件 + 目录，不留痕迹
    st5, _ = req("DELETE", f"{TEST_DIR}/production/{TEST_FILE}")
    st6, _ = req("DELETE", f"{TEST_DIR}/production")
    st7, _ = req("DELETE", TEST_DIR)
    check("⑤ 能删除（DELETE → 200/204）", st5 in (200, 204) and st7 in (200, 204),
          f"file={st5} production={st6} {TEST_DIR}={st7}")
    left = propfind_len(f"{TEST_DIR}")
    check("⑥ 清理后不残留", "__error__" in left or not any(k != "__error__" for k in left),
          f"剩余: {left}")

    print(f"\n==============================================================")
    print(f"结果: {ok_n} 通过 / {fail_n} 失败")
    print(f"==============================================================")
    return 1 if fail_n else 0


if __name__ == "__main__":
    sys.exit(main())
