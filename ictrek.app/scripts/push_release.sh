#!/usr/bin/env bash
# Push the release tag created by update_version.sh. Pushing the tag triggers
# GitHub Actions (vos-release.yml) to build the pull-mode package and publish
# it to the VOS App Store.
#
# Run this ONLY after both arch images are built and pushed to SWR:
#   ./build_image.sh   (on tc232 amd64 and tc192 arm64, or equivalent hosts)
#
#   ./ictrek.app/scripts/push_release.sh   # no args; reads ictrek.app/VERSION
set -euo pipefail

APP_LABEL="nowen-video"
TAG_PREFIX="vos-nowen-video-v"
VERSION_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/VERSION"
REPO_ROOT="$(git -C "$(dirname "${VERSION_FILE}")" rev-parse --show-toplevel)"

cd "${REPO_ROOT}"
git fetch --tags origin

version="$(tr -d '[:space:]' < "${VERSION_FILE}")"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid VERSION: ${version}" >&2; exit 1; }
tag="${TAG_PREFIX}${version}"

git rev-parse -q --verify "refs/tags/${tag}" >/dev/null || {
  echo "local tag ${tag} not found; run ./ictrek.app/scripts/update_version.sh first" >&2
  exit 1
}
if git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
  echo "tag already on origin: ${tag}" >&2
  exit 1
fi

echo "About to push ${tag}, which triggers the VOS release pipeline."
echo "Confirm both images exist on SWR before continuing:"
echo "  swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video:amd_${version}"
echo "  swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video:arm_${version}"
read -r -p "Continue? [y/N] " ans
[[ "${ans}" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }

git push origin "${tag}"
echo "Pushed ${tag}. GitHub Actions will build the pull tar and create release v${version}."
