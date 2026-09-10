#!/usr/bin/env bash
set -euo pipefail

APP_NAME="nowen-video"
IMAGE_REPO="swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video"
SPREADSHEET_TOKEN="${FEISHU_SPREADSHEET_TOKEN:-Htotsn3oahO1zxt73YMcaB1zn8e}"
FEISHU_CONFIG_FILE="${FEISHU_CONFIG_FILE:-${HOME}/.feishu.components.json}"
FEISHU_FALLBACK_CONFIG_FILE="${FEISHU_FALLBACK_CONFIG_FILE:-${HOME}/.feishu.json}"
# PostgreSQL 由 VOS 共享 pgv 服务（com.ictrek.pgv）提供，nowen 不再自带 postgres
# 容器或镜像：NOWEN_DATABASE_HOST 默认指向 pgv 在 vos_default 网络的别名。
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/src"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/staging"
PACKAGE_ROOT="${DIST_DIR}/package-root"
VERSION_FILE="${ROOT_DIR}/VERSION"
APP_VERSION="${PACKAGE_VERSION:-$(tr -d '[:space:]' < "${VERSION_FILE}")}"

[[ "${APP_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid version: ${APP_VERSION}" >&2; exit 1; }
command -v curl >/dev/null || { echo "missing curl" >&2; exit 1; }
command -v python3 >/dev/null || { echo "missing python3" >&2; exit 1; }
command -v tar >/dev/null || { echo "missing tar" >&2; exit 1; }

log() { echo "[package] $*"; }
die() { echo "[package][ERROR] $*" >&2; exit 1; }

read_feishu_field() {
  local config_file="$1" field="$2"
  python3 - "$config_file" "$field" <<'PY'
import json, sys
path, field = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
value = data.get(field, "")
print(value if isinstance(value, str) else str(value))
PY
}

get_feishu_token() {
  local app_id="$1" app_secret="$2" response
  response="$(curl --fail -sS -X POST \
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
    -H 'Content-Type: application/json' \
    -d "{\"app_id\":\"${app_id}\",\"app_secret\":\"${app_secret}\"}")"
  python3 - "$response" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if data.get("code") != 0:
    raise SystemExit(f"get_feishu_token failed: {data}")
print(data["tenant_access_token"])
PY
}

feishu_get() {
  local url="$1" token="$2"
  curl --fail -sS "$url" -H "Authorization: Bearer ${token}"
}

get_sheet_id_by_title() {
  local token="$1" title="$2" response
  response="$(feishu_get \
    "https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${SPREADSHEET_TOKEN}/sheets/query" \
    "$token")"
  python3 - "$title" "$response" <<'PY'
import json, sys
title, response = sys.argv[1], sys.argv[2]
data = json.loads(response)
if data.get("code") != 0:
    raise SystemExit(f"query sheets failed: {data}")
for sheet in data.get("data", {}).get("sheets", []):
    if sheet.get("title") == title:
        print(sheet["sheet_id"])
        raise SystemExit(0)
raise SystemExit(f"sheet title not found: {title}")
PY
}

get_range_values() {
  local token="$1" range="$2"
  feishu_get \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${range}" \
    "$token"
}

find_component_column() {
  local token="$1" sheet_id="$2" response
  response="$(get_range_values "$token" "${sheet_id}!A1:ZZ1")"
  python3 - "$response" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if data.get("code") != 0:
    raise SystemExit(f"read header failed: {data}")
rows = data.get("data", {}).get("valueRange", {}).get("values", [])
row = rows[0] if rows else []

def text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("text") or value.get("link") or "").strip()
    if isinstance(value, list):
        return "".join(text(item) for item in value).strip()
    return str(value).strip()

def column_name(number):
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(ord("A") + remainder) + result
    return result

for index, value in enumerate(row, start=1):
    if text(value) == "nowen-video":
        print(column_name(index))
        raise SystemExit(0)
raise SystemExit("component column not found: nowen-video")
PY
}

find_latest_tag() {
  local token="$1" sheet_id="$2" column="$3" response
  response="$(get_range_values "$token" "${sheet_id}!${column}4:${column}2000")"
  python3 - "$response" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if data.get("code") != 0:
    raise SystemExit(f"read version column failed: {data}")
for row in data.get("data", {}).get("valueRange", {}).get("values", []):
    if row and row[0] is not None and str(row[0]).strip():
        print(str(row[0]).strip())
        raise SystemExit(0)
raise SystemExit("latest nowen-video tag not found")
PY
}

load_feishu_auth() {
  local config_file tried=""
  for config_file in "$FEISHU_CONFIG_FILE" "$FEISHU_FALLBACK_CONFIG_FILE"; do
    [[ -n "$config_file" && "$tried" != *"|$config_file|"* ]] || continue
    tried="${tried}|${config_file}|"
    [[ -r "$config_file" ]] || continue
    FEISHU_APP_ID="$(read_feishu_field "$config_file" feishu_app_id)"
    FEISHU_APP_SECRET="$(read_feishu_field "$config_file" feishu_app_secret)"
    if [[ -n "$FEISHU_APP_ID" && -n "$FEISHU_APP_SECRET" ]]; then
      FEISHU_TOKEN="$(get_feishu_token "$FEISHU_APP_ID" "$FEISHU_APP_SECRET")"
      log "read image versions from Feishu with ${config_file}"
      return 0
    fi
  done
  die "failed to read Feishu credentials"
}

