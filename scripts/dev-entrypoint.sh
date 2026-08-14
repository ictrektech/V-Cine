#!/bin/sh
# 开发容器入口：编译并运行当前源码（ffmpeg 由 dev 镜像提供）。
set -eu

cd /app
go mod download
exec go run -ldflags "-s -w" ./cmd/server
