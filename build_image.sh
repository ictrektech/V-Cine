#!/usr/bin/env bash
# Build the nowen-video image from source, push it to the ictrek SWR registry
# under a version-pinned arch tag, and record that tag in the shared Feishu
# spreadsheet (record only — ictrek.app/scripts/package.sh does NOT read Feishu;
# it derives the tag from ictrek.app/VERSION).
#
# Run NATIVELY on the matching build host: tc232 (amd64) / tc192 (arm64).
# Base images are pulled from SWR (run scripts/mirror_base_images.sh first),
# never from Docker Hub.
#
#   ./build_image.sh                 # auto-detect arch, read VERSION, build+push+record
#   ./build_image.sh --no-push       # build only, skip push
#   ./build_image.sh --no-feishu     # skip the Feishu record
#   ./build_image.sh --no-build --no-push  # record-only (build+push already done)
#   ./build_image.sh --version 0.1.3 # override version
#   ./build_image.sh --profile l4t   # Jetson/L4T build (Dockerfile.l4t, tag l4t_<version>)
set -euo pipefail

# ---------------- config ----------------
REGISTRY="swr.cn-southwest-2.myhuaweicloud.com"
NAMESPACE="ictrek"
APP_NAME="nowen-video"
IMAGE_REPO="${REGISTRY}/${NAMESPACE}/${APP_NAME}"
COMPONENT_NAME="nowen-video"                 # Feishu column header (row 1)
FEISHU_SPREADSHEET_TOKEN="Htotsn3oahO1zxt73YMcaB1zn8e"
FEISHU_CONFIG_FILE="${FEISHU_CONFIG_FILE:-${HOME}/.feishu.json}"
# Feishu sheets that record the image tag for each arch (same sets as motrix).
AMD_SHEETS=("AMD_with_cuda" "AMD_with_mxn100")
ARM_SHEETS=("ARM_without_cuda" "ARM_with_cuda" "l4t" "thor_spark")

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${ROOT_DIR}/ictrek.app/VERSION"

log() { echo "[build] $*"; }
err() { echo "[build][ERROR] $*" >&2; }
die() { err "$*"; exit 1; }

# Build profile → (Dockerfile, tag prefix, default Feishu sheet).
# default keeps the existing docker/Dockerfile + arch-based tag/sheets.
profile_spec() {
  case "$1" in
    default) printf '%s|%s|%s\n' "docker/Dockerfile" "" "" ;;
    l4t)     printf '%s|%s|%s\n' "docker/Dockerfile.l4t" "l4t" "l4t" ;;
    *) return 1 ;;
  esac
}

# ---------------- args ----------------
DO_BUILD=1
DO_PUSH=1
DO_FEISHU=1
VERSION_OVERRIDE=""
SHEETS_OVERRIDE=()
PROFILE="default"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) DO_BUILD=0; shift ;;
    --no-push) DO_PUSH=0; shift ;;
    --no-feishu) DO_FEISHU=0; shift ;;
    --version) VERSION_OVERRIDE="${2:-}"; shift 2 ;;
    --sheet) SHEETS_OVERRIDE+=("${2:-}"); shift 2 ;;
    --profile) PROFILE="${2:-default}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

# ---------------- arch + version ----------------
arch_from_uname() {
  case "$(uname -m)" in
    x86_64|amd64) echo amd ;;
    aarch64|arm64) echo arm ;;
    *) die "unsupported arch: $(uname -m)" ;;
  esac
}
ARCH="$(arch_from_uname)"
PLATFORM="linux/$( [ "$ARCH" = amd ] && echo amd64 || echo arm64 )"
ARCH_FULL="${PLATFORM#linux/}"   # amd64 | arm64 (matches mirror_base_images.sh tags)

if ! PROFILE_SPEC="$(profile_spec "$PROFILE")"; then
  die "unknown profile: ${PROFILE} (supported: default, l4t)"
fi
IFS='|' read -r DOCKERFILE TAG_PREFIX PROFILE_SHEET <<< "${PROFILE_SPEC}"

