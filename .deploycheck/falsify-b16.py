"""离线证伪: 故意把 T 段的三处改动"改回去", 确认 CI 断言真的会报错。

为什么必须做(仓库里已写进纪律): 一条"永远为真"的守卫等于没有守卫。
第十四批就写过一个纯哑弹(`grep -qE '^main#main-content app-header product-switcher'`
—— 漏抄了真实的 `header` 一词, 永远不匹配, 把规则提成全局也拦不住)。
所以每批加守卫都要离线证伪一次, 确认它在"改动被弄丢"时真的红。

做法: 拿刚构建好的产物 tar, 按 CI 布局解包 → 只改一处 → 重新打包 → 跑断言脚本
(脚本从 workflow 里现抽, 与 CI 同源) → 看是否命中**预期的那条**报错。

用法: python .deploycheck/falsify-b16.py
"""
import json
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
WORKROOT = DC / ".falsify"

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


def build_variant(name: str, mutate) -> pathlib.Path:
    """解包 → mutate(web_vault_dir) → 与 CI 同样方式重新打包。"""
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
    r = subprocess.run(
        ["bash", ".assert.sh"], cwd=d, capture_output=True, text=True
    )
    return r.returncode, (r.stdout or "") + (r.stderr or "")


CASES = []


def case(name, expect_substring):
    def deco(fn):
        CASES.append((name, expect_substring, fn))
        return fn
    return deco


# ① T2 的规则被提成顶格(全局) —— 负向守卫 2 必须报错
@case("T2 规则提成顶格", "存在顶格(全局)写法")
def _(vault: pathlib.Path):
    css = vault / "css" / "vaultwarden.css"
    s = css.read_text(encoding="utf-8")
    s = s.replace(
        "  main#main-content .warden-domain-row {\n    align-items: flex-end !important;",
        "main#main-content .warden-domain-row {\n  align-items: flex-end !important;",
    )
    css.write_text(s, encoding="utf-8")


# ② T3 的旧判据复活 —— 负向守卫 1 必须报错
@case("T3 旧判据 Math.round 复活", "TOTP 升格动画会在换码前 0.5s 开跑")
def _(vault: pathlib.Path):
    mj = next((vault / "app").glob("main.*.js"))
    s = mj.read_text(encoding="utf-8")
    s = s.replace("Math.floor(Date.now()/1e3)", "Math.round(Date.now()/1e3)", 1)
    mj.write_text(s, encoding="utf-8")


# ③ T2 的页级钩子从模板产物里丢了 —— 正向断言必须报错
#    ⚠️ 必须**真的删掉**这个子串。第一版写成替换成 'warden-domain-rowX', 而它仍以
#       'warden-domain-row' 为前缀 ⇒ `grep -F` 照样命中, 证伪得出"断言是哑弹"的**假结论**。
#       (证伪脚本自身出错会把好断言判成坏的 —— 所以证伪也必须被复核。)
@case("warden-domain-row 从 main.js 丢失", "找不到第十六批的标记 'warden-domain-row'")
def _(vault: pathlib.Path):
    mj = next((vault / "app").glob("main.*.js"))
    s = mj.read_text(encoding="utf-8")
    s = s.replace("warden-domain-row", "")
    mj.write_text(s, encoding="utf-8")


# ④ 已退役的兄弟热点按钮又回来了 —— 负向守卫(R 段那条)必须报错
@case("已退役的 warden-select-open 复活", "又出现了已退役的 'warden-select-open'")
def _(vault: pathlib.Path):
    mj = next((vault / "app").glob("main.*.js"))
    s = mj.read_text(encoding="utf-8")
    s = s.replace("warden-totp-code", 'warden-select-open warden-totp-code', 1)
    mj.write_text(s, encoding="utf-8")


# ⑤ 对照: 不改任何东西, 必须全绿(证明失败确实来自那一处改动)
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
        good = code == 0 and "二十四项源码级定制" in out
        print(f"{'✅' if good else '❌'} 对照组: exit={code} (期望 0 且打印成功横幅)")
        ok += good
        bad += not good
        continue
    hit = expect in out
    fails = code != 0
    good = hit and fails
    print(f"{'✅' if good else '❌'} {name}: exit={code} (期望非 0), 命中预期报错={hit}")
    if not hit:
        tail = [l for l in out.splitlines() if l.startswith("❌")] or out.splitlines()[-6:]
        print("    实际输出尾部: " + " | ".join(tail[:4]))
    ok += good
    bad += not good

print(f"\n===== 证伪合计: {ok} 通过 / {bad} 失败 =====")
sys.exit(0 if bad == 0 else 1)
