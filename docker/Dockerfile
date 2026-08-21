# =============================================
# nowen-video 生产镜像（amd64 · NVIDIA CUDA）
# 基座：nvidia/cuda:12.8.1-runtime-ubuntu22.04 (Ubuntu 22.04.5 Jammy + CUDA 12.8)
# 转码：jellyfin-ffmpeg7 (Jammy deb，含 --enable-nvenc/cuda/qsv/vaapi)
# 多阶段：前端 bun + 后端 Go 交叉编译（CGO_ENABLED=0，纯 Go pgx）
# =============================================

# =============================================
# 阶段1: 构建前端（锁定在构建机本地架构，避免 QEMU 跑 npm 极慢）
# =============================================
FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS frontend
ARG NOWEN_VERSION=0.1.0
ARG NPM_MIRROR=https://registry.npmmirror.com
ENV BUN_CONFIG_REGISTRY=${NPM_MIRROR}
ENV NPM_CONFIG_REGISTRY=${NPM_MIRROR}
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ .
ENV VITE_APP_VERSION=${NOWEN_VERSION}
RUN bun run build

# =============================================
# 阶段2: 构建后端（在构建机本地架构运行 Go 工具链，交叉编译到目标架构）
# =============================================
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend
ARG TARGETOS
ARG TARGETARCH
ARG NOWEN_VERSION=0.1.0
WORKDIR /app
ENV GOPROXY=https://goproxy.cn,https://goproxy.io,direct
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /app/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w -X github.com/nowen-video/nowen-video/internal/version.Version=${NOWEN_VERSION}" -o nowen-video ./cmd/server

# =============================================
# 阶段3: 运行镜像（NVIDIA CUDA Runtime + Jellyfin FFmpeg）
# =============================================
FROM nvidia/cuda:12.8.1-runtime-ubuntu22.04
ARG NOWEN_VERSION=0.1.0
ARG UBUNTU_MIRROR=https://mirrors.aliyun.com/ubuntu
ARG JELLYFIN_REPO=https://mirror.nju.edu.cn/jellyfin/ubuntu
ARG JELLYFIN_KEY_URL=https://repo.jellyfin.org/jellyfin_team.gpg.key

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Shanghai
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

# ---- 国内 Ubuntu 镜像加速（默认阿里云；--build-arg UBUNTU_MIRROR= 可关闭）----
# 同时兼容 /etc/apt/sources.list 与 Deb822 的 ubuntu.sources
RUN set -eux; \
    if [ -n "${UBUNTU_MIRROR}" ]; then \
        find /etc/apt -maxdepth 2 -type f \( -name 'sources.list' -o -name '*.sources' \) \
            -exec sed -i \
                -e "s|http://archive.ubuntu.com/ubuntu|${UBUNTU_MIRROR}|g" \
                -e "s|http://security.ubuntu.com/ubuntu|${UBUNTU_MIRROR}|g" \
                -e "s|https://archive.ubuntu.com/ubuntu|${UBUNTU_MIRROR}|g" \
                -e "s|https://security.ubuntu.com/ubuntu|${UBUNTU_MIRROR}|g" \
                {} +; \
    fi

