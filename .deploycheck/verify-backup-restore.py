#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把坚果云里的最新备份**拉回来、解密、解压、验结构** —— 证明它真的能恢复，而不只是"传上去了"。

备份不能恢复就等于没有备份。这一步是整条链路的最后一段：
    GitHub Actions 导出+加密+上传  →  坚果云  →  本脚本下载+解密+解压+校验

🔴 安全边界：
   · 备份里有密码条目/TOTP/哈希 —— 解密后**只打印结构信息**（表名、行数、列名），
     **绝不打印任何数据行**；
   · 明文落盘后立即删除（`--keep` 可保留以便人工排查）；
   · 口令只从 `.deploycheck/.env.local` 读。

用法（在 warden-worker 目录下）：
    python .deploycheck/verify-backup-restore.py            # 验最新的一个
    python .deploycheck/verify-backup-restore.py --keep      # 保留解密后的明文
    python .deploycheck/verify-backup-restore.py --list      # 只列云端有哪些备份
退出码：全过 0。
"""
from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
WORK = HERE / ".restore-probe"
PROXY = "http://127.0.0.1:7890"
OPENSSL = "openssl"


def env_of(key: str) -> str:
    f = HERE / ".env.local"
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"❌ .env.local 里没有 {key}")


def webdav_get(path: str, out: pathlib.Path) -> int:
    """下载（走代理）。返回 HTTP 状态码。"""
    import urllib.request

    base = env_of("WEBDAV_URL").rstrip("/") + "/"
    import base64

    auth = "Basic " + base64.b64encode(f"{env_of('WEBDAV_USER')}:{env_of('WEBDAV_PASSWORD')}".encode()).decode()
    req = urllib.request.Request(base + urllib.parse.quote(path), method="GET",
                                 headers={"Authorization": auth, "User-Agent": "wb"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    try:
        with opener.open(req, timeout=120) as r, open(out, "wb") as fh:
            fh.write(r.read())
        return 200
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:  # noqa: BLE001
        print(f"  下载失败: {e!r}")
        return -1


def propfind(path: str) -> dict[str, int]:
    import importlib.util

    spec = importlib.util.spec_from_file_location("vw", HERE / "verify-webdav.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.propfind_len(urllib.parse.quote(path))


def main() -> int:
    keep = "--keep" in sys.argv
    base = env_of("WEBDAV_BASE_PATH") or "warden-worker"
    remote_dir = f"{base}/production"

    if "--list" in sys.argv:
        print(f"云端 {remote_dir}/ 下的备份：")
        for k, v in sorted(propfind(remote_dir).items()):
            if k.startswith("__"):
                continue
            print(f"   {urllib.parse.unquote(k):<56} {v:>10,} B")
        return 0

    listing = {urllib.parse.unquote(k): v for k, v in propfind(remote_dir).items() if not k.startswith("__")}
    files = {k: v for k, v in listing.items() if k.endswith(".enc") or k.endswith(".sql.gz")}
    if not files:
        print(f"❌ {remote_dir}/ 下没有任何备份文件（现有: {listing}）")
        return 1
    name = sorted(files)[-1]  # 名字带时间戳，字典序 == 时间序
    print(f"\n========== 备份可恢复性验证（{name}）==========")
    print(f"云端大小 = {files[name]:,} B")

    WORK.mkdir(exist_ok=True)
    enc = WORK / name
    st = webdav_get(f"{remote_dir}/{name}", enc)
    print(f"{'✅' if st == 200 else '❌'} 下载回本地  http={st}  落地 {enc.stat().st_size:,} B" if st == 200 else f"❌ 下载失败 http={st}")
    if st != 200:
        return 1
    if enc.stat().st_size != files[name]:
        print(f"❌ 字节数与云端不一致（本地 {enc.stat().st_size} vs 云端 {files[name]}）")
        return 1
    print("✅ 字节数与云端一致")

    # 解密
    key = env_of("BACKUP_ENCRYPTION_KEY")
    dec = WORK / (name[:-4] if name.endswith(".enc") else name + ".dec")
    r = subprocess.run([OPENSSL, "enc", "-d", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "100000",
                        "-in", str(enc), "-out", str(dec), "-pass", f"pass:{key}"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f"❌ 解密失败：{r.stderr.strip()[:200]}")
        return 1
    print(f"✅ AES-256 解密成功（{dec.stat().st_size:,} B）")

    # 解压
    sql = dec.with_suffix("")
    r = subprocess.run(["gzip", "-d", "-c", str(dec)], capture_output=True)
    if r.returncode != 0:
        print(f"❌ gunzip 失败：{r.stderr.decode('utf-8', 'replace')[:200]}")
        return 1
    sql.write_bytes(r.stdout)
    text = r.stdout.decode("utf-8", "replace")
    print(f"✅ gunzip 成功（{sql.stat().st_size:,} B）")

    # 结构校验：表、列、行数（**不打数据行**）
    tables = re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?[`\"]?(\w+)", text)
    inserts = re.findall(r"INSERT INTO [`\"]?(\w+)", text)
    counts: dict[str, int] = {}
    for t in inserts:
        counts[t] = counts.get(t, 0) + 1
    print(f"\n表 {len(tables)} 张：{', '.join(sorted(set(tables)))}")
    print("每表 INSERT 语句数（≈行数，仅结构信息）：")
    for t in sorted(counts):
        print(f"   {t:<28} {counts[t]:>5} 条")
    need = {"users", "ciphers"}
    miss = need - set(tables)
    print(f"\n{'✅' if not miss else '❌'} 关键表齐全（users / ciphers）" + (f"  缺: {miss}" if miss else ""))

    # 收尾
    if keep:
        print(f"\n已保留明文：{sql}（含真实密码数据，看完请手工删）")
    else:
        for p in (enc, dec, sql):
            p.unlink(missing_ok=True)
        print("\n明文与密文均已删除（--keep 可保留）")
    return 0 if not miss else 1


if __name__ == "__main__":
    sys.exit(main())