latest_image_for_sheet() {
  local sheet_title="$1" expected_prefix="$2" sheet_id column tag
  sheet_id="$(get_sheet_id_by_title "$FEISHU_TOKEN" "$sheet_title")"
  column="$(find_component_column "$FEISHU_TOKEN" "$sheet_id")"
  tag="$(find_latest_tag "$FEISHU_TOKEN" "$sheet_id" "$column")"
  [[ "$tag" == "${expected_prefix}"* ]] || \
    die "unexpected nowen-video tag in ${sheet_title}: ${tag} (expected prefix ${expected_prefix})"
  log "${sheet_title}: ${IMAGE_REPO}:${tag}" >&2
  printf '%s:%s\n' "$IMAGE_REPO" "$tag"
}

load_feishu_auth
NOWEN_VIDEO_AMD_IMAGE="$(latest_image_for_sheet AMD_with_cuda amd_)"
NOWEN_VIDEO_ARM_IMAGE="$(latest_image_for_sheet ARM_without_cuda arm_)"
NOWEN_VIDEO_L4T_IMAGE="$(latest_image_for_sheet l4t l4t_)"

rm -rf "${STAGE_DIR}" "${PACKAGE_ROOT}"
mkdir -p "${STAGE_DIR}" "${PACKAGE_ROOT}"
trap 'rm -rf "${STAGE_DIR}" "${PACKAGE_ROOT}"' EXIT

# Per-profile image refs come from the latest nowen-video entries in Feishu.
# build_image.sh pushes each image before recording its tag in the sheet.
cat > "${STAGE_DIR}/.env" <<EOF
NOWEN_VIDEO_AMD_IMAGE=${NOWEN_VIDEO_AMD_IMAGE}
NOWEN_VIDEO_ARM_IMAGE=${NOWEN_VIDEO_ARM_IMAGE}
NOWEN_VIDEO_L4T_IMAGE=${NOWEN_VIDEO_L4T_IMAGE}
EOF

python3 - "${SRC_DIR}" "${STAGE_DIR}" "${APP_VERSION}" <<'PY'
import sys
from pathlib import Path

src, dst = map(Path, sys.argv[1:3])
version = sys.argv[3]
env = dict(line.split("=", 1) for line in (dst / ".env").read_text().splitlines() if "=" in line)
for name in ("manifest.yml", "configs.yml", "routers.yml", "traefik.yml", "README.zh-CN.md", "README.en.md"):
    (dst / name).write_text((src / name).read_text().replace("__APP_VERSION__", version), encoding="utf-8")
compose = (src / "docker-compose.yml").read_text().replace("__APP_VERSION__", version)
for key, value in env.items():
    compose = compose.replace("${" + key + "}", value)
(dst / "docker-compose.yml").write_text(compose, encoding="utf-8")
if (src / "icon.png").exists():
    (dst / "icon.png").write_bytes((src / "icon.png").read_bytes())
PY

python3 - "${STAGE_DIR}" "${APP_VERSION}" \
  "${NOWEN_VIDEO_AMD_IMAGE}" "${NOWEN_VIDEO_ARM_IMAGE}" "${NOWEN_VIDEO_L4T_IMAGE}" <<'PY'
import re
import sys
from pathlib import Path
import yaml

stage, version = Path(sys.argv[1]), sys.argv[2]
expected_images = sys.argv[3:6]
for name in ("manifest.yml", "configs.yml", "routers.yml", "traefik.yml", "docker-compose.yml"):
    yaml.safe_load((stage / name).read_text())
text_parts = [(stage / ".env").read_text()]
for name in ("manifest.yml", "configs.yml", "routers.yml", "traefik.yml", "docker-compose.yml", "README.zh-CN.md", "README.en.md"):
    text_parts.append((stage / name).read_text())
assert not re.search(r"__[A-Z0-9_]+__", "\n".join(text_parts)), "unrendered placeholder"
compose = (stage / "docker-compose.yml").read_text()
assert "${NOWEN_VIDEO_AMD_IMAGE}" not in compose, "unrendered amd image variable"
assert "${NOWEN_VIDEO_ARM_IMAGE}" not in compose, "unrendered arm image variable"
assert "${NOWEN_VIDEO_L4T_IMAGE}" not in compose, "unrendered l4t image variable"
for image in expected_images:
    assert image in compose, f"missing Feishu image: {image}"
assert "runtime: nvidia" in compose, "missing nvidia runtime for l4t"
assert "privileged: true" in compose, "missing privileged for l4t"
assert "NOWEN_APP_WEB_BASE_PATH" in compose, "missing VOS web base path env"
assert "NOWEN_DATABASE_HOST" in compose and "pgv" in compose, "missing pgv database host"
assert "38085" in compose, "missing host port mapping"
assert "vos_default" in compose and "external: true" in compose, "missing VOS network"
routers = (stage / "routers.yml").read_text()
for expected in ("kind: page", "iframe-src: /app/com.ictrek.nowen-video/", "entry-point: true", "embed: true"):
    assert expected in routers, f"missing router field {expected}"
traefik = (stage / "traefik.yml").read_text()
for expected in ("/app/com.ictrek.nowen-video", "nowen-video-web", "172.17.0.1:38085", "stripPrefix"):
    assert expected in traefik, f"missing traefik field {expected}"
assert (stage / "icon.png").exists(), "missing icon.png referenced by manifest"
PY

tar czf "${PACKAGE_ROOT}/app.tar.gz" -C "${STAGE_DIR}" .env manifest.yml configs.yml routers.yml traefik.yml docker-compose.yml README.zh-CN.md README.en.md icon.png
tar cf "${DIST_DIR}/${APP_NAME}_${APP_VERSION}_pull.tar" -C "${PACKAGE_ROOT}" app.tar.gz
test "$(tar tf "${DIST_DIR}/${APP_NAME}_${APP_VERSION}_pull.tar" | wc -l | tr -d ' ')" = "1"
echo "Built ${DIST_DIR}/${APP_NAME}_${APP_VERSION}_pull.tar"
