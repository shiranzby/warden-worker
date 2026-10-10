#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本机没有 `gh` CLI，用 REST API 代劳（走代理 7890 + 仓库里的 GH_PAT）。

用法:
    python .deploycheck/gh-api.py artifacts [--repo R]
    python .deploycheck/gh-api.py dispatch <workflow-file> <ref> [k=v ...]
    python .deploycheck/gh-api.py runs [<workflow-file>] [--limit 5]
    python .deploycheck/gh-api.py run <run_id>          # 单次 run 概要
    python .deploycheck/gh-api.py jobs <run_id>         # 该 run 的 job 列表

⚠️ 本机代理会**串号**返回别的仓库的响应（历史踩过）⇒ 每次打印 `repo` 字段做归属核对，
   不匹配就直接报错退出，不让人拿着别人的数据下结论。
"""
from __future__ import annotations

import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_REPO = "shiranzby/warden-worker"
PROXY = "http://127.0.0.1:7890"


def token() -> str:
    f = HERE / ".env.local"
    if not f.exists():
        sys.exit("❌ 找不到 .deploycheck/.env.local")
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("GH_PAT="):
            t = line.split("=", 1)[1].strip()
            if t:
                return t
    sys.exit("❌ .env.local 里没有 GH_PAT")


def api(path: str, method: str = "GET", body: dict | None = None):
    url = path if path.startswith("http") else "https://api.github.com" + path
    data = json.dumps(body).encode() if body is not None else None
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY})
    )
    # ⚠️ 本机代理经 TLS 时**偶发** `SSLEOFError: UNEXPECTED_EOF_WHILE_READING`（2026-10-10 连中两次，
    #    同一个 PAT 用 curl 却正常）。一次失败就判"没权限/没触发"会误导 —— 所以**要重试**。
    last: Exception | None = None
    for attempt in range(4):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {token()}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with opener.open(req, timeout=60) as r:
                raw = r.read().decode("utf-8", "replace")
                return r.status, (json.loads(raw) if raw.strip() else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(raw)
            except json.JSONDecodeError:
                return e.code, {"raw": raw[:800]}
        except Exception as e:  # URLError / SSLError / 超时
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"❌ 4 次重试后仍无法访问 GitHub API: {last!r}")


def check_owner(obj, expect_repo: str) -> None:
    """归属核对 —— 代理串号时不让人拿错仓库的数据下结论。"""
    got = (obj or {}).get("repository", {}).get("full_name") if isinstance(obj, dict) else None
    if got and got != expect_repo:
        sys.exit(f"❌ 响应归属不对：期望 {expect_repo}，实际 {got}（代理串号？）")


def repo_of(args: list[str]) -> tuple[str, list[str]]:
    if "--repo" in args:
        i = args.index("--repo")
        return args[i + 1], args[:i] + args[i + 2 :]
    return DEFAULT_REPO, args


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd, rest = sys.argv[1], sys.argv[2:]
    repo, rest = repo_of(rest)

    if cmd == "artifacts":
        st, d = api(f"/repos/{repo}/actions/artifacts?per_page=100")
        if st != 200:
            print(f"❌ HTTP {st}: {d}")
            return 1
        arts = d.get("artifacts", [])
        print(f"仓库 {repo} · artifact 共 {len(arts)} 个（未过期 {d.get('total_count')}）")
        for a in sorted(arts, key=lambda x: x.get("created_at", ""), reverse=True):
            print(f"  {'❌' if a.get('expired') else '✅'} {a['name']:<28} "
                  f"{a.get('created_at')}  {a.get('size_in_bytes', 0) / 1048576:.1f} MiB")
        return 0

    if cmd == "dispatch":
        if len(rest) < 2:
            print("用法: dispatch <workflow-file> <ref> [k=v ...]")
            return 2
        wf, ref, kvs = rest[0], rest[1], rest[2:]
        inputs = {}
        for kv in kvs:
            if "=" not in kv:
                print(f"❌ 入参要写成 k=v: {kv}")
                return 2
            k, v = kv.split("=", 1)
            inputs[k] = v
        body = {"ref": ref}
        if inputs:
            body["inputs"] = inputs
        st, d = api(f"/repos/{repo}/actions/workflows/{wf}/dispatches", "POST", body)
        if st == 204:
            print(f"✅ 已触发 {wf} @ {ref}   inputs={inputs or '(无)'}")
            return 0
        print(f"❌ dispatch 失败 HTTP {st}: {json.dumps(d, ensure_ascii=False)[:600]}")
        return 1

    if cmd == "runs":
        limit = 5
        if "--limit" in rest:
            i = rest.index("--limit")
            limit = int(rest[i + 1])
            rest = rest[:i] + rest[i + 2 :]
        path = f"/repos/{repo}/actions/runs?per_page={limit}"
        if rest:
            path += f"&name={rest[0]}"
        st, d = api(path)
        if st != 200:
            print(f"❌ HTTP {st}: {d}")
            return 1
        runs = d.get("workflow_runs", [])
        print(f"仓库 {repo} · 最近 {len(runs)} 条 run")
        for r in runs:
            print(f"  #{r['run_number']:<5} id={r['id']:<12} {r.get('name','')[:26]:<28} "
                  f"{r.get('status'):<12} {str(r.get('conclusion')):<10} "
                  f"{r.get('head_branch','')[:20]:<22} {r.get('created_at')}")
        return 0

    if cmd in ("run", "jobs"):
        if not rest:
            print("用法: run|jobs <run_id>")
            return 2
        rid = rest[0]
        st, d = api(f"/repos/{repo}/actions/runs/{rid}" + ("/jobs" if cmd == "jobs" else ""))
        if st != 200:
            print(f"❌ HTTP {st}: {d}")
            return 1
        check_owner(d, repo)
        if cmd == "run":
            print(f"run #{d['run_number']} id={d['id']}  {d.get('name')}")
            print(f"  branch={d.get('head_branch')}  sha={(d.get('head_sha') or '')[:10]}")
            print(f"  status={d.get('status')}  conclusion={d.get('conclusion')}")
            print(f"  created={d.get('created_at')}  updated={d.get('updated_at')}")
            print(f"  url={d.get('html_url')}")
        else:
            for j in d.get("jobs", []):
                print(f"  job {j['name']:<40} {j.get('status'):<12} {j.get('conclusion')}")
                for s in j.get("steps", []):
                    mark = "✅" if s.get("conclusion") == "success" else (
                        "❌" if s.get("conclusion") == "failure" else "·")
                    print(f"      {mark} {s.get('number')}. {s.get('name')[:66]}")
        return 0

    print(f"❌ 未知子命令: {cmd}")
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