# ---- 系统依赖 + Jellyfin 镜像仓库 + jellyfin-ffmpeg7 + Python 刮削 + 硬件加速驱动 ----
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        wget \
        tzdata \
        gosu \
        coreutils \
        python3 \
        python3-pip \
        python3-flask \
        python3-requests \
        python3-bs4 \
        python3-lxml \
        intel-media-va-driver \
        mesa-va-drivers \
        vainfo \
        libva2 \
        libva-drm2; \
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL "${JELLYFIN_KEY_URL}" | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg; \
    chmod 644 /etc/apt/keyrings/jellyfin.gpg; \
    printf 'Types: deb\nURIs: %s\nSuites: jammy\nComponents: main\nArchitectures: amd64 arm64\nSigned-By: /etc/apt/keyrings/jellyfin.gpg\n' "${JELLYFIN_REPO}" > /etc/apt/sources.list.d/jellyfin.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends jellyfin-ffmpeg7; \
    ln -sf /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/bin/ffmpeg; \
    ln -sf /usr/lib/jellyfin-ffmpeg/ffprobe /usr/bin/ffprobe; \
    # 验证：hwaccels 需含 cuda，encoders 需含 h264_nvenc \
    ffmpeg -hide_banner -version; \
    ffmpeg -hide_banner -hwaccels; \
    echo "--- encoders ---"; \
    ffmpeg -hide_banner -encoders | grep -E "nvenc|qsv|vaapi" || true; \
    if ! ffmpeg -hide_banner -encoders | grep -q "h264_nvenc"; then \
        echo "ERROR: jellyfin-ffmpeg missing h264_nvenc" >&2; exit 1; \
    fi; \
    rm -rf /var/lib/apt/lists/*; \
    # 兼容部分脚本仍调用 su-exec 的历史路径 \
    if [ ! -e /usr/local/bin/su-exec ] && command -v gosu >/dev/null 2>&1; then \
        ln -sf "$(command -v gosu)" /usr/local/bin/su-exec; \
    fi

RUN groupadd -r nowen && useradd -r -g nowen -s /bin/bash -m nowen

WORKDIR /app

COPY --from=backend /app/nowen-video /usr/local/bin/nowen-video
COPY --from=frontend /app/web/dist /app/web/dist
COPY scripts/adult-scraper /app/scripts/adult-scraper

RUN mkdir -p /data /cache /media \
    && chown -R nowen:nowen /data /cache /media /app/scripts

ENV NOWEN_APP_PORT=8080
ENV NOWEN_APP_DATA_DIR=/data
ENV NOWEN_APP_WEB_DIR=/app/web/dist
ENV NOWEN_CACHE_CACHE_DIR=/cache
ENV NOWEN_LOGGING_LEVEL=info
ENV NOWEN_VERSION=${NOWEN_VERSION}
ENV NOWEN_ADULT_SCRAPER_ENABLED=false
ENV NOWEN_ADULT_SCRAPER_AUTO_START_PYTHON=true
ENV NOWEN_ADULT_SCRAPER_PYTHON_EXECUTABLE=/usr/bin/python3
ENV NOWEN_ADULT_SCRAPER_PYTHON_SERVICE_DIR=/app/scripts/adult-scraper
ENV TZ=Asia/Shanghai

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/auth/login || exit 1

# entrypoint：支持 PUID/PGID 自定义用户，修复权限后切换用户运行（Ubuntu 用 gosu）
RUN printf '#!/bin/sh\n\
set -e\n\
PUID=${PUID:-$(id -u nowen)}\n\
PGID=${PGID:-$(id -g nowen)}\n\
if [ "$PUID" != "$(id -u nowen)" ] || [ "$PGID" != "$(id -g nowen)" ]; then\n\
  if getent group nowen >/dev/null 2>&1; then\n\
    groupmod -o -g "$PGID" nowen 2>/dev/null || true\n\
  else\n\
    groupadd -o -g "$PGID" nowen 2>/dev/null || true\n\
  fi\n\
  if id nowen >/dev/null 2>&1; then\n\
    usermod -o -u "$PUID" -g "$PGID" nowen 2>/dev/null || true\n\
  else\n\
    useradd -o -u "$PUID" -g "$PGID" -M -s /bin/bash nowen 2>/dev/null || true\n\
  fi\n\
fi\n\
chown -R nowen:nowen /data /cache 2>/dev/null || true\n\
chown nowen:nowen /media 2>/dev/null || true\n\
chown -R nowen:nowen /app/scripts 2>/dev/null || true\n\
if [ "$PUID" = "0" ]; then\n\
  exec nowen-video\n\
fi\n\
if command -v gosu >/dev/null 2>&1; then\n\
  exec gosu nowen nowen-video\n\
else\n\
  exec su-exec nowen nowen-video\n\
fi\n' > /entrypoint.sh \
    && chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]