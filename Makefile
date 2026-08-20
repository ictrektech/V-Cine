# nowen-video Makefile
# Dev:  docker/docker-compose.yml + .env.dev
# Prod: docker/docker-compose.yml + .env.prod
#
# 用法:
#   make dev          启动开发环境（docker compose + .env.dev）
#   make prod         启动生产环境（.env.prod，用现有镜像，不重新构建）
#   make prod-build   仅重新构建生产镜像（改代码后需执行）
#   make dev-down     停止开发环境
#   make prod-down    停止生产环境
#   make dev OPTS=-d  后台运行；默认前台（看日志）
#
# compose 在 docker/ 目录（-f 指定），.env 在项目根（--env-file 相对 cwd）

# 镜像 registry 与仓库路径（与 docker-compose.yml 的 ${IMAGE_URL} 保持一致）
REGISTRY   ?= swr.cn-southwest-2.myhuaweicloud.com/ictrek
IMAGE_NAME ?= nowen-video
IMAGE_URL  ?= $(REGISTRY)/$(IMAGE_NAME)

# 所有 compose 命令导出 IMAGE_URL，build/up/tag 使用同一镜像名
COMPOSE := IMAGE_URL=$(IMAGE_URL) docker compose -f docker/docker-compose.yml
# 开发叠加 dev.yml：容器内 go run（改代码重启即生效，免每次重建镜像）
DEV_COMPOSE := $(COMPOSE) -f docker/docker-compose.dev.yml

DEV_ENV_FILE := .env.dev
PROD_ENV_FILE := .env.prod
DEV_CMD := $(DEV_COMPOSE) --env-file $(DEV_ENV_FILE)
PROD_CMD := $(COMPOSE) --env-file $(PROD_ENV_FILE)

# 传给 compose 的额外参数（默认前台；后台运行用 make dev OPTS=-d）
OPTS ?=

VERSION ?= $(shell git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null | sed 's/^v//' || echo 0.1.0)
GO_VERSION_PKG := github.com/nowen-video/nowen-video/internal/version.Version
GO_LDFLAGS := -s -w -X $(GO_VERSION_PKG)=$(VERSION)

