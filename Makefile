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

DEV_ENV_FILE := .env.dev
PROD_ENV_FILE := .env.prod
DEV_CMD := $(COMPOSE) --env-file $(DEV_ENV_FILE)
PROD_CMD := $(COMPOSE) --env-file $(PROD_ENV_FILE)

# 传给 compose 的额外参数（默认前台；后台运行用 make dev OPTS=-d）
OPTS ?=

VERSION ?= $(shell git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null | sed 's/^v//' || echo 0.1.0)
GO_VERSION_PKG := github.com/nowen-video/nowen-video/internal/version.Version
GO_LDFLAGS := -s -w -X $(GO_VERSION_PKG)=$(VERSION)

# 镜像版本 tag：<平台>_<日期>_<git短哈希>（参考 video-instruction，多平台互不覆盖）
GIT_HASH   := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date +%Y%m%d)
PLATFORM   := $(shell uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
BUILD_TAG  := $(PLATFORM)_$(BUILD_DATE)_$(GIT_HASH)

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
	@echo "  make build        构建镜像 + 打版本 tag（平台_日期_哈希）"
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
# 构建后打 <平台>_<日期>_<git哈希> 版本 tag + latest-<平台>（参考 video-instruction）
# 用 && 串联：build 失败则中止，不打错误 tag
build:
	$(COMPOSE) build \
		&& docker tag $(IMAGE_URL):latest $(IMAGE_URL):$(BUILD_TAG) \
		&& docker tag $(IMAGE_URL):latest $(IMAGE_URL):latest-$(PLATFORM) \
		&& echo "✅ 镜像已构建并打 tag: $(IMAGE_URL):$(BUILD_TAG) / latest-$(PLATFORM)"

# 推送镜像到 registry（版本 tag + 平台 latest）
push:
	docker push $(IMAGE_URL):$(BUILD_TAG)
	docker push $(IMAGE_URL):latest-$(PLATFORM)
	@echo "✅ Pushed: $(IMAGE_URL):$(BUILD_TAG) / latest-$(PLATFORM)"

# 本地二进制（快速调试用；CGO_ENABLED=0：无 cgo 依赖，与 Dockerfile 一致）
build-binary: build-web
	CGO_ENABLED=0 NOWEN_VERSION=$(VERSION) go build -ldflags "$(GO_LDFLAGS)" -o bin/nowen-video ./cmd/server

# 仅后端二进制
build-server:
	CGO_ENABLED=0 NOWEN_VERSION=$(VERSION) go build -ldflags "$(GO_LDFLAGS)" -o bin/nowen-video ./cmd/server

# 仅前端
build-web:
	cd web && VITE_APP_VERSION=$(VERSION) npm run build

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
	cd web && npm install

tidy:
	go mod tidy
