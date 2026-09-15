#!/usr/bin/env bash
# Mirror the V-Cine Dockerfile base images into the ictrek SWR registry as
# PER-ARCH tags. Huawei SWR rejects OCI multi-arch index pushes (HTTP 400), so
# each arch is pushed under its own tag: <base>-amd64 / <base>-arm64.
#
# Run NATIVELY on each build host: tc232 mirrors amd64, tc192 mirrors arm64.
# Source is a public registry mirror (daocloud/1ms/dockerproxy); Docker Hub
# direct is unreachable from the CN build hosts. Bases are NOT written to Feishu.
#
#   ./scripts/mirror_base_images.sh        # mirror all bases for this host's arch
#   ./scripts/mirror_base_images.sh -n     # dry-run
set -euo pipefail

REGISTRY="swr.cn-southwest-2.myhuaweicloud.com"
NAMESPACE="ictrek"
BASE_IMAGES=(
  "oven/bun:1-alpine"
  "golang:1.25-alpine"
  "nvidia/cuda:12.8.1-runtime-ubuntu22.04"
  "ubuntu:22.04"
)
MIRRORS=(docker.m.daocloud.io docker.1ms.run dockerproxy.com)
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[mirror-base] $*"; }
err() { echo "[mirror-base][ERROR] $*" >&2; }
die() { err "$*"; exit 1; }

command -v docker >/dev/null || die "missing docker"

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "unsupported arch: $(uname -m)" ;;
esac

# Official images (no /) live under library/ on registry mirrors.
normalize() {
  local img="$1"
  if [[ "${img%%:*}" != */* ]]; then echo "library/${img}"; else echo "${img}"; fi
}

mirror_one() {
  local canonical="$1" repo tag normalized swr_tag mirror src
  repo="${canonical%%:*}"
  tag="${canonical#*:}"
  normalized="$(normalize "$canonical")"
  swr_tag="${REGISTRY}/${NAMESPACE}/${repo}:${tag}-${ARCH}"

  if [[ "$DRY_RUN" != "1" ]] && docker manifest inspect "$swr_tag" >/dev/null 2>&1; then
    log "already in SWR: ${swr_tag}"
    return 0
  fi

  for mirror in "${MIRRORS[@]}"; do
    src="${mirror}/${normalized}"
    log "pull ${src} (linux/${ARCH})"
    [[ "$DRY_RUN" == "1" ]] && return 0
    if docker pull --platform "linux/${ARCH}" "$src"; then
      docker tag "$src" "$swr_tag"
      docker push "$swr_tag" >/dev/null
      log "ok: ${swr_tag} (via ${mirror})"
      return 0
    fi
    log "failed via ${mirror}, trying next"
  done
  return 1
}

fail=0
for img in "${BASE_IMAGES[@]}"; do
  mirror_one "$img" || { err "could not mirror ${img}"; fail=1; }
done
[[ "$fail" == "0" ]] || exit 1
log "done. arch=${ARCH}; bases at ${REGISTRY}/${NAMESPACE}/<name>:<tag>-${ARCH}"
