#!/usr/bin/env bash
#
# 把 vaultwarden/vw_web_builds 的一个版本"稀疏 + 无 blob"检出到本地, 只拉我们真正要改的路径。
# 用途: 改源码 -> `git diff` 生成 webvault/patches/*.patch。见 webvault/README.md。
#
# 为什么不是普通 clone: 整份源码 1.19 GB, 每个 Bitwarden 版本一个分支。
# 稀疏(--sparse) + --filter=blob:none 只取需要的文件内容。实测 v2026.6.4:
#   8 秒 / 54 MB(只检 apps/web/src + libs/common/src/platform/misc)。
#
# 用法:
#   ./webvault/sync-source.sh                          # 默认 v2026.6.4 + 默认路径
#   ./webvault/sync-source.sh v2026.7.0                # 换版本
#   ./webvault/sync-source.sh v2026.6.4 libs/vault/src libs/components/src
#                                                      # 追加路径(Phase 2 会需要更多)
#
# 输出目录: <仓库根>/.vwsrc  (已被 .gitignore 忽略)
# 需要走代理时: export http_proxy=http://127.0.0.1:7890 https_proxy=$http_proxy

set -euo pipefail

VERSION="${1:-v2026.6.4}"
shift || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DEST:-${ROOT}/.vwsrc}"
REPO="${VAULT_REPO:-https://github.com/vaultwarden/vw_web_builds.git}"

# 默认路径: Phase 1 只需要这两个
PATHS=(apps/web/src libs/common/src/platform/misc)
# 追加调用方传入的路径(去重)
for p in "$@"; do PATHS+=("$p"); done
mapfile -t PATHS < <(printf '%s\n' "${PATHS[@]}" | sort -u)

echo "版本   : ${VERSION}"
echo "目标   : ${DEST}"
echo "路径   : ${PATHS[*]}"

if [ -d "${DEST}/.git" ]; then
  echo "→ 已存在检出, 只更新路径与版本"
else
  rm -rf "${DEST}"
  mkdir -p "${DEST}"
  ( cd "${DEST}" && git init -q -b main && git remote add origin "${REPO}" )
fi

# 注意: 这里一律用 `cd` 而不是 `git -C "${DEST}"`。
# Windows 上的 git.exe 不认 Git Bash 的 /f/... 风格路径(会报 "cannot change to ...")。
# 关掉 autocrlf: 否则 git diff 出来的补丁可能带 CRLF, 与 CI(Linux) 不一致
(
  cd "${DEST}"
  git config core.autocrlf false
  git sparse-checkout init --cone
  git sparse-checkout set "${PATHS[@]}"
  # blobless: 只取稀疏路径的文件内容, 历史(1.19GB)完全不下载
  git fetch --depth 1 --filter=blob:none origin "${VERSION}"
  git checkout -q FETCH_HEAD
  echo "→ commit : $(git rev-parse --short HEAD)"
)

echo "→ 体积   : $(du -sh "${DEST}" | cut -f1)"
echo "✅ 就绪: cd ${DEST} && 改源码"
