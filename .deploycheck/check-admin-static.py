#!/usr/bin/env python3
"""管理台页面 `admin/index.html` 的静态检查（设计规范 §10.5 第 1 步）。

只证明"语法与令牌对得上"，**不证明界面对** —— 渲染与目视审查在 Playwright 那一步做。

检查项（每条都对应规范里的一次真实事故）：
  1. `<script>` 的 JS 语法（交给 node --check）
  2. **令牌闭环**：`var(--x)` 引用的每个令牌都必须在 `:root` 里定义过
     （§10.2 真实事故：删掉 --toolbar-h 后组件仍在引用，声明静默失效、构建不报错）
  3. **反向**：定义了但零引用的令牌 —— 也报出来（规范禁止"定义了但零引用"）
  4. `<style>` 块里的颜色字面量必须只出现在 `:root` 内（§0 铁律 1 / §10.1）
  5. `<style>` 块里的裸 px 只允许豁免清单（发丝线 0.5px / clamp·minmax 极值 / 图标自身）
  6. 禁用原生 `alert()` / `confirm()` / `prompt()`（§7.7）
  7. 交互元素必须能点：`<div onclick` / `<span onclick` 一律报错（§9）
  8. 标签配对（div/section/dialog/main/header/dl 等）
  9. **`hidden` 属性的「假隐藏」陷阱**：只要用了 hidden 属性，就必须有一条
     `[hidden] { display: none !important }` 兜底。因为 `.gate { display: grid }` 这类
     「带 display 的类」与 UA 的 `[hidden]{display:none}` **同权重**却在作者表里 ⇒ 压掉它，
     于是 `el.hidden = true` 只改属性、元素照样画出来（本页首版真事：令牌门叠在仪表盘上），
     而所有「查 el.hidden」的断言依然全绿。
 10. **class 闭环**：HTML/JS 用到的每个 class 都必须在 `<style>` 里定义过
     （`.sr-only` 从未定义时页面不报错，只是"以为隐藏了、其实显示着"—— 本页首版真实事故）
     反向的"定义了但零引用"同样报错，但豁免 JS `classList.*` 动态切换的类名

用法：python .deploycheck/check-admin-static.py
退出码 0 = 全绿。
"""

import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "admin", "index.html")
NODE = r"C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

fails = []
warns = []
passes = 0


def ok(name, cond, detail=""):
    global passes
    if cond:
        passes += 1
        print(f"  \u2705 {name}")
    else:
        fails.append(name)
        print(f"  \u274c {name}  {detail}")


def warn(name, detail):
    warns.append(name)
    print(f"  \u26a0\ufe0f  {name}  {detail}")


src = open(PAGE, encoding="utf-8").read()
style_blocks = re.findall(r"<style[^>]*>(.*?)</style>", src, re.S)
script_blocks = re.findall(r"<script[^>]*>(.*?)</script>", src, re.S)
css = "\n".join(style_blocks)
js = "\n".join(script_blocks)
# 注释里出现的 `var(--x)` / `.cls` / `16px` 都是说明文字，不是声明。
# 不剥掉就会误报（本脚本在 class 检查上首跑就栽在这）。所有静态扫描统一走 css_nc。
css_nc = re.sub(r"/\*.*?\*/", "", css, flags=re.S)

print(f"页面: {PAGE}  ({len(src)} 字节 / CSS {len(css)} / JS {len(js)})")

# ---------------- 1. JS 语法 ----------------
print("\n[1] JS 语法（node --check）")
if os.path.exists(NODE):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
        fh.write(js)
        tmp = fh.name
    r = subprocess.run([NODE, "--check", tmp], capture_output=True, text=True, encoding="utf-8")
    os.unlink(tmp)
    ok("JS 语法通过", r.returncode == 0, (r.stderr or "")[:400])
else:
    warn("node 不存在，跳过 JS 语法检查", NODE)

# ---------------- 2. 令牌：引用 -> 定义 ----------------
print("\n[2] 令牌闭环")
roots = re.findall(r":root\s*\{(.*?)\}", css_nc, re.S)
defined = set()
for block in roots:
    defined.update(re.findall(r"(--[a-z0-9-]+)\s*:", block))
