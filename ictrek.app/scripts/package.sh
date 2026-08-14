#!/usr/bin/env bash
set -euo pipefail

APP_NAME="nowen-video"
IMAGE_REPO="swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video"
# PostgreSQL 由 VOS 共享 pgv 服务（com.ictrek.pgv）提供，nowen 不再自带 postgres
# 容器或镜像：NOWEN_DATABASE_HOST 默认指向 pgv 在 vos_default 网络的别名。
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/src"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/staging"
PACKAGE_ROOT="${DIST_DIR}/package-root"
VERSION_FILE="${ROOT_DIR}/VERSION"
APP_VERSION="${PACKAGE_VERSION:-$(tr -d '[:space:]' < "${VERSION_FILE}")}"

# 飞书发布表配置：nowen-video 镜像 tag 由表中最新的登记值解析（对齐 model_hub）。
# 鉴权凭据读取 ~/.feishu.components.json，回退到 ~/.feishu.json；
# token 优先环境变量 FEISHU_SPREADSHEET_TOKEN，缺省从配置文件读 feishu_spreadsheet_token（与 push_feishu.sh 一致）。
SPREADSHEET_TOKEN="${FEISHU_SPREADSHEET_TOKEN:-}"
FEISHU_CONFIG_FILE="${FEISHU_CONFIG_FILE:-${HOME}/.feishu.components.json}"
FEISHU_FALLBACK_CONFIG_FILE="${FEISHU_FALLBACK_CONFIG_FILE:-${HOME}/.feishu.json}"

# 镜像走华为云私有仓库；tag 由飞书表解析。
REPOSITORY="swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video"

[[ "${APP_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid version: ${APP_VERSION}" >&2; exit 1; }
command -v curl >/dev/null || { echo "missing curl" >&2; exit 1; }
command -v python3 >/dev/null || { echo "missing python3" >&2; exit 1; }
command -v tar >/dev/null || { echo "missing tar" >&2; exit 1; }

rm -rf "${STAGE_DIR}" "${PACKAGE_ROOT}"
mkdir -p "${STAGE_DIR}" "${PACKAGE_ROOT}"
trap 'rm -rf "${STAGE_DIR}" "${PACKAGE_ROOT}"' EXIT

# Per-profile image refs are pinned to the VOS app version. The matching
# images must be built/pushed by build_image.sh before release.
cat > "${STAGE_DIR}/.env" <<EOF
NOWEN_VIDEO_AMD_IMAGE=${IMAGE_REPO}:amd_${APP_VERSION}
NOWEN_VIDEO_ARM_IMAGE=${IMAGE_REPO}:arm_${APP_VERSION}
EOF

get_feishu_token() {
  local app_id="$1" app_secret="$2" resp
  resp="$(
    curl --fail -sS -X POST "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
      -H "Content-Type: application/json" \
      -d "{\"app_id\":\"${app_id}\",\"app_secret\":\"${app_secret}\"}"
  )"
  python3 - "$resp" <<'PYJSON'
import json, sys
data = json.loads(sys.argv[1])
if data.get("code") != 0:
    raise SystemExit(f"get_feishu_token failed: {data}")
print(data["tenant_access_token"])
PYJSON
}

get_sheet_id_by_title() {
  local token="$1" target_title="$2"
  local resp
  resp="$(curl --fail -sS -X GET \
    "https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${SPREADSHEET_TOKEN}/sheets/query" \
    -H "Authorization: Bearer ${token}")"
  python3 - "$target_title" "$resp" <<'PYJSON'
import json, sys
target, resp = sys.argv[1], sys.argv[2]
data = json.loads(resp)
if data.get("code") != 0:
    raise SystemExit(f"query sheets failed: {data}")
for sheet in data.get("data", {}).get("sheets", []):
    if sheet.get("title") == target:
        print(sheet["sheet_id"])
        raise SystemExit(0)
raise SystemExit(f"sheet title not found: {target}")
PYJSON
}

