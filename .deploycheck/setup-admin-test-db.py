#!/usr/bin/env python3
"""为「账号管理台」建立**独立测试库**(vault1-admin-test) 并灌入测试数据。

🔴🔴 本脚本只认下面写死的 DB_UUID(vault1-admin-test)。**绝不触碰生产库 vault1**
     (`24892a66-2a3e-4e2e-a6c0-dbc3119b584e`) —— 需求方的原话是"先测试、截图没问题再上生产",
      所以这里连读都不读生产库一眼。

做法:
  1) 把 sql/schema.sql 的 23 条语句原样执行到测试库(它就是当前最新的完整结构,
     不需要再逐条跑 migrations —— schema.sql 已含 password_salt / kdf_memory / avatar_image 等)
  2) 追加管理台需要的两列: expires_at / disabled_at(生产侧会由 migrations/0015 加同样的列)
  3) 清空 users/ciphers/devices/twofactor 后重建 5 个**假账号**, 覆盖管理台要展示的各种状态

用法(在 warden-worker 目录下):
  python .deploycheck/setup-admin-test-db.py            # 建库+灌数据
  python .deploycheck/setup-admin-test-db.py --verify   # 只读查询, 不动数据

凭据从 .deploycheck/.env.local 读(CLOUDFLARE_EMAIL / CLOUDFLARE_API_KEY / CLOUDFLARE_ACCOUNT_ID),
不硬编码 —— 本文件是要入库的(.gitignore 白名单), 扫描必须 0 命中。
"""

import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(ROOT, ".deploycheck", ".env.local")
SCHEMA = os.path.join(ROOT, "sql", "schema.sql")

# ⚠️ 写死的测试库(见模块 docstring)。生产库 id = 24892a66-…-dbc3119b584e, **不要**换进去。
DB_NAME = "vault1-admin-test"
DB_UUID = "766024ce-a2b7-49a2-bfe7-d45b250d642a"
PROD_UUID = "24892a66-2a3e-4e2e-a6c0-dbc3119b584e"