referenced = set(re.findall(r"var\(\s*(--[a-z0-9-]+)", css_nc))
referenced_js = set(re.findall(r"var\(\s*(--[a-z0-9-]+)", js))

missing = sorted((referenced | referenced_js) - defined)
ok(f"所有 var(--*) 都已定义（定义 {len(defined)} 个 / 引用 {len(referenced)} 个）",
   not missing, "未定义: " + ", ".join(missing))

# ---------------- 3. 令牌：定义 -> 引用 ----------------
# 这条只做**提示**不判失败：字号刻度/层级这类"整套刻度"是规范 §3.1/§5.3 要求照抄的，
# 本页用不到的那几级属于刻度完整性，不该为了讨好一个检查而删掉（删了下次要用又得加回来）。
unused = sorted(defined - referenced - referenced_js)
if unused:
    warn(f"有 {len(unused)} 个令牌定义了但本页零引用（刻度完整性，非缺陷）",
         ", ".join(unused))
else:
    ok("没有'定义了但零引用'的令牌", True)

# ---------------- 4. 颜色字面量只在 :root 内 ----------------
print("\n[3] 颜色字面量 / 裸 px")
outside = css_nc
for block in roots:
    outside = outside.replace(block, "", 1)
# 注释里的 "16px" 之类是说明文字，不是声明 —— 不剥掉就会误报（本脚本第一次跑就栽在这）
outside = re.sub(r"/\*.*?\*/", "", outside, flags=re.S)
hexes = re.findall(r"#[0-9a-fA-F]{3,8}\b", outside)
ok(":root 之外没有十六进制颜色", not hexes, "命中: " + ", ".join(sorted(set(hexes))))
# rgb()/hsl() 也不该出现在 :root 之外（rgba 允许在 :root 内；外面同样不该有）
funcs = re.findall(r"\b(?:rgb|hsl)a?\(", outside)
ok(":root 之外没有 rgb()/hsl() 颜色", not funcs, f"命中 {len(funcs)} 处")

# 裸 px 豁免（规范 §10.4 + §8.2）：0 / 发丝线 .5px / 边框 1–2px / clamp()·minmax() 的极值 /
# @media 断点（§8.2 明确"只允许两个断点"，768/767 是规范自己定的值，不算硬编码）
# ⚠️ 正则必须用 (?<![\w.-]) —— 否则 `.5px` 会被从 `5px` 处匹配，把发丝线误报成裸 px。
px_hits = []
lines = outside.splitlines()
for m in re.finditer(r"(?<![\w.-])(\d+(?:\.\d+)?)px", outside):
    val, start = m.group(1), m.start()
    line_no = outside[:start].count("\n") + 1
    line_txt = lines[line_no - 1] if line_no - 1 < len(lines) else ""
    ctx = outside[max(0, start - 80):start + 30]
    if val in ("0", "0.5", "1", "2"):
        continue
    if "clamp(" in ctx or "minmax(" in ctx:
        continue
    if "@media" in line_txt:
        continue
    px_hits.append((line_no, val, line_txt.strip()[:60]))
ok("裸 px 只有豁免清单内的值", not px_hits,
   "; ".join(f"L{l}:{v}px[{t}]" for l, v, t in px_hits[:8]))

# ---------------- 5. 禁用原生弹窗 ----------------
print("\n[4] 交互与无障碍")
bad_dialog = re.findall(r"\b(?:window\.)?(alert|confirm|prompt)\s*\(", js)
ok("没有原生 alert/confirm/prompt", not bad_dialog, "命中: " + ", ".join(set(bad_dialog)))

onclick_div = re.findall(r"<(div|span|li|td|tr)[^>]*\sonclick=", src, re.I)
ok("可点击元素都是 <button>（没有 div/span + onclick）", not onclick_div,
   "命中: " + ", ".join(set(onclick_div)))

# 图标按钮必须有 aria-label
icon_btns = re.findall(r"<button[^>]*>\s*(?:<svg|&#215;|×)\s*</button>", src)
ok("图标按钮都有文字或 aria-label", all("aria-label" in b for b in icon_btns),
   f"{len(icon_btns)} 个图标按钮")

