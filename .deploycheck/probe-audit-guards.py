"""审计 build-web-vault.yaml 里 '^' 顶格判据守卫, 找出**永远不会命中**的哑弹。

背景(2026-09-14 第十四批实测踩到): 守卫写成
    grep -qE '^main#main-content app-header product-switcher'
却漏抄了真实规则里的 `header` 一词 ⇒ 永远不匹配。把规则从 @media 内提成顶格
(即制造守卫本该拦住的那次误改)它**照样通过** —— 纯哑弹, 拦不住任何东西。

判据(决定性, 不靠猜片段):
  · 只审计**非注释行**(注释里会出现历史模式的引用, 会假阳性);
  · 跳过 `^ ` 开头的模式 —— 那是"断言某规则**有**缩进"的正向检查, 不适用本判据;
  · ① 守卫在**当前** .vw.css 上必须**不**命中(命中的话说明定制本身写错了);
  · ② 构造"把每行缩进全部去掉"的版本, 守卫在那上面**必须**命中 ——
      否则说明"去缩进"也触发不了它。

关于 ② 的两种解读(必须人工分清, 别一律当哑弹):
  (a) **真哑弹**: 守卫本意是"某条**存在**的规则不许顶格写", 但模式抄错了(漏词/写错类名),
      于是无论怎么写都不报警。← 第十四批亲手踩到, 这类必须修。
  (b) **常态有效的"禁止出现"守卫**: 守卫本意是"这条规则**根本不该存在**", 而当前源码里
      确实一条都没有(只在注释里被引用过) ⇒ 去缩进当然也不命中, 但**顶格误加时它照样拦得住**。
      这类不算哑弹。本仓库已知两处:
        · L431 `^\\.warden-authview`  —— 禁止 L4 那层 fixed 覆盖层回来(实测: 顶格添加会拦住,
          缩进(@media 内)添加拦不住 —— 已知范围限制, 见该处注释的语义);
        · L658 `^[0-9]+:[^[:space:]]` —— 第十四批新增, **输入不是 CSS 而是 `grep -n` 的输出**,
          本脚本的判据不适用(故恒报"不命中")。

用法: python .deploycheck/probe-audit-guards.py
"""
import re

WF = ".github/workflows/build-web-vault.yaml"
CSS = (
    "F:/WorkSpace/Workbuddy/Github项目分析部署/vw_web_builds/apps/web/src/css/vaultwarden.css"
)

css = open(CSS, encoding="utf-8", errors="replace").read()
dedented = "\n".join(l.lstrip() for l in css.split("\n"))

guards = []
for i, line in enumerate(open(WF, encoding="utf-8").read().split("\n"), 1):
    stripped = line.strip()
    if stripped.startswith("#"):
        continue  # 注释(含历史模式引用)不算
    m = re.search(r"grep -qE (?:-- )?'(\^[^']*)'", line)
    if not m:
        continue
    pat = m.group(1)
    if pat.startswith("^ "):
        continue  # 正向断言"有缩进", 不属于顶格守卫
    guards.append((i, pat))

print("非注释行里的 '^' 顶格守卫: %d 条\n" % len(guards))
duds = []
for ln, pat in guards:
    r = re.compile(pat)
    hits_now = any(r.search(l) for l in css.split("\n"))
    hits_de = any(r.search(l) for l in dedented.split("\n"))
    if hits_now:
        verdict = "[写错了] 当前 CSS 上就命中 —— 该规则真被写成了全局"
        duds.append((ln, pat, verdict))
    elif not hits_de:
        # 见文件头 (b): 可能是"禁止出现"类守卫, 需人工确认
        verdict = "[待人工确认] 去缩进也不命中"
        duds.append((ln, pat, verdict))
    else:
        verdict = "[有效]"
    print("  %-13s L%d  %s" % (verdict, ln, pat))

print()
print("待确认守卫 = %d (对照文件头的已知例外清单逐条确认; 真正的哑弹必须修)" % len(duds))
for ln, pat, why in duds:
    print("  L%d  %s   %s" % (ln, pat, why))
