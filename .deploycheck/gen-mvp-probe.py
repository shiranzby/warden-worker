"""把 probe-x20-verify.mjs 派生出一份「线上 MVP 验收」脚本。

为什么用脚本生成而不是手抄：两者 95% 相同，手抄必然各自修一半。
这里只做两处外科手术式改动：
  ① 截图目录 x20-* -> mvp-live-*（不覆盖历史取证）
  ② 在收尾统计前插入 mvp-block.js（设计系统是否真作用到该域）
"""
import pathlib

here = pathlib.Path(__file__).resolve().parent
src = (here / "probe-x20-verify.mjs").read_text(encoding="utf-8")
block = (here / "mvp-block.js").read_text(encoding="utf-8")

src = src.replace("x20-${W}x${H}", "mvp-live-${W}x${H}")
assert "mvp-live-" in src, "OUT 替换失败"

lines = src.splitlines(keepends=True)
idx = next(i for i, l in enumerate(lines) if "pageerrors:" in l)
lines.insert(idx, block)
out = "".join(lines)

(here / "probe-mvp-live.mjs").write_text(out, encoding="utf-8", newline="\n")
print("probe-mvp-live.mjs 行数 =", out.count("\n") + 1)
print("插入位置: 第", idx + 1, "行之前 ->", lines[idx].strip()[:50])