# 镜像版本 tag：<平台>_<日期>_<git短哈希>（参考 video-instruction，多平台互不覆盖）
GIT_HASH   := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date +%Y%m%d)
HOST_ARCH  := $(shell uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
# 跨平台构建：make build 默认构建本机架构；make build ARCH=arm64 构建 arm 镜像
ARCH      ?= $(HOST_ARCH)
PLATFORM  := $(ARCH)
BUILD_TAG := $(PLATFORM)_$(BUILD_DATE)_$(GIT_HASH)
PLATFORM_GOAL := linux/$(ARCH)

# 默认：只打印帮助，不触发任何构建（build 走 Docker 较慢，不应由裸 make 隐式启动）
.DEFAULT_GOAL := help
all: help

help:
	@echo "nowen-video Makefile"
	@echo ""
	@echo "  make dev          启动开发环境（.env.dev，前台；OPTS=-d 后台）"
	@echo "  make dev-down     停止开发环境"
	@echo "  make prod         启动生产环境（.env.prod，前台；OPTS=-d 后台）"
	@echo "  make prod-build   仅重新构建生产镜像（改代码后执行）"
	@echo "  make prod-down    停止生产环境"
	@echo "  make build        构建镜像 + 打版本 tag（ARCH=arm64 可跨平台构建；BUILD_PROXY=http://ip:port 走代理）"
	@echo "  make push         推送镜像到 registry（版本 tag + latest-平台）"
	@echo "  make dev-go       go run 本地启动后端（调试模式，端口 38080）"
	@echo "  make dev-web       启动前端 dev server（33000 → 38080）"
	@echo "  make build-binary  构建本地二进制到 bin/nowen-video"
	@echo "  make build-web     仅构建前端"
	@echo "  make build-server  仅构建后端二进制"
	@echo "  make run           构建并运行本地二进制"
	@echo "  make clean         清理 bin/ / cache/transcode / web/dist"
	@echo "  make install-web   安装前端依赖"
	@echo "  make tidy          go mod tidy"

# ==================== Dev ====================

.PHONY: dev dev-down dev-logs dev-ps

dev:       ## [Dev] 启动开发环境（默认后台，OPTS= 可前台）
	$(DEV_CMD) up $(OPTS)
dev-down:  ## [Dev] 停止开发环境
	$(DEV_CMD) down
dev-logs:  ## [Dev] 查看开发环境日志
	$(DEV_CMD) logs -f
dev-ps:    ## [Dev] 查看开发环境状态
	$(DEV_CMD) ps
dev-build: ## [Dev] 重新构建 dev 镜像（改 docker/Dockerfile.dev 后执行）
	$(DEV_CMD) build nowen-video

# ==================== Prod ====================

.PHONY: prod prod-build prod-down prod-logs

prod:      ## [Prod] 启动生产环境（默认后台，用现有镜像，OPTS= 可前台）
	$(PROD_CMD) up $(OPTS)
prod-build: ## [Prod] 构建生产镜像并打版本 tag
	$(PROD_CMD) build \
		&& docker tag $(IMAGE_URL):latest $(IMAGE_URL):$(BUILD_TAG) \
		&& docker tag $(IMAGE_URL):latest $(IMAGE_URL):latest-$(PLATFORM) \
		&& echo "✅ Tagged: $(IMAGE_URL):$(BUILD_TAG)"
prod-down: ## [Prod] 停止生产环境
	$(PROD_CMD) down
prod-logs: ## [Prod] 查看生产环境日志
	$(PROD_CMD) logs -f

# ==================== 构建 ====================

.PHONY: build push build-binary build-server build-web

# Docker 镜像（项目主交付物；纯 Go，CGO=0 交叉编译由 Dockerfile 负责）
# 用 buildx 跨平台构建：默认本机架构，make build ARCH=arm64 构建 arm 镜像。
# 使用默认 docker driver（在 daemon 上构建）：复用本地已缓存 base 镜像 + 走
# daemon 的 registry-mirror，绕开 Docker Hub 直连（国内网络必要）。
# 可选代理：make build BUILD_PROXY=http://10.144.144.10:4067 时向 RUN 步骤注入
# HTTP(S)_PROXY，用于构建时拉取加速（如 Docker Hub / pip / npm）。默认不设代理
# （本地直连更快；慢主要是 QEMU 模拟 arm64 的 CPU 开销，代理帮不上）。
# 产物打 <平台>_<日期>_<git哈希> 版本 tag + latest-<平台>。
BUILD_PROXY ?=
# comma 变量：make 的 $(if) 以逗号分参，NO_PROXY 里的逗号必须用变量注入
comma := ,
PROXY_ARGS := $(if $(BUILD_PROXY),--build-arg HTTP_PROXY=$(BUILD_PROXY) --build-arg HTTPS_PROXY=$(BUILD_PROXY) --build-arg NO_PROXY=localhost$(comma)127.0.0.1$(comma))
# Alpine 镜像源：未设置则用 Dockerfile ARG 默认（阿里云）；换源 make build ALPINE_MIRROR=...
ALPINE_MIRROR ?=
MIRROR_ARGS := $(if $(ALPINE_MIRROR),--build-arg ALPINE_MIRROR=$(ALPINE_MIRROR))
build:
	docker buildx build --platform $(PLATFORM_GOAL) --load \
		-f docker/Dockerfile -t $(IMAGE_URL):latest \
		--build-arg NOWEN_VERSION=$(VERSION) \
		$(MIRROR_ARGS) \
		$(PROXY_ARGS) \
		. \
		&& docker tag $(IMAGE_URL):latest $(IMAGE_URL):$(BUILD_TAG) \
		&& docker tag $(IMAGE_URL):latest $(IMAGE_URL):latest-$(PLATFORM) \
		&& echo "✅ 镜像已构建并打 tag: $(IMAGE_URL):$(BUILD_TAG) / latest-$(PLATFORM)"

# 推送镜像到 registry（版本 tag + 平台 latest）
push:
	docker push $(IMAGE_URL):$(BUILD_TAG)
	docker push $(IMAGE_URL):latest-$(PLATFORM)
	@echo "✅ Pushed: $(IMAGE_URL):$(BUILD_TAG) / latest-$(PLATFORM)"

# ==================== 跨平台构建辅助 ====================

.PHONY: binfmt

# 安装跨平台 QEMU binfmt（默认 docker driver 跨架构构建需要；daemon 已配置则跳过）
binfmt:
	@docker run --rm --privileged tonistiigi/binfmt --install all 2>/dev/null || echo "binfmt 已安装或无需安装"

# 本地二进制（快速调试用；CGO_ENABLED=0：无 cgo 依赖，与 Dockerfile 一致）
build-binary: build-web
	CGO_ENABLED=0 NOWEN_VERSION=$(VERSION) go build -ldflags "$(GO_LDFLAGS)" -o bin/nowen-video ./cmd/server

# 仅后端二进制
build-server:
	CGO_ENABLED=0 NOWEN_VERSION=$(VERSION) go build -ldflags "$(GO_LDFLAGS)" -o bin/nowen-video ./cmd/server

# 仅前端
build-web:
	cd web && VITE_APP_VERSION=$(VERSION) bun run build

# ==================== 本地开发（不走 Docker）====================

.PHONY: dev-go dev-web run

# go run 本地启动后端（调试模式，端口 38080）
dev-go:
	NOWEN_APP_ENV=development NOWEN_DEBUG=true NOWEN_VERSION=$(VERSION) go run -ldflags "$(GO_LDFLAGS)" ./cmd/server

# 前端 dev server（33000 → 38080）
dev-web:
	cd web && WEB_PORT=33000 VITE_API_PROXY_TARGET=http://localhost:38080 VITE_APP_VERSION=$(VERSION) npm run dev

# 运行本地二进制（生产模式）
run: build-binary
	./bin/nowen-video

# ==================== 维护 ====================

.PHONY: clean install-web tidy

clean:
	rm -rf bin/
	rm -rf cache/transcode/
	cd web && rm -rf dist/ node_modules/

install-web:
	cd web && bun install

tidy:
	go mod tidy