find_component_column_letter() {
  local token="$1" sheet_id="$2" component="$3"
  local resp
  resp="$(curl --fail -sS -X GET \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${sheet_id}!A1:ZZ1" \
    -H "Authorization: Bearer ${token}")"
  python3 - "$component" "$resp" <<'PYJSON'
import json, sys
target, resp = sys.argv[1], sys.argv[2]
data = json.loads(resp)
if data.get("code") != 0:
    raise SystemExit(f"read header failed: {data}")
values = data.get("data", {}).get("valueRange", {}).get("values", [])
row = values[0] if values else []

def text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("text") or value.get("link") or "").strip()
    if isinstance(value, list):
        return "".join(text(v) for v in value).strip()
    return str(value).strip()

def col(num):
    out = ""
    while num > 0:
        num, rem = divmod(num - 1, 26)
        out = chr(ord("A") + rem) + out
    return out

for index, value in enumerate(row, start=1):
    if text(value) == target:
        print(col(index))
        raise SystemExit(0)
raise SystemExit(f"component column not found in row1: {target}")
PYJSON
}

find_latest_tag() {
  local token="$1" sheet_id="$2" column="$3"
  local resp
  resp="$(curl --fail -sS -X GET \
    "https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${sheet_id}!${column}4:${column}2000" \
    -H "Authorization: Bearer ${token}")"
  python3 - "$resp" <<'PYJSON'
import json, sys
data = json.loads(sys.argv[1])
if data.get("code") != 0:
    raise SystemExit(f"read version column failed: {data}")
values = data.get("data", {}).get("valueRange", {}).get("values", [])
for row in values:
    if not row:
        continue
    value = row[0]
    if value is None:
        continue
    text = str(value).strip()
    if text:
        print(text)
        raise SystemExit(0)
raise SystemExit("latest version not found")
PYJSON
}

load_feishu_auth() {
  local config_file tried=""
  for config_file in "$FEISHU_CONFIG_FILE" "$FEISHU_FALLBACK_CONFIG_FILE"; do
    [[ -n "$config_file" && "$tried" != *"|$config_file|"* ]] || continue
    tried="${tried}|${config_file}|"
    [[ -r "$config_file" ]] || { echo "Skip unreadable Feishu config: ${config_file}" >&2; continue; }
    if FEISHU_APP_ID="$(read_feishu_field "$config_file" "feishu_app_id")" \
      && FEISHU_APP_SECRET="$(read_feishu_field "$config_file" "feishu_app_secret")" \
      && [[ -n "$FEISHU_APP_ID" && -n "$FEISHU_APP_SECRET" ]] \
      && FEISHU_TOKEN="$(get_feishu_token "$FEISHU_APP_ID" "$FEISHU_APP_SECRET")"; then
      [[ -n "$SPREADSHEET_TOKEN" ]] || SPREADSHEET_TOKEN="$(read_feishu_field "$config_file" "feishu_spreadsheet_token")"
      [[ -n "$SPREADSHEET_TOKEN" ]] || { echo "missing FEISHU_SPREADSHEET_TOKEN (set env or feishu_spreadsheet_token in config)" >&2; continue; }
      return 0
    fi
    echo "Cannot read Feishu auth from ${config_file}; trying fallback" >&2
  done
  echo "failed to read Feishu credentials" >&2
  exit 1
}

# 解析 nowen-video 最新镜像 tag：从飞书表「nowen-video」列读第一个非空值
resolve_image_tag() {
  local token="$1" sheet_title="$2" component="$3" column tag
  local sheet_id
  sheet_id="$(get_sheet_id_by_title "$token" "$sheet_title")"
  column="$(find_component_column_letter "$token" "$sheet_id" "$component")"
  tag="$(find_latest_tag "$token" "$sheet_id" "$column")"
  echo "${tag}"
}

# token 优先环境变量，缺省在 load_feishu_auth 里从配置文件兜底；CI 用 secret 注入
load_feishu_auth
[[ -n "${SPREADSHEET_TOKEN}" ]] || { echo "missing FEISHU_SPREADSHEET_TOKEN (set env or feishu_spreadsheet_token in config)" >&2; exit 1; }