# ---------------- 6. 标签配对 ----------------
print("\n[5] 标签配对")
for tag in ("div", "section", "dialog", "main", "header", "dl", "dt", "dd", "table",
            "thead", "tbody", "tr", "td", "th", "button", "p", "span"):
    opened = len(re.findall(rf"<{tag}(?:\s|>)", src))
    closed = len(re.findall(rf"</{tag}>", src))
    ok(f"<{tag}> 配对 {opened}/{closed}", opened == closed, f"差 {opened - closed}")

# ---------------- 6. class 闭环 ----------------
# 第 2 组查的是「令牌引用了但没定义」；class 有**一模一样**的失效模式，
# 且更隐蔽：`.sr-only` 从未定义时，页面不会报错，只是「你以为隐藏了、其实明晃晃显示着」。
# 本页第一版就带着这个缺陷（`<th><span class="sr-only">操作</span></th>`）。
print("\n[6] class 闭环")
# ⚠️ 必须先剥掉 CSS 注释再扫类名 —— 否则注释里写的 `.deploycheck/check-contrast.py`
#    会被当成两个类名（`deploycheck` / `py`）而误报"定义了但零引用"（本检查首跑就栽在这）。
all_css_blocks = re.sub(r"/\*.*?\*/", "", "\n".join(style_blocks), flags=re.S)
cls_defined = set(re.findall(r"\.([A-Za-z_][\w-]*)", all_css_blocks))
body_html = re.sub(r"<script[^>]*>.*?</script>", "",
                   re.sub(r"<style[^>]*>.*?</style>", "", src, flags=re.S), flags=re.S)
cls_used = set()
for m in re.finditer(r'class="([^"]+)"', body_html + js):
    cls_used.update(m.group(1).split())
# JS 里 classList.* 动态切换的类名，静态 HTML 里看不到（例如 #toast 的 `show`）
cls_dynamic = set(re.findall(r"classList\.(?:add|remove|toggle)\(\s*[\"']([\w-]+)", js))
cls_undef = sorted(cls_used - cls_defined)
ok(f"用到的 class 都在 <style> 里定义过（用 {len(cls_used)} / 定义 {len(cls_defined)}）",
   not cls_undef, "未定义: " + ", ".join(cls_undef))
cls_unused = sorted(cls_defined - cls_used - cls_dynamic)
ok("没有'定义了但零引用'的 class", not cls_unused,
   "零引用: " + ", ".join(cls_unused))

# ---------------- 7. hidden 属性的"假隐藏"陷阱 ----------------
# 真实事故（本页首版）：`.gate{display:grid}` 与 UA 的 `[hidden]{display:none}` **同权重 (0,1,0)**，
# 但作者表压过 UA 表 ⇒ `el.hidden = true` 只改属性、元素**照样整块画出来**，
# 令牌门实实在在叠在了仪表盘上面，而所有"查 el.hidden"的断言依然全绿。
# 只要页面用到了 hidden 属性，就必须有一条 `[hidden]{display:none !important}` 兜底。
print("\n[7] hidden 属性的假隐藏陷阱")
hidden_html = len(re.findall(r"<[a-z][^>]*\shidden(?=[\s/>])", body_html, re.I))
hidden_js = len(re.findall(r"\.hidden\s*=\s*(?:true|false)", js))
uses_hidden = hidden_html + hidden_js
has_reset = bool(re.search(r"\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important", all_css_blocks))
if uses_hidden:
    ok(
        f"用到了 hidden 属性（HTML {hidden_html} 处 / JS {hidden_js} 处），"
        f"且有 [hidden]{{display:none !important}} 兜底",
        has_reset,
        "缺少兜底规则 ⇒ 带 display 的类会压掉 UA 的 display:none，元素'假隐藏'",
    )
else:
    ok("页面未使用 hidden 属性（无需兜底规则）", True)

# ---------------- 汇总 ----------------
print(f"\n===== 静态检查: {passes} 通过 / {len(fails)} 失败 / {len(warns)} 提示 =====")
if fails:
    print("失败项:")
    for f in fails:
        print("  - " + f)
sys.exit(1 if fails else 0)
