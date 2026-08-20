#!/bin/sh
# 开发容器入口：Air 监听源码并自动重编译/重启服务（ffmpeg 由 dev 镜像提供）。
set -eu

cd /app
go mod download
exec air -c .air.toml
