#!/usr/bin/env bash
# 发布决策（由仓库根 ./update_version 薄壳委托，也可直接调用）：
#   bump ictrek.app/VERSION → commit → 推分支 → 打 VOS 触发 tag 并推送（触发 CI 上架）
#
# 前置：build_image.sh 已构建并推送全部 profile 镜像、登记飞书发布表
# （package.sh 打包时从飞书读取各 profile 最新 tag）。
#
# 用法：
#   ./ictrek.app/scripts/update_version.sh [patch|minor|major]
set -euo pipefail

APP_LABEL="v-cine"
TAG_PREFIX="vos-v-cine-v"
VERSION_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/VERSION"
REPO_ROOT="$(git -C "$(dirname "${VERSION_FILE}")" rev-parse --show-toplevel)"
part="${1:-patch}"

[[ "${part}" =~ ^(patch|minor|major)$ ]] || { echo "Usage: $0 [patch|minor|major]" >&2; exit 1; }
cd "${REPO_ROOT}"
git diff --quiet && git diff --cached --quiet || { echo "worktree is not clean" >&2; exit 1; }

current="$(tr -d '[:space:]' < "${VERSION_FILE}")"
IFS=. read -r major minor patch <<< "${current}"
case "${part}" in patch) patch=$((patch + 1));; minor) minor=$((minor + 1)); patch=0;; major) major=$((major + 1)); minor=0; patch=0;; esac
version="${major}.${minor}.${patch}"
tag="${TAG_PREFIX}${version}"
public_tag="v${version}"
git rev-parse -q --verify "refs/tags/${tag}" >/dev/null && { echo "tag exists: ${tag}" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/${public_tag}" >/dev/null && { echo "public tag exists: ${public_tag}" >&2; exit 1; }
printf '%s\n' "${version}" > "${VERSION_FILE}"
git add "${VERSION_FILE}"
git commit -m "chore: release VOS ${APP_LABEL} ${version}"
git tag "${tag}"
branch="$(git branch --show-current)"
git push origin "${branch}"
git push origin "${tag}"
echo "Released ${version}; tag ${tag} pushed. CI 将打包并挂到 GitHub Release / VOS App Store。"
