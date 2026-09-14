"""第十五批(S 段)负向守卫的**离线证伪** —— 每条"该只在窄屏生效"的规则都被故意提成顶格,
确认 CI 那段守卫真的会报错(而不是一颗哑弹)。

为什么必须单独跑一次:
  第十四批已经踩过一模一样的坑 —— 第一版守卫漏抄了一个词(真实的 `header`), 于是永远不匹配,
  把规则从 @media 里提成顶格它**照样通过**。所以"守卫写了"不等于"守卫有效", 唯一可靠的证明
  是: 故意制造违规 → 看它报错。

做法(完全复用 CI 的那段脚本, 不另写一份判据):
  ① 用 `.artcheck/` 里那份**已按 CI 布局打包**的真产物(顶层 web-vault/ + vw-version.json);
  ② 逐条把目标选择器所在行**去掉前导缩进**(= 从 @media 内提到顶格), 重打包;
  ③ 跑从 workflow 抽出的断言脚本, 要求 exit=1 **且** stderr 出现该条的守卫文案;
  ④ 最后用原样 CSS 再跑一次, 要求 exit=0(证伪不能靠"本来就红")。

用法: python .deploycheck/probe-s15-guard.py
"""
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile

DC = pathlib.Path(__file__).resolve().parent
WF = DC.parent / ".github/workflows/build-web-vault.yaml"
WORK = DC / ".artcheck"
STAGING = WORK / "web-vault"
CSS = STAGING / "css/vaultwarden.css"
TAR = WORK / "bw_web_vault.tar.gz"

# 必须受守卫的三条(与 S_CSS_LITS 里"参与守卫"的部分一字不差)
GUARDED_S = [
    "main#main-content h1.warden-auth-title",
    "main#main-content app-header.warden-bare-header bit-header",
    "main#main-content bit-form-field textarea[bitInput]",
]
# 上一批(第十四批/R 段)同样"只在窄屏生效"的六条 —— 顺手一起证伪(同一套判据, 之前没留证伪记录)
GUARDED_R = [
    r"main#main-content .tw-mb-2.tw-pb-2\.5",
    "main#main-content .tw-grid.tw-gap-16",
    "main#main-content bit-search form:focus-within",
    "main#main-content bit-form-field div:has(> textarea)",
    "main#main-content app-header header product-switcher",
    "main#main-content app-header tools-new-send-dropdown",
]
GUARDED = [("S", lit) for lit in GUARDED_S] + [("R", lit) for lit in GUARDED_R]
# 刻意全局的两条 —— 提成顶格**不该**报错(证伪的对照组)
GLOBAL_BY_DESIGN = [".warden-totp-next", "@keyframes warden-totp-promote"]


def extract_script() -> str:
    txt = WF.read_text(encoding="utf-8")
    a = txt.index("Verify our customizations are in the built artifact")
    b = txt.index("\n      - name:", a)
    lines = txt[a:b].splitlines()
    i = next(k for k, l in enumerate(lines) if l.strip().startswith("run:"))
    body = lines[i + 1 :]
    ind = min(len(l) - len(l.lstrip()) for l in body if l.strip())
    return "\n".join(l[ind:] if l.strip() else "" for l in body)


def repack(css_text: str) -> None:
    # ⚠️ 必须用 newline="" 原样写回: 默认的 text 模式会把 `\n` 翻成 `\r\n`, 整份 CSS 膨胀
    #    两千多字节(实测 91007 → 93069), 那就不再是"同一个产物", 证伪的结论会被污染。
    with open(CSS, "w", encoding="utf-8", newline="") as fh:
        fh.write(css_text)
    with tarfile.open(TAR, "w:gz") as tf:
        tf.add(STAGING, arcname="web-vault")


def run_asserts() -> subprocess.CompletedProcess:
    """把断言脚本**落成文件**再跑 —— 与 CI 的实际形态一致。

    🔴 别改成 `bash -c "<29KB 的多行字符串>"`: 本机 MSYS 版 bash 收这么长的 -c 参数会被**截断**,
       脚本跑到一半就结束、`fail` 还是 0 ⇒ 退出码 0 —— 表现为"守卫是哑弹", 而其实压根没执行到。
       踩过一次: 三条守卫全部"被抓住=False", 直跑同一个文件却是 exit=1 + 正确文案。
    """
    script_file = WORK / ".asserts.sh"
    script_file.write_text(extract_script(), encoding="utf-8", newline="")
    return subprocess.run(
        ["bash", script_file.name], cwd=WORK, capture_output=True, text=True
    )


def main() -> int:
    original = CSS.read_text(encoding="utf-8")
    bad = 0

    # 0) 基线: 原样必须绿
    repack(original)
    r = run_asserts()
    print(f"[基线] exit={r.returncode}  (期望 0)")
    if r.returncode != 0:
        print((r.stdout or "")[-2000:])
        print((r.stderr or "")[-2000:])
        bad += 1

    # 1) 每条受守卫的规则 → 提成顶格 → 必须报错
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only:
        print(f"（只跑含 '{only}' 的条目）")
    for batch, lit in GUARDED:
        if only and only not in lit:
            continue
        # ⚠️ 结尾**不能**只认 `{`: CSS 里有多行选择器列表(如
        #    `main#main-content bit-search form:focus-within,` 换行后才跟另一条 + `{`),
        #    只认 `{` 会定位不到 → 探针误报"证伪前提不成立", 而 CI 的判据其实是对的。
        pat = re.compile(r"^[ \t]+(" + re.escape(lit) + r")([ \t]*[,{]|[ \t]*$)", re.M)
        hits = pat.findall(original)
        if len(hits) != 1:
            print(f"❌ [{batch}][{lit}] 在 CSS 里带缩进的命中 {len(hits)} 处(期望 1) —— 证伪前提不成立")
            bad += 1
            continue
        tampered = pat.sub(lambda m: m.group(1) + m.group(2), original)
        repack(tampered)
        r = run_asserts()
        caught = r.returncode == 1 and "存在顶格(全局)写法" in (r.stderr or "") and lit in (r.stderr or "")
        print(
            f"[提成顶格][{batch}] {lit}\n           exit={r.returncode} 被抓住={caught}  (期望 exit=1 且文案命中)"
        )
        if not caught:
            print("           stderr:", (r.stderr or "").strip()[-300:])
            bad += 1

    # 2) 对照组: 刻意全局的规则提成顶格 → **不该**因它报错
    for lit in GLOBAL_BY_DESIGN:
        pat = re.compile(r"^[ \t]+(" + re.escape(lit) + r")\s*\{", re.M)
        if not pat.search(original):
            # 它本来就是顶格 —— 直接原样跑一次即可, 断言"原样绿"已在基线里证明
            print(f"[对照组] {lit}: 本就是顶格(不作守卫), 跳过")
            continue
        tampered = pat.sub(lambda m: m.group(1) + " {", original)
        repack(tampered)
        r = run_asserts()
        okc = r.returncode == 0
        print(f"[对照组] {lit}: exit={r.returncode}  (期望 0 —— 它刻意全局)")
        if not okc:
            print("           stderr:", (r.stderr or "").strip()[-300:])
            bad += 1

    # 3) 还原
    repack(original)
    print(f"\n{'✅ 守卫证伪全部符合预期' if bad == 0 else f'❌ {bad} 项不符合预期'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
