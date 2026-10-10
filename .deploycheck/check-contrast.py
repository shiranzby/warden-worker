#!/usr/bin/env python3
"""管理台 `admin/index.html` 的对比度硬指标校验（设计规范 §2.3）。

规范原文：正文（< 18px）**4.5:1**，'包含次要文字'；大字（≥18px 或 ≥14px 加粗）3:1；
非文字 UI（图标/边框）3:1。并明确写着「不要靠眼睛估，写完立刻用脚本算」。

为什么必须有这个脚本：
  本页第一版直接照抄了 iOS 的灰阶（`--label-2: .62` / `--label-3: .38`），
  实算出来只有 **3.62:1 / 2.05:1** —— 全站次要文字（12–15px 全是次要文字）**全线不达标**。
  肉眼看不出来（浅灰在白底上"看着挺正常"），只有算出来才知道。
  同批还改了：`--success` 3.92→4.81、深色 `--danger` 4.05→4.61、
  并引入 `--brand-text`（`--brand` 在浅淡底上只有 3.15:1，不能当文字色）。

用法：python .deploycheck/check-contrast.py
退出码 0 = 全绿。
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "admin", "index.html")

# ---------------------------------------------------------------- 颜色工具


def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    r, g, b = (_lin(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def parse_color(raw):
    """`#rrggbb` / `#rgb` / `rgba(r,g,b,a)` / `rgb(...)` → (r,g,b,a)。"""
    s = raw.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", s)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    m = re.fullmatch(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)", s)
    if m:
        r, g, b = (float(m.group(i)) for i in (1, 2, 3))
        a = float(m.group(4)) if m.group(4) is not None else 1.0
        return (r, g, b, a)
    raise ValueError(f"无法解析颜色: {raw!r}")


def over(fg, bg):
    """把可能带 alpha 的 fg 叠到不透明 bg 上。"""
    r, g, b, a = fg
    return tuple(fg[i] * a + bg[i] * (1 - a) for i in range(3)) + (1.0,)


# ---------------------------------------------------------------- 读令牌

src = open(PAGE, encoding="utf-8").read()
styles = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", src, re.S))

# 浅色 = 文件里第一个 `:root`；深色 = `@media (prefers-color-scheme: dark)` 里那个
dark_match = re.search(r"@media\s*\(prefers-color-scheme:\s*dark\)\s*\{.*?:root\s*\{(.*?)\}",
                       styles, re.S)
dark_block = dark_match.group(1) if dark_match else ""
light_block = re.search(r":root\s*\{(.*?)\}", re.sub(
    r"@media\s*\(prefers-color-scheme:\s*dark\)\s*\{.*?:root\s*\{.*?\}\s*\}",
    "", styles, flags=re.S), re.S).group(1)


def decls(block):
    out = {}
    for m in re.finditer(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", block):
        raw = m.group(2).strip()
        # 去掉颜色后面的行内注释
        raw = re.sub(r"/\*.*?\*/", "", raw).strip()
        try:
            out[m.group(1)] = parse_color(raw)
        except ValueError:
            pass  # 非颜色令牌（--fs-* / --s* / --dur-* …）直接跳过
    return out


LIGHT = decls(light_block)
DARK = dict(LIGHT)
DARK.update(decls(dark_block))

# ---------------------------------------------------------------- 判据表
# (名称, 前景令牌, 由下到上的背景层, 字号px, 是否加粗, 需要的比值)
# 背景层的**最底层必须不透明**；上层带 alpha 会按 alpha 合成。
PAIRS = [
    # ---------------- 浅色 ----------------
    ("浅/卡片正文次要 label-2 于卡片", "--label-2", ["--bg-2"], 12, False, 4.5),
    ("浅/页面底次要 label-2 于页面", "--label-2", ["--bg"], 12, False, 4.5),
    ("浅/表格头 thead th", "--label-2", ["--bg-2"], 12, False, 4.5),
    ("浅/徽章默认底 fill-3 上的 label-2", "--label-2", ["--bg-2", "--fill-3"], 12, False, 4.5),
    ("浅/输入框正文 label 于 bg-3", "--label", ["--bg-3"], 16, False, 4.5),
    ("浅/次级按钮 btn-tinted 文字", "--label", ["--bg-2", "--fill-3"], 16, True, 4.5),
    ("浅/纯文字按钮 btn-plain（链接色, 16px/600）", "--brand", ["--bg-2"], 16, True, 3.0),
    ("浅/徽章 已开启（brand-soft 底）", "--brand-text", ["--bg-2", "--brand-soft"], 12, True, 4.5),
    ("浅/徽章 正常（ok-soft 底）", "--success", ["--bg-2", "--ok-soft"], 12, True, 4.5),
    ("浅/徽章 即将到期（warn-soft 底）", "--warn", ["--bg-2", "--warn-soft"], 12, True, 4.5),
    ("浅/徽章 已停用（danger-soft 底）", "--danger", ["--bg-2", "--danger-soft"], 12, True, 4.5),
    ("浅/错误文案 .err 于卡片", "--danger", ["--bg-2"], 13, False, 4.5),
    ("浅/实心按钮白字", "--on-brand", ["--brand-solid"], 16, True, 4.5),
    ("浅/危险按钮白字", "--on-brand", ["--danger-solid"], 16, True, 4.5),
    ("浅/Toast 默认（反色）", "--bg-2", ["--label"], 15, False, 4.5),
    # ---------------- 深色 ----------------
    ("深/卡片正文次要 label-2 于卡片", "--label-2", ["--bg-2"], 12, False, 4.5),
    ("深/页面底次要 label-2 于页面", "--label-2", ["--bg"], 12, False, 4.5),
    ("深/徽章默认底 fill-3 上的 label-2", "--label-2", ["--bg-2", "--fill-3"], 12, False, 4.5),
    ("深/输入框正文 label 于 bg-3", "--label", ["--bg-3"], 16, False, 4.5),
    ("深/次级按钮 btn-tinted 文字", "--label", ["--bg-2", "--fill-3"], 16, True, 4.5),
    ("深/纯文字按钮 btn-plain（链接色, 16px/600）", "--brand", ["--bg-2"], 16, True, 3.0),
    ("深/徽章 已开启（brand-soft 底）", "--brand-text", ["--bg-2", "--brand-soft"], 12, True, 4.5),
    ("深/徽章 正常（ok-soft 底）", "--success", ["--bg-2", "--ok-soft"], 12, True, 4.5),
    ("深/徽章 即将到期（warn-soft 底）", "--warn", ["--bg-2", "--warn-soft"], 12, True, 4.5),
    ("深/徽章 已停用（danger-soft 底）", "--danger", ["--bg-2", "--danger-soft"], 12, True, 4.5),
    ("深/错误文案 .err 于卡片", "--danger", ["--bg-2"], 13, False, 4.5),
    ("深/实心按钮白字（16px/600 → 大字 3:1）", "--on-brand", ["--brand-solid"], 16, True, 3.0),
    ("深/危险按钮白字", "--on-brand", ["--danger-solid"], 16, True, 4.5),
    ("深/Toast 默认（反色）", "--bg-2", ["--label"], 15, False, 4.5),
    # ---------------- 非文字（图标 / 描边）只需 3:1 ----------------
    ("浅/空状态图标（非文字）", "--label-3", ["--bg-2"], 40, False, 3.0),
    ("深/空状态图标（非文字）", "--label-3", ["--bg-2"], 40, False, 3.0),
    ("浅/输入框描边 brand（非文字）", "--brand", ["--bg-3"], 0, False, 3.0),
    ("深/输入框描边 brand（非文字）", "--brand", ["--bg-3"], 0, False, 3.0),
]

print(f"页面: {PAGE}")
print(f"浅色令牌 {len(LIGHT)} 个 / 深色覆盖 {len(decls(dark_block))} 个\n")

fails = []
warns = []
for name, fg_tok, layers, size, bold, need in PAIRS:
    theme = DARK if name.startswith("深/") else LIGHT
    if fg_tok not in theme:
        fails.append(f"{name}: 前景令牌 {fg_tok} 未定义")
        print(f"  \u274c {name}  前景 {fg_tok} 未定义")
        continue
    bg = None
    missing = None
    for tok in layers:  # 由下到上合成
        if tok not in theme:
            missing = tok
            break
        bg = theme[tok] if bg is None else over(theme[tok], bg)
    if missing or bg is None:
        fails.append(f"{name}: 背景令牌 {missing} 未定义")
        print(f"  \u274c {name}  背景 {missing} 未定义")
        continue
    fg = over(theme[fg_tok], bg)  # 前景自身可能带 alpha（如 label-2）
    r = ratio(fg[:3], bg[:3])
    okflag = r >= need
    mark = "\u2705" if okflag else "\u274c"
    note = "" if okflag else f"  需要 {need}:1"
    if okflag and r < need + 0.25 and need == 4.5:
        note = "  （余量 < 0.25，接近下限）"
        warns.append(name)
    print(f"  {mark} {r:5.2f} (需 {need}:1)  {name}{note}")
    if not okflag:
        fails.append(name)

print(f"\n===== 对比度: {len(PAIRS) - len(fails)} 通过 / {len(fails)} 失败 "
      f"/ {len(warns)} 接近下限 =====")
if fails:
    print("失败项:")
    for f in fails:
        print("  - " + f)
sys.exit(1 if fails else 0)
