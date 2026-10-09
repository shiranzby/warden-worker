"""离线证伪: 把 AA 段(第二十二批)的两处改动逐条"改回去", 确认 CI 断言真的会报错。

为什么要做(仓库纪律): 一条"永远为真"的守卫等于没有守卫。
  · 第十四批写过一个纯哑弹(`grep -qE '^main#main-content app-header product-switcher'`
    —— 漏抄了真实的 `header` 一词, 永远不匹配);
  · 第十六批证伪脚本自己出错时把好断言判成坏的(替换串仍以原串为前缀 ⇒ grep -F 照样命中);
  · 第二十二批尤其要点: 负向判据 `bit-dialog textarea[formcontrolname=` 与**正向**判据
    `…:has(tools-send-form) textarea[formcontrolname=…` 只差一个 `:has(...)`,
    很容易写成互相假命中 —— 所以每条都单独验一次。

做法: 拿刚构建好的产物 tar, 按 CI 布局解包 → 只改一处 → 重新打包 → 跑断言脚本
(脚本从 workflow 里现抽, 与 CI 同源) → 看是否命中**预期的那条**报错。

用法: python .deploycheck/falsify-aa22.py
"""
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile

DC = pathlib.Path(__file__).resolve().parent
ROOT = DC.parent
WF = ROOT / ".github/workflows/build-web-vault.yaml"
GOOD = DC / ".artcheck" / "bw_web_vault.tar.gz"
MANIFEST = DC / ".artcheck" / ".vault-contents.txt"
WORKROOT = DC / ".falsify-aa22"

if not GOOD.exists():
    sys.exit(f"先跑 run-artifact-asserts.py 生成 {GOOD}")

# ---- 抽断言脚本(与 CI 同源) ----
txt = WF.read_text(encoding="utf-8")
a = txt.index("Verify our customizations are in the built artifact")
b = txt.index("\n      - name:", a)
lines = txt[a:b].splitlines()
i = next(k for k, l in enumerate(lines) if l.strip().startswith("run:"))
body = lines[i + 1:]
ind = min(len(l) - len(l.lstrip()) for l in body if l.strip())
script = "\n".join(l[ind:] if l.strip() else "" for l in body)

# 成功横幅里的项数**从 workflow 现读**, 不手抄(第十六批的 falsify 手抄成"二十四项",
# 后续批次一升就永远对不上, 对照组的假红把好断言一起带偏)。
m = re.search(r'echo "✅ (\S+?)项源码级定制', script)
if not m:
    sys.exit("抽不到成功横幅, 断言脚本结构变了")
BANNER = f"{m.group(1)}项源码级定制"
print(f"OK  断言脚本 {len(script)} 字节, 成功横幅 = {BANNER}")

SEL_NOTES_NEW = 'bit-dialog:has(tools-send-form) textarea[formcontrolname="notes"]'
SEL_TEXT_NEW = 'bit-dialog:has(tools-send-form) textarea[formcontrolname="text"]'
SEL_NOTES_BARE = 'bit-dialog textarea[formcontrolname="notes"]'
SEL_TEXT_BARE = 'bit-dialog textarea[formcontrolname="text"]'
K4_MINH = "min-height: 54px !important;"


def css_of(vault: pathlib.Path) -> pathlib.Path:
    return vault / "css" / "vaultwarden.css"


def sub(vault: pathlib.Path, old: str, new: str, count: int = 1):
    f = css_of(vault)
    s = f.read_text(encoding="utf-8")
    if old not in s:
        raise SystemExit(f"证伪脚本自身失效: 产物里找不到 {old!r}")
    f.write_text(s.replace(old, new, count), encoding="utf-8")


def build_variant(name: str, mutate) -> pathlib.Path:
    d = WORKROOT / name
    if d.exists():
        shutil.rmtree(d)
    with tarfile.open(GOOD, "r:gz") as tf:
        tf.extractall(d)
    mutate(d / "web-vault")
    shutil.copy(MANIFEST, d / ".vault-contents.txt")
    (d / ".assert.sh").write_text(script, encoding="utf-8")
    out = d / "bw_web_vault.tar.gz"
    with tarfile.open(out, "w:gz") as tf:
        tf.add(d / "web-vault", arcname="web-vault")
    return d


def run(d: pathlib.Path):
    r = subprocess.run(["bash", ".assert.sh"], cwd=d, capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


CASES = []


def case(name, expect):
    """expect = None 表示对照组(必须全绿); 否则是**必须全部命中**的报错子串列表。"""

    def deco(fn):
        CASES.append((name, expect, fn))
        return fn

    return deco


# ① X2 对「备注」的收窄被改回裸写法 —— 正向(AA)与负向①必须同时报警
@case(
    "X2 的 notes 选择器改回裸写法",
    ["找不到第二十二批的标记", "仍有未收窄的 'bit-dialog textarea[formcontrolname=…]'"],
)
def _(vault: pathlib.Path):
    sub(vault, SEL_NOTES_NEW, SEL_NOTES_BARE)


# ② X2 对「要分享的文本」的收窄被改回裸写法
#    —— 本批同时改了 U 段与 X 段两处**硬编码字面量**, 这里专门证明它们真的盯着 CSS
@case(
    "X2 的 text 选择器改回裸写法",
    ["找不到第十七批的标记", "找不到第二十批的标记"],
)
def _(vault: pathlib.Path):
    sub(vault, SEL_TEXT_NEW, SEL_TEXT_BARE)


# ③ K4 又把 height 钉死(负向②) —— 注意**保留** min-height, 只加回 height, 单独验这条
@case(
    "K4 又钉死 height: 54px",
    ["K4 仍在钉死 height: 54px"],
)
def _(vault: pathlib.Path):
    sub(vault, K4_MINH, f"height: 54px !important;\n    {K4_MINH}")


# ④ K4 的 min-height 兜底被整个删掉 —— 正向(AA)必须报警
@case(
    "K4 的 min-height 兜底被删",
    ["找不到第二十二批的标记 'min-height: 54px !important'"],
)
def _(vault: pathlib.Path):
    sub(vault, K4_MINH, "")


# ⑤ 对照组: 不改任何东西, 必须全绿(证明上面的红确实来自那一处改动)
@case("对照组: 原样", None)
def _(vault: pathlib.Path):
    pass


print(f"解包基准: {GOOD}  ({GOOD.stat().st_size/1048576:.1f} MB)\n")
ok = 0
bad = 0
for name, expect, fn in CASES:
    d = build_variant(re.sub(r"[^A-Za-z0-9]+", "-", name), fn)
    code, out = run(d)
    if expect is None:
        good = code == 0 and BANNER in out
        print(f"{'✅' if good else '❌'} 对照组: exit={code} (期望 0 且打印 '{BANNER}')")
        if not good:
            print("    " + " | ".join(out.splitlines()[-4:]))
        ok += good
        bad += not good
        continue
    missing = [e for e in expect if e not in out]
    good = (code != 0) and not missing
    print(f"{'✅' if good else '❌'} {name}: exit={code} (期望非 0), 未命中={missing or '无'}")
    if not good:
        tail = [l for l in out.splitlines() if l.startswith("❌")] or out.splitlines()[-6:]
        print("    实际输出尾部: " + " | ".join(tail[:4]))
    ok += good
    bad += not good

print(f"\n===== 证伪合计: {ok} 通过 / {bad} 失败 =====")
sys.exit(0 if bad == 0 else 1)