def load_env():
    env = {}
    with open(ENV_FILE, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


ENV = load_env()
ACC = ENV["CLOUDFLARE_ACCOUNT_ID"]

assert DB_UUID != PROD_UUID, "拒绝执行: 测试库 UUID 被误改成了生产库!"


def d1(sql, params=None):
    """执行一条 SQL, 返回 (ok, result_or_error)。"""
    body = {"sql": sql}
    if params:
        body["params"] = params
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACC}/d1/database/{DB_UUID}/query"
    out = subprocess.run(
        [
            "curl", "-sS", "--max-time", "60",
            "-H", f"X-Auth-Email: {ENV['CLOUDFLARE_EMAIL']}",
            "-H", f"X-Auth-Key: {ENV['CLOUDFLARE_API_KEY']}",
            "-H", "Content-Type: application/json",
            "-X", "POST", url,
            "-d", json.dumps(body, ensure_ascii=False),
        ],
        capture_output=True, text=True, encoding="utf-8",
    ).stdout
    try:
        data = json.loads(out)
    except Exception:
        return False, f"非 JSON 响应: {out[:300]}"
    if not data.get("success"):
        return False, data.get("errors")
    res = data.get("result") or [{}]
    return True, res[0]


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def main():
    verify_only = "--verify" in sys.argv

    print(f"目标测试库: {DB_NAME} / {DB_UUID}")
    ok, r = d1("SELECT COUNT(*) AS n FROM users")
    if not ok:
        print("❌ 测试库不可用(表还没建?):", r)
        if verify_only:
            return 1
    else:
        print(f"  当前 users 行数 = {r.get('results', [{}])[0].get('n')}")

    if verify_only:
        return show(verbose=True)

    # ---------- 1. 建表(schema.sql 全部语句) ----------
    raw = re.sub(r"--[^\n]*", "", open(SCHEMA, encoding="utf-8").read())
    stmts = [s.strip() for s in raw.split(";") if s.strip()]
    print(f"\n[1/4] 应用 schema.sql 的 {len(stmts)} 条语句")
    for i, st in enumerate(stmts):
        ok, r = d1(st)
        if not ok:
            print(f"  ❌ #{i} {st.splitlines()[0][:70]} -> {r}")
            return 1
    print("  ✅ 全部成功")

    # ---------- 2. 管理台需要的两列 ----------
    print("\n[2/4] 追加 expires_at / disabled_at")
    for col, decl in (("expires_at", "TEXT"), ("disabled_at", "TEXT")):
        ok, r = d1(f"ALTER TABLE users ADD COLUMN {col} {decl}")
        if ok:
            print(f"  ✅ 已加 {col}")
        elif "duplicate column" in json.dumps(r).lower():
            print(f"  ⏭  {col} 已存在(重跑)")
        else:
            print(f"  ❌ {col} -> {r}")
            return 1

    # ---------- 3. 清空(幂等重跑) ----------
    print("\n[3/4] 清空测试数据")
    for t in ("twofactor", "devices", "ciphers", "folders", "users"):
        ok, r = d1(f"DELETE FROM {t}")
        if not ok:
            print(f"  ❌ 清空 {t} -> {r}")
            return 1
    print("  ✅ 已清空")

    # ---------- 4. 造 5 个假账号 ----------
    print("\n[4/4] 插入测试账号")
    now = datetime.now(timezone.utc)

    def user(email, name, days_old, *, twofa=False, entries=0, devices=1,
             expires_in=None, disabled=False):
        uid = str(uuid.uuid4())
        created = iso(now - timedelta(days=days_old))
        updated = iso(now - timedelta(hours=days_old))
        ver = "1" if twofa else "0"
        rows = [
            ("id", uid), ("name", name), ("email", email), ("email_verified", ver),
            ("master_password_hash", "TESTHASH$" + uid), ("password_salt", "TESTSALT" + uid[:8]),
            ("password_iterations", 600000),
            ("key", "2.testkey"), ("private_key", "2.testpriv"), ("public_key", "testpub"),
            ("kdf_type", 0), ("kdf_iterations", 600000),
            ("security_stamp", str(uuid.uuid4())),
            ("created_at", created), ("updated_at", updated),
            ("expires_at", iso(now + timedelta(days=expires_in)) if expires_in is not None else None),
            ("disabled_at", iso(now - timedelta(days=1)) if disabled else None),
        ]
        cols = ", ".join(c for c, _ in rows)
        ph = ", ".join(f"?{i + 1}" for i in range(len(rows)))
        ok, r = d1(
            f"INSERT INTO users ({cols}) VALUES ({ph})",
            [v for _, v in rows],
        )
        if not ok:
            raise RuntimeError(f"插入 {email} 失败: {r}")

        if twofa:
            d1("INSERT INTO twofactor (uuid, user_uuid, atype, enabled, data) VALUES (?1,?2,0,1,'{}')",
               [str(uuid.uuid4()), uid])
            d1("INSERT INTO twofactor (uuid, user_uuid, atype, enabled, data) VALUES (?1,?2,8,1,'[]')",
               [str(uuid.uuid4()), uid])
        for i in range(entries):
            d1(
                "INSERT INTO ciphers (id,user_id,type,data,created_at,updated_at) "
                "VALUES (?1,?2,?3,?4,?5,?6)",
                [str(uuid.uuid4()), uid, 1, json.dumps({"name": f"2.enc-item-{i}"}), created, updated],
            )
        for i in range(devices):
            # ⚠️ devices 的列名与直觉不同: 主键是 (identifier, user_id), 设备类型列叫 `type`
            #    (不是 `atype` —— atype 是 twofactor 表的), 且 refresh_token 是 NOT NULL + UNIQUE。
            d1(
                "INSERT INTO devices (identifier,user_id,name,type,refresh_token,created_at,updated_at) "
                "VALUES (?1,?2,?3,10,?4,?5,?6)",
                [f"testdev-{uid[:6]}-{i}", uid, f"Test Device {i}",
                 str(uuid.uuid4()), created, updated],
            )
        flag = []
        if twofa:
            flag.append("2FA")
        if expires_in is not None:
            flag.append(f"{expires_in}天后到期" if expires_in > 0 else "已过期")
        if disabled:
            flag.append("已停用")
        print(f"  ✅ {email:28} {entries:2} 条目 / {devices} 设备  {' '.join(flag) or '常青'}")

    user("shy2958779577@gmail.com", "Shy", 40, twofa=True, entries=12, devices=3)
    user("family-a@qq.com", "家人 A", 6, twofa=True, entries=5, devices=1, expires_in=7)
    user("family-b@qq.com", "家人 B", 9, twofa=False, entries=0, devices=1, expires_in=-2)
    user("friend-c@163.com", "朋友 C", 20, twofa=False, entries=2, devices=1, disabled=True)
    user("temp-d@qq.com", "临时 D", 2, twofa=False, entries=8, devices=2, expires_in=3)

    print()
    return show(verbose=True)


def show(verbose=False):
    ok, r = d1(
        "SELECT u.email, u.name, u.created_at, u.expires_at, u.disabled_at, "
        "  (SELECT COUNT(*) FROM ciphers c WHERE c.user_id=u.id AND c.deleted_at IS NULL) AS items, "
        "  (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id) AS devs, "
        "  (SELECT COUNT(*) FROM twofactor t WHERE t.user_uuid=u.id AND t.atype=0) AS totp, "
        "  (SELECT COUNT(*) FROM twofactor t WHERE t.user_uuid=u.id AND t.atype=5) AS remember "
        "FROM users u ORDER BY u.created_at"
    )
    if not ok:
        print("❌ 查询失败:", r)
        return 1
    rows = r.get("results", [])
    print(f"===== 测试库现有 {len(rows)} 个账号 =====")
    for x in rows:
        print(f"  {x['email']:28} 条目={x['items']:2} 设备={x['devs']} "
              f"TOTP={'有' if x['totp'] else '无'} 记住设备={x['remember']} "
              f"到期={x['expires_at'] or '-'} 停用={x['disabled_at'] or '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
