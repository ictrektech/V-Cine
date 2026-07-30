#!/usr/bin/env bash
set -euo pipefail

APP_NAME="nowen-video"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/src"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/staging"
PACKAGE_ROOT="${DIST_DIR}/package-root"
VERSION_FILE="${ROOT_DIR}/VERSION"
APP_VERSION="${PACKAGE_VERSION:-$(tr -d '[:space:]' < "${VERSION_FILE}")}"

[[ "${APP_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid version: ${APP_VERSION}" >&2; exit 1; }
command -v python3 >/dev/null || { echo "missing python3" >&2; exit 1; }
command -v tar >/dev/null || { echo "missing tar" >&2; exit 1; }

rm -rf "${STAGE_DIR}" "${PACKAGE_ROOT}"
mkdir -p "${STAGE_DIR}" "${PACKAGE_ROOT}"
trap 'rm -rf "${STAGE_DIR}" "${PACKAGE_ROOT}"' EXIT

cat > "${STAGE_DIR}/.env" <<'EOF'
NOWEN_VIDEO_IMAGE=docker.io/cropflre/nowen-video:latest
EOF

python3 - "${SRC_DIR}" "${STAGE_DIR}" "${APP_VERSION}" <<'PY'
import sys
from pathlib import Path

src, dst = map(Path, sys.argv[1:3])
version = sys.argv[3]
env = dict(line.split("=", 1) for line in (dst / ".env").read_text().splitlines() if "=" in line)
for name in ("manifest.yml", "configs.yml", "routers.yml", "README.zh-CN.md"):
    (dst / name).write_text((src / name).read_text().replace("__APP_VERSION__", version), encoding="utf-8")
compose = (src / "docker-compose.yml").read_text().replace("__APP_VERSION__", version)
for key, value in env.items():
    compose = compose.replace("${" + key + "}", value)
(dst / "docker-compose.yml").write_text(compose, encoding="utf-8")
PY

python3 - "${STAGE_DIR}" <<'PY'
import re
import sys
from pathlib import Path
import yaml

stage = Path(sys.argv[1])
for name in ("manifest.yml", "configs.yml", "routers.yml", "docker-compose.yml"):
    yaml.safe_load((stage / name).read_text())
text = "\n".join(p.read_text() for p in stage.iterdir() if p.is_file())
assert not re.search(r"__[A-Z0-9_]+__", text), "unrendered placeholder"
compose = (stage / "docker-compose.yml").read_text()
assert "${NOWEN_VIDEO_IMAGE}" not in compose, "unrendered image variable"
assert "docker.io/cropflre/nowen-video:latest" in compose, "missing full image"
assert "HeadersRegexp(`Sec-Fetch-Dest`, `document`)" in compose, "missing VOS top-open redirect"
assert "external: true" in compose and "vos_default" in compose, "missing VOS network"
routers = (stage / "routers.yml").read_text()
for expected in ("com-ictrek-nowen-video", "iframe-src: /app/com.ictrek.nowen-video/", "entry-point: true", "embed: true"):
    assert expected in routers, f"missing router field {expected}"
PY

tar czf "${PACKAGE_ROOT}/app.tar.gz" -C "${STAGE_DIR}" .env manifest.yml configs.yml routers.yml docker-compose.yml README.zh-CN.md
tar cf "${DIST_DIR}/${APP_NAME}_${APP_VERSION}_pull.tar" -C "${PACKAGE_ROOT}" app.tar.gz
test "$(tar tf "${DIST_DIR}/${APP_NAME}_${APP_VERSION}_pull.tar" | wc -l | tr -d ' ')" = "1"
echo "Built ${DIST_DIR}/${APP_NAME}_${APP_VERSION}_pull.tar"