contains() {
  local e
  for e in "${@:2}"; do [[ "$e" == "$1" ]] && return 0; done
  return 1
}
# Feishu sheets to record on: default = all sheets of this arch (like motrix),
# overridable via NOWEN_RELEASE_SHEETS env or repeated --sheet.
TARGET_SHEETS=()
if [[ -n "${NOWEN_RELEASE_SHEETS:-}" ]]; then
  IFS=',' read -r -a TARGET_SHEETS <<< "${NOWEN_RELEASE_SHEETS}"
fi
TARGET_SHEETS+=("${SHEETS_OVERRIDE[@]}")
if [[ ${#TARGET_SHEETS[@]} -eq 0 ]]; then
  if [[ -n "$PROFILE_SHEET" ]]; then
    TARGET_SHEETS=("$PROFILE_SHEET")
  elif [[ "$ARCH" == "amd" ]]; then
    TARGET_SHEETS=("${AMD_SHEETS[@]}")
  else
    TARGET_SHEETS=("${ARM_SHEETS[@]}")
  fi
fi
for sheet in "${TARGET_SHEETS[@]}"; do
  if [[ "$ARCH" == "amd" ]]; then
    contains "$sheet" "${AMD_SHEETS[@]}" || die "Sheet ${sheet} is not valid for amd"
  else
    contains "$sheet" "${ARM_SHEETS[@]}" || die "Sheet ${sheet} is not valid for arm"
  fi
done

VERSION="${VERSION_OVERRIDE:-$(tr -d '[:space:]' < "${VERSION_FILE}")}"
[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid VERSION: ${VERSION}"

if [[ -n "$TAG_PREFIX" ]]; then
  TAG="${TAG_PREFIX}_${VERSION}"
else
  TAG="${ARCH}_${VERSION}"
fi
IMAGE_URI="${IMAGE_REPO}:${TAG}"

command -v docker >/dev/null || die "missing docker"
command -v python3 >/dev/null || die "missing python3"
[[ -f "${ROOT_DIR}/${DOCKERFILE}" ]] || die "Dockerfile not found: ${ROOT_DIR}/${DOCKERFILE}"

log "ARCH=${ARCH} PLATFORM=${PLATFORM} VERSION=${VERSION}"
log "PROFILE=${PROFILE} DOCKERFILE=${DOCKERFILE}"
log "IMAGE=${IMAGE_URI}"
log "sheets=${TARGET_SHEETS[*]} component=${COMPONENT_NAME}"

# ---------------- base images from SWR ----------------
# Parse docker/Dockerfile FROM lines (skip --flags and prior-stage aliases),
# ensure each base is present locally by pulling the SWR copy and tagging it
# back to its canonical name. The build then uses --pull=false so it never
# touches Docker Hub.
ensure_base_images() {
  local image missing=0 swr repo tag
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    if docker image inspect "$image" >/dev/null 2>&1; then
      log "base present locally: ${image}"
      continue
    fi
    repo="${image%%:*}"
    tag="${image#*:}"
    swr="${REGISTRY}/${NAMESPACE}/${repo}:${tag}-${ARCH_FULL}"
    log "base missing, pulling from SWR: ${swr}"
    if docker pull "$swr"; then
      docker tag "$swr" "$image"
      log "tagged ${swr} -> ${image}"
    else
      err "base image not in SWR: ${swr} (run scripts/mirror_base_images.sh on this host first)"
      missing=1
    fi
  done < <(
    awk '
      toupper($1) == "FROM" {
        img = ""; alias = ""
        for (i = 2; i <= NF; i++) {
          if (toupper($i) == "AS" && (i+1) <= NF) { alias = $(i+1); break }
          if ($i ~ /^--/) continue
          if (img == "") img = $i
        }
        if (img == "" || img in aliases) next
        print img
        if (alias != "") aliases[alias] = 1
      }
    ' "${ROOT_DIR}/${DOCKERFILE}" | sort -u
  )
  [[ "$missing" == "0" ]] || die "one or more base images unavailable"
}

# ---------------- build ----------------
build_image() {
  ensure_base_images
  log "building ${IMAGE_URI} (${PLATFORM})"
  docker buildx build --load --provenance=false --sbom=false --pull=false \
    -f "${DOCKERFILE}" \
    --build-arg NOWEN_VERSION="${VERSION}" \
    -t "${IMAGE_URI}" \
    "${ROOT_DIR}"
}

# ---------------- push ----------------
push_image() {
  [[ "$DO_PUSH" == "1" ]] || { log "--no-push: skip push"; return 0; }
  log "pushing ${IMAGE_URI}"
  docker push "${IMAGE_URI}"
  log "pushed: ${IMAGE_URI}"
}

# ---------------- Feishu record (ported from WeKnora build_image.sh) ----------------
read_feishu_field() {
  local field="$1"
  python3 - "$FEISHU_CONFIG_FILE" "$field" <<'PY'
import json, sys
path, field = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
val = data.get(field, "")
if not isinstance(val, str):
    val = str(val)
print(val)
PY
}

get_feishu_token() {
  local app_id="$1" app_secret="$2" resp
  resp=$(curl --fail -sS -X POST 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
    -H 'Content-Type: application/json' \
    -d "{\"app_id\":\"${app_id}\",\"app_secret\":\"${app_secret}\"}") || die "get_feishu_token: curl failed"
  python3 - "$resp" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if data.get("code") != 0:
    raise SystemExit(f"get_feishu_token failed: {data}")
print(data["tenant_access_token"])
PY
}

feishu_api_json() {
  local method="$1" url="$2" token="$3" body="${4:-}"
  if [[ -n "$body" ]]; then
    curl --fail -sS -X "$method" "$url" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data "$body"
  else
    curl --fail -sS -X "$method" "$url" -H "Authorization: Bearer ${token}"
  fi
}

get_sheet_id_by_title() {
  local token="$1" target="$2" resp
  resp=$(feishu_api_json "GET" \
    "https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${FEISHU_SPREADSHEET_TOKEN}/sheets/query" "$token")
  python3 - "$target" "$resp" <<'PY'
import json, sys
target = sys.argv[1]
data = json.loads(sys.argv[2])
if data.get("code") != 0:
    raise SystemExit(f"query sheets failed: {data}")
for sheet in data.get("data", {}).get("sheets", []):
    if sheet.get("title") == target:
        print(sheet["sheet_id"])
        raise SystemExit(0)
raise SystemExit(f"sheet title not found: {target}")
PY
}

get_range_values() {
  local token="$1" range="$2"
  feishu_api_json "GET" \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${FEISHU_SPREADSHEET_TOKEN}/values/${range}" "$token"
}

column_letter() {
  python3 - "$1" <<'PY'
import sys
n = int(sys.argv[1])
s = ""
while n > 0:
    n, r = divmod(n - 1, 26)
    s = chr(ord("A") + r) + s
print(s)
PY
}

write_cell() {
  local token="$1" sheet_id="$2" cell="$3" value="$4" resp
  resp=$(feishu_api_json "PUT" \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${FEISHU_SPREADSHEET_TOKEN}/values" "$token" \
    "{\"valueRange\":{\"range\":\"${sheet_id}!${cell}:${cell}\",\"values\":[[\"${value}\"]]}}")
  python3 - "$resp" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if data.get("code") != 0:
    raise SystemExit(f"write_cell failed: {data}")
PY
}

find_or_create_component_column() {
  local token="$1" sheet_id="$2" component="$3" resp
  resp="$(get_range_values "$token" "${sheet_id}!A1:ZZ2")"
  python3 - "$component" "$resp" <<'PY'
import json, sys
target = sys.argv[1]
data = json.loads(sys.argv[2] or "{}")
if data.get("code") != 0:
    raise SystemExit(f"read header failed: {data}")
values = data.get("data", {}).get("valueRange", {}).get("values", [])
row = values[0] if values else []
repo_row = values[1] if len(values) > 1 else []

def cell_text(v):
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, dict):
        return str(v.get("text") or v.get("link") or "").strip()
    if isinstance(v, list):
        return "".join(cell_text(x) for x in v).strip()
    return str(v).strip()

max_len = max(len(row), len(repo_row))
for i in range(2, max_len + 1):
    if (cell_text(row[i-1]) if i <= len(row) else "") == target:
        print(i)
        raise SystemExit(0)
for i in range(2, max_len + 2):
    h = cell_text(row[i-1]) if i <= len(row) else ""
    r = cell_text(repo_row[i-1]) if i <= len(repo_row) else ""
    if not h and not r:
        print(i)
        raise SystemExit(0)
print(max_len + 1)
PY
}

find_date_row() {
  local token="$1" sheet_id="$2" target_date="$3" resp
  resp="$(get_range_values "$token" "${sheet_id}!A4:A2000")"
  python3 - "$target_date" "$resp" <<'PY'
import json, sys
target = sys.argv[1]
data = json.loads(sys.argv[2] or "{}")
if data.get("code") != 0:
    raise SystemExit(f"read date column failed: {data}")
for idx, row in enumerate(data.get("data", {}).get("valueRange", {}).get("values", []), start=4):
    if row and str(row[0]).strip() == target:
        print(idx)
        raise SystemExit(0)
print("")
PY
}

prepend_date_row() {
  local token="$1" sheet_id="$2" today="$3" resp
  resp=$(feishu_api_json "POST" \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${FEISHU_SPREADSHEET_TOKEN}/values_prepend" "$token" \
    "{\"valueRange\":{\"range\":\"${sheet_id}!A4:A4\",\"values\":[[\"${today}\"]]}}")
  python3 - "$resp" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if data.get("code") != 0:
    raise SystemExit(f"prepend_date_row failed: {data}")
PY
}

update_feishu_cell() {
  local token="$1" sheet_id="$2" sheet_title="$3" component="$4" repo="$5" row="$6" tag="$7"
  local col_idx col
  col_idx="$(find_or_create_component_column "$token" "$sheet_id" "$component")"
  col="$(column_letter "$col_idx")"
  write_cell "$token" "$sheet_id" "${col}1" "$component"
  write_cell "$token" "$sheet_id" "${col}2" "$repo"
  write_cell "$token" "$sheet_id" "${col}${row}" "$tag"
  log "Feishu recorded: ${sheet_title}!${col}${row} = ${tag} (${component})"
}

record_feishu() {
  [[ "$DO_FEISHU" == "1" ]] || { log "--no-feishu: skip record"; return 0; }
  [[ -f "$FEISHU_CONFIG_FILE" ]] || die "Feishu config not found: $FEISHU_CONFIG_FILE"
  local app_id app_secret token sheet_id today date_row sheet
  app_id="$(read_feishu_field feishu_app_id)"
  app_secret="$(read_feishu_field feishu_app_secret)"
  [[ -n "$app_id" && -n "$app_secret" ]] || die "feishu_app_id/feishu_app_secret missing in $FEISHU_CONFIG_FILE"

  today="$(date +%Y%m%d)"
  for sheet in "${TARGET_SHEETS[@]}"; do
    token="$(get_feishu_token "$app_id" "$app_secret")"
    sheet_id="$(get_sheet_id_by_title "$token" "$sheet")"
    log "sheet: ${sheet} -> ${sheet_id}"

    date_row="$(find_date_row "$token" "$sheet_id" "$today")"
    if [[ -z "$date_row" ]]; then
      log "date ${today} not in ${sheet}; prepending row at top of data area"
      prepend_date_row "$token" "$sheet_id" "$today"
      date_row=4
    else
      log "date ${today} at row ${date_row}"
    fi

    token="$(get_feishu_token "$app_id" "$app_secret")"
    update_feishu_cell "$token" "$sheet_id" "$sheet" "$COMPONENT_NAME" "$IMAGE_REPO" "$date_row" "$TAG"
  done
}

# ---------------- run ----------------
[[ "$DO_BUILD" == "1" ]] && build_image
push_image
record_feishu
log "done: ${IMAGE_URI}"
