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

[[ "${APP_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid version: ${APP_VERSION}" >&2; exit 1; }
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
NOWEN_VIDEO_L4T_IMAGE=${IMAGE_REPO}:l4t_${APP_VERSION}
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
assert "${NOWEN_VIDEO_L4T_IMAGE}" not in compose, "unrendered l4t image variable"
assert f"{repo}:amd_{version}" in compose, "missing amd image tag"
assert f"{repo}:arm_{version}" in compose, "missing arm image tag"
assert f"{repo}:l4t_{version}" in compose, "missing l4t image tag"
assert "runtime: nvidia" in compose, "missing nvidia runtime for l4t"
assert "privileged: true" in compose, "missing privileged for l4t"
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
