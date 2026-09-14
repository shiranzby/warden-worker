"""把 build-web-vault.yaml 里那段断言脚本抽出来, 在**我们自己刚构建的产物**上实跑。

为什么要单独写(两条都踩过):
  ① 现成的 `wf-yaml-check.py` 默认 fixture 指向**旧产物**, 拿默认参数跑出来的红/绿与本批无关;
  ② 更关键: 这段断言脚本**完全从 `bw_web_vault.tar.gz` 里取文件**
     (`tar -xzOf bw_web_vault.tar.gz web-vault/app/main.*.js > .main.js`), 所以在工作目录里
     摆一份 `.main.js` / `.vw.css` 是**一点用都没有**的 —— 必须先把构建目录按 CI 的布局
     打成 tar(顶层是 `web-vault/`, 且带 `vw-version.json`), 否则断言全红而原因是"喂错了文件"。
     我自己第一版就这么踩了一次(断言全红, 差点当成产物有问题)。

用法:
  python .deploycheck/run-artifact-asserts.py <build目录> [版本号, 默认 2026.8.0]
例:
  python .deploycheck/run-artifact-asserts.py \
      "F:/WorkSpace/Workbuddy/Github项目分析部署/vw_web_builds/apps/web/build"
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tarfile

DC = pathlib.Path(__file__).resolve().parent
ROOT = DC.parent
WF = ROOT / ".github/workflows/build-web-vault.yaml"

BUILD = pathlib.Path(sys.argv[1]).resolve()
VERSION = sys.argv[2] if len(sys.argv) > 2 else "2026.8.0"
WORK = DC / ".artcheck"

# ---- 1) 从 YAML 里取断言脚本(按 step name 切块; 不依赖 pyyaml) ----
txt = WF.read_text(encoding="utf-8")
anchor = "Verify our customizations are in the built artifact"
a = txt.index(anchor)
b = txt.index("\n      - name:", a)
lines = txt[a:b].splitlines()
i = next(k for k, l in enumerate(lines) if l.strip().startswith("run:"))
body = lines[i + 1:]
ind = min(len(l) - len(l.lstrip()) for l in body if l.strip())
script = "\n".join(l[ind:] if l.strip() else "" for l in body)
print(f"OK  断言脚本 {len(script)} 字节")

# ---- 2) 按 CI 的布局打包: build/ -> web-vault/ -> bw_web_vault.tar.gz ----
mains = sorted((BUILD / "app").glob("main.*.js"))
css = BUILD / "css" / "vaultwarden.css"
assert mains, f"缺 app/main.*.js: {BUILD/'app'}"
assert css.exists(), f"缺 css/vaultwarden.css: {css}"
if len(mains) > 1:
    print(f"  ⚠️ app/ 下有多个 main.*.js(可能是 dev server 落过盘): {[m.name for m in mains]}")

if WORK.exists():
    shutil.rmtree(WORK)
(WORK / "web-vault").mkdir(parents=True)
staging = WORK / "web-vault"
for item in BUILD.iterdir():
    if item.is_dir():
        shutil.copytree(item, staging / item.name)
    else:
        shutil.copy(item, staging / item.name)

# CI 会补生成 vw-version.json(官方 bw_web_builds 的产物也有这个文件)
(staging / "vw-version.json").write_text(
    json.dumps({"version": VERSION}, separators=(",", ":")), encoding="utf-8"
)

tarball = WORK / "bw_web_vault.tar.gz"
with tarfile.open(tarball, "w:gz") as tf:
    tf.add(staging, arcname="web-vault")
print(
    f"OK  已打包 {tarball.name} ({tarball.stat().st_size/1048576:.1f} MB), "
    f"main={mains[-1].name} ({mains[-1].stat().st_size:,} B), css={css.stat().st_size:,} B"
)

manifest = subprocess.run(
    ["tar", "-tzf", str(tarball)], capture_output=True, text=True, check=True
).stdout
(WORK / ".vault-contents.txt").write_text(manifest, encoding="utf-8")
print(f"OK  清单 {len(manifest.splitlines())} 行")

# ---- 3) 实跑(工作目录里只放 tar + 清单, 脚本自己解出来) ----
r = subprocess.run(["bash", "-c", script], cwd=WORK, capture_output=True, text=True)
print("\n=== stdout ===")
print(r.stdout)
if r.stderr.strip():
    print("=== stderr ===")
    print(r.stderr)
print(f"=== exit code = {r.returncode} ===")
sys.exit(r.returncode)