# VOS 安装：单服务（nowen-video 连接 VOS 共享 PGV），不依赖平台传 --profile。
# 镜像走华为云私有仓库；tag 由飞书表解析。
# ⚠️ SHEET_TITLE 需与你飞书发布表中实际 sheet 的标题一致（改错会解析失败）；
#    与 push_feishu.sh 写入的 sheet 保持一致（见 scripts/push_feishu.sh 的 DEFAULT_SHEET）。
COMPONENT="nowen-video"
SHEET_TITLE="ARM_with_cuda"
IMAGE_TAG="$(resolve_image_tag "$FEISHU_TOKEN" "$SHEET_TITLE" "$COMPONENT")"
[[ -n "${IMAGE_TAG}" ]] || { echo "failed to resolve nowen-video image tag from Feishu sheet" >&2; exit 1; }
NOWEN_VIDEO_IMAGE="${REPOSITORY}:${IMAGE_TAG}"
echo "Resolved image: ${NOWEN_VIDEO_IMAGE}" >&2

# 镜像已内联进 docker-compose.yml（平台安装时 WriteEnv 会覆写 .env，故不依赖它）。
# .env 不进包：平台在安装时根据 configs.yml 自行生成 <install_path>/.env。
python3 - "${SRC_DIR}" "${STAGE_DIR}" "${APP_VERSION}" "${NOWEN_VIDEO_IMAGE}" <<'PY'
import sys
from pathlib import Path

src, dst = map(Path, sys.argv[1:3])
version = sys.argv[3]
env = dict(line.split("=", 1) for line in (dst / ".env").read_text().splitlines() if "=" in line)
for name in ("manifest.yml", "configs.yml", "routers.yml", "traefik.yml", "README.zh-CN.md", "README.en.md"):
    (dst / name).write_text((src / name).read_text().replace("__APP_VERSION__", version), encoding="utf-8")
compose = (src / "docker-compose.yml").read_text().replace("__APP_VERSION__", version)
compose = compose.replace("${NOWEN_VIDEO_IMAGE}", image)
(dst / "docker-compose.yml").write_text(compose, encoding="utf-8")
if (src / "icon.png").exists():
    (dst / "icon.png").write_bytes((src / "icon.png").read_bytes())
PY

python3 - "${STAGE_DIR}" "${APP_VERSION}" "${IMAGE_REPO}" <<'PY'
import re
import sys
from pathlib import Path
import yaml

stage, version, repo = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
for name in ("manifest.yml", "configs.yml", "routers.yml", "traefik.yml", "docker-compose.yml"):
    yaml.safe_load((stage / name).read_text())
text_parts = [(stage / ".env").read_text()]
for name in ("manifest.yml", "configs.yml", "routers.yml", "traefik.yml", "docker-compose.yml", "README.zh-CN.md", "README.en.md"):
    text_parts.append((stage / name).read_text())
assert not re.search(r"__[A-Z0-9_]+__", "\n".join(text_parts)), "unrendered placeholder"
compose = (stage / "docker-compose.yml").read_text()
assert "${NOWEN_VIDEO_AMD_IMAGE}" not in compose, "unrendered amd image variable"
assert "${NOWEN_VIDEO_ARM_IMAGE}" not in compose, "unrendered arm image variable"
assert f"{repo}:amd_{version}" in compose, "missing amd image tag"
assert f"{repo}:arm_{version}" in compose, "missing arm image tag"
assert "NOWEN_APP_WEB_BASE_PATH" in compose, "missing VOS web base path env"
assert "NOWEN_DATABASE_HOST" in compose and "pgv" in compose, "missing pgv database host"
assert "38085" in compose, "missing host port mapping"
assert "vos_default" in compose and "external: true" in compose, "missing VOS network"
routers = (stage / "routers.yml").read_text()
for expected in ("com-ictrek-nowen-video", "iframe-src: /app/com.ictrek.nowen-video/", "entry-point: true", "embed: true"):
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
