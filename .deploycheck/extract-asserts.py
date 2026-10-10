#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 `build-web-vault.yaml` 里 "Verify our customizations…" 那一步的 bash 原样抽出来，
在本地产物上跑一遍 —— 这样 CI 报 FAIL 时不用等日志下载（本机拉 job 日志常被重置）。

用法:
    python .deploycheck/extract-asserts.py            # 抽到 .deploycheck/artifact-asserts.sh
    # 然后：
    #   cd <一份产物目录，需含 .main.js / .vw.css>
    #   bash <仓库根>/.deploycheck/artifact-asserts.sh
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows" / "build-web-vault.yaml"
OUT = ROOT / ".deploycheck" / "artifact-asserts.sh"
STEP = "Verify our customizations"


def main() -> int:
    lines = WF.read_text(encoding="utf-8").splitlines()

    start = None
    for i, ln in enumerate(lines):
        if STEP in ln and ln.lstrip().startswith("- name:"):
            start = i
            break
    if start is None:
        sys.exit("❌ 找不到那一步")

    end = len(lines)
    for i in range(start + 1, len(lines)):
        s = lines[i].lstrip()
        if s.startswith("- name:") or s.startswith("- uses:"):
            end = i
            break

    block = lines[start:end]
    ri = next((i for i, l in enumerate(block) if l.strip().startswith("run:")), None)
    if ri is None:
        sys.exit("❌ 那一步没有 run:")

    base_indent = len(block[ri]) - len(block[ri].lstrip()) + 2
    body = []
    for l in block[ri + 1:]:
        body.append(l[base_indent:] if len(l) > base_indent else "")

    text = "\n".join(body).rstrip() + "\n"
    OUT.write_text(text, encoding="utf-8", newline="\n")
    n_cases = len(re.findall(r"^\s*# \d+\)", text, re.M))
    print(f"✅ 已抽出 {len(body)} 行 -> {OUT.relative_to(ROOT)}")
    print(f"   编号断言组: {n_cases}")
    print(f"   含 ❌ 提示行: {text.count('❌')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
