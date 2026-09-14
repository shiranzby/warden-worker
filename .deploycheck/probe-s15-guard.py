"""负向守卫的**离线证伪** —— 每条"该只在窄屏生效"的规则都被故意提成顶格,
确认 CI 那段守卫真的会报错(而不是一颗哑弹)。

    ⚠️ 文件名里的 `s15` 是历史: 它是第十五批(S 段)时写的, 之后**逐批累加** ——
       现有 R / S / V 三批(见 GUARDED 的组装处)。改名会同时动 .gitignore 白名单与
       多处文档引用, 收益为零, 所以留着旧名, 到这里来看。

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
import fnmatch
import json
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

# 🔴 待证伪的字面量**一律从 workflow 里解析出来**, 不在这里手抄一份。
#
#   为什么必须这样(第十八批踩到的真事): 这份脚本原先把 S 段的三条**硬编码**在 GUARDED_S 里,
#   而第十六批/T 段把 S 段那条 `main#main-content bit-form-field textarea[bitInput]`
#   改成了 `main#main-content .warden-domain-row bit-form-field textarea[bitInput]`
#   (workflow 里的 `S_CSS_LITS` 同步改了, 硬编码这份没改)。于是:
#     · CI 的正向断言用的是 workflow 里那份 → 一直是对的;
#     · 这份证伪脚本用的是硬编码那份 → 从第十六批起就"命中 0 处", 报"证伪前提不成立"。
#   也就是说**证伪这层自己先失效了**, 而它失效时给出的信号还很容易被当成"探针的毛病"翻过去。
#   现在改成: 数组从 workflow 解析, 每个批次"哪些条目被守卫主动跳过"也从 workflow 的
#   `case ... continue ;;` 里解析。两侧共用同一份原文 ⇒ 结构上不可能再漂移。
#
#   ⚠️ 与"漏抄一个词"那条教训(MEMORY ④/第十四批)是**同一类错**, 只是方向相反:
#      那一次是守卫自己漏词(永远不匹配), 这一次是证伪脚本漏改(永远找不到)。
BATCHES = ["R_CSS_LITS", "S_CSS_LITS", "T_CSS_LITS", "U_CSS_LITS", "V_CSS_LITS", "W_CSS_LITS"]


def _strip_line_continuations(text: str) -> str:
    return re.sub(r"\\\n", " ", text)


def _bash_words(chunk: str) -> list[str]:
    """从一段 bash 里取出单引号字符串的字面量(自动吃掉续行反斜杠)。"""
    return re.findall(r"'([^']*)'", _strip_line_continuations(chunk))


def _parse_arrays(script: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for name in BATCHES:
        # 闭合括号紧跟在最后一个字面量后面(同一个物理行), 所以认 `)` + 行尾, 不要求它自成一行。
        # 字面量内部也可能有 `)`(如 `header:has(bit-tab-nav-bar)`), 但它们后面跟的是 `'`,
        # 不是行尾, 所以 `\)\s*\n` 不会误配。
        m = re.search(re.escape(name) + r"=\((.*?)\)[ \t]*\n", script, re.S)
        if not m:
            raise SystemExit(f"❌ 在 workflow 的断言脚本里找不到数组 {name}=(")
        out[name] = _bash_words(m.group(1))
    return out


def _parse_skip_globs(script: str, name: str) -> list[str]:
    """取出该批守卫 `for lit in "${NAME[@]}"; do ... case "${lit}" in <pat>) continue ;; esac` 里的
    跳过模式。没有 case 块 = 不跳过任何条目。"""
    m = re.search(
        r'for lit in "\$\{' + re.escape(name) + r'\[@\]\}"; do[ \t]*\n'
        r'(?:[ \t]*#[^\n]*\n)*'  # do 与 case 之间可能有注释行(V 段就是这样)
        r'[ \t]*case "\$\{lit\}" in(.*?)esac',
        script,
        re.S,
    )
    if not m:
        return []
    body = _strip_line_continuations(m.group(1))
    body = re.sub(r"continue\s*;;", "", body)
    pats: list[str] = []
    for piece in body.split("|"):
        piece = piece.strip()
        # 末条模式后面紧跟着 `)`(case 的模式终结符), 去掉它;
        # 再把 shell 的引号**全部**删掉 —— 它们是 `'html.theme_dark '*` 这种
        # "带引号的前缀 + 裸通配" 的语法噪音, 而 CSS 字面量里不会出现引号。
        piece = piece.rstrip(")").strip().replace("'", "").replace('"', "")
        if piece:
            pats.append(piece)
    return pats


def _load_guard_spec() -> tuple[list[tuple[str, str]], list[str]]:
    script = extract_script()
    arrays = _parse_arrays(script)
    guarded: list[tuple[str, str]] = []
    global_by_design: list[str] = []
    seen: set[str] = set()
    for name in BATCHES:
        batch = name.split("_")[0]  # R_CSS_LITS -> R
        skips = _parse_skip_globs(script, name)
        print(f"  [{batch}] 共 {len(arrays[name])} 条, 守卫主动跳过: {json.dumps(skips, ensure_ascii=False)}")
        for lit in arrays[name]:
            if any(fnmatch.fnmatchcase(lit, p) for p in skips):
                if lit not in global_by_design:
                    global_by_design.append(lit)
                continue
            # U 段的 `body:has(bit-dialog)... #warden-tabbar` 也会出现在 V 段的数组里
            # (V 段把它收窄了) —— 同一个字面量只证伪一次, 省一趟 35MB 重打包。
            if lit in seen:
                continue
            seen.add(lit)
            guarded.append((batch, lit))
    return guarded, global_by_design


# 从 workflow 解析(需要 extract_script, 定义见下; 这里先占位, 真正解析在 main 里做一次)
GUARDED: list[tuple[str, str]] = []
GLOBAL_BY_DESIGN: list[str] = []


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
    global GUARDED, GLOBAL_BY_DESIGN
    GUARDED, GLOBAL_BY_DESIGN = _load_guard_spec()
    print(f"从 workflow 解析: 待证伪 {len(GUARDED)} 条, 刻意全局(对照组) {len(GLOBAL_BY_DESIGN)} 条")
    by_batch: dict[str, int] = {}
    for b, _ in GUARDED:
        by_batch[b] = by_batch.get(b, 0) + 1
    print("  分布:", json.dumps(by_batch, ensure_ascii=False))

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
    skipped: list[tuple[str, str]] = []
    for batch, lit in GUARDED:
        if only and only not in lit:
            continue
        # ⚠️ 结尾**不能**只认 `{`: CSS 里有多行选择器列表(如
        #    `main#main-content bit-search form:focus-within,` 换行后才跟另一条 + `{`),
        #    只认 `{` 会定位不到 → 探针误报"证伪前提不成立", 而 CI 的判据其实是对的。
        #    末尾的 `;` 是给变量声明类条目(`--warden-line-h: 38px;`)留的。
        pat = re.compile(r"^[ \t]+(" + re.escape(lit) + r")([ \t]*[,;{]|[ \t]*$)", re.M)
        hits = pat.findall(original)
        # ⚠️ 放宽成 >=1: 同一条规则可能在 CSS 里合法地出现多次(V3a 那条就出现两次)。
        #    全部去掉缩进即可 —— 只要有一处顶格, 守卫就该报错。
        if len(hits) < 1:
            # 🔴 "0 处带缩进命中"有**两种**完全不同的成因, 必须分开处置, 否则会把
            #    "守卫是哑弹"(真问题)和"这条字面量本来就没法用去缩进的方式篡改"(探针的局限)
            #    混成同一句话 —— 第十八批第一次跑就是这么被误当成"探针的毛病"的:
            #      (a) 字面量在 CSS 里**根本不存在** ⇒ 守卫的 grep -F 永远不命中 = **哑弹**
            #          (第十四批那种: 守卫模式漏抄了真实的 `header` 一词)。
            #      (b) 字面量**存在**, 但只出现在注释里、或只作为更长选择器的一部分
            #          (它从不在行首) ⇒ 没法靠"去掉行首缩进"制造违规, 属探针的手段局限。
            if original.count(lit) >= 1:
                skipped.append((batch, lit))
                print(f"⚠️  [{batch}][{lit}] 只出现在注释/更长选择器里(从不在行首) —— 无法用去缩进证伪, 跳过")
            else:
                print(f"❌ [{batch}][{lit}] 该字面量在 CSS 里**完全不存在** ⇒ 守卫的 grep -F 永远不命中(哑弹)")
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
    if skipped:
        print(f"（其中 {len(skipped)} 条因『从不在行首』而跳过, 见上）")

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
