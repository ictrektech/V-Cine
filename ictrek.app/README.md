# Nowen Video VOS 应用打包说明

本目录包含 VOS app `com.ictrek.nowen-video` 的安装包模板。

VOS OIDC 登录会以已验签的 VOS `sub` 绑定 Nowen 账号；同名的既有本地账号会在首次 VOS 登录时自动绑定，并按 VOS 管理员身份同步为 Nowen 管理员。
发布流程以 `push_release.sh` 推送 tag 触发的 GitHub Actions 为准（`update_version.sh` 只升版本、不推 tag）。

## 镜像准备（发布前必做）

镜像**从源码构建**：
- 通用平台用 `docker/Dockerfile`（AMD64 / 通用 ARM64）；
- Jetson / L4T 用 `docker/Dockerfile.l4t`（arm64 + nvmpi）。

版本 pin 到 profile tag，并写入飞书当记录。
`package.sh` **不读飞书**——tag 直接从 `ictrek.app/VERSION` 派生；飞书仅作团队可见的发布记录。

```text
swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video:amd_${VERSION}
swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video:arm_${VERSION}
swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video:l4t_${VERSION}
```

**一次性 / 基镜像版本变动时**：把基镜像（`oven/bun:1-alpine` / `golang:1.25-alpine` / `nvidia/cuda:12.8.1-runtime-ubuntu22.04` / `ubuntu:22.04`）同步到 SWR。华为 SWR 不接受 OCI 多架构索引，所以**按架构各跑一次**，产出 `<base>-amd64` / `<base>-arm64` 分架构 tag（基镜像不进飞书）：

```bash
ssh tc232  'cd nowen-video && ./scripts/mirror_base_images.sh'   # amd64 基镜像
ssh tc192  'cd nowen-video && ./scripts/mirror_base_images.sh'   # arm64 基镜像
```

**每次发布**：**先升版本、后构建、最后推 tag**——构建机 `git pull` 后读到的 `ictrek.app/VERSION` 才是新版本，且 tag 永远在镜像就绪后才推（否则 CI 会打出一个引用了不存在镜像的包）。

```bash
cd apps/nowen-video
# ① 本地：bump VERSION + commit + 推分支（不推 tag、不触发 CI），并打本地 tag
./ictrek.app/scripts/update_version.sh

# ② 构建机上原生构建（基镜像从 SWR 拉，构建走 --pull=false），推 SWR + 写飞书
#    default profile：飞书记录写入该架构的全部 sheet（与 motrix 同一套：
#    amd → AMD_with_cuda、AMD_with_mxn100；
#    arm → ARM_without_cuda、ARM_with_cuda、l4t、thor_spark），组件列头 nowen-video
ssh tc232  'cd nowen-video && git pull && ./build_image.sh'                    # AMD64: amd_${VERSION} + 推送 + 写飞书
ssh tc192  'cd nowen-video && git pull && ./build_image.sh'                    # ARM64: arm_${VERSION} + 推送 + 写飞书
ssh <jetson>'cd nowen-video && git pull && ./build_image.sh --profile l4t'     # Jetson/L4T: l4t_${VERSION} + 推送 + 只写 l4t sheet

# ③ 本地：确认所需 profile 镜像都已 push 后，推 tag 触发 GitHub Actions 打包上架
./ictrek.app/scripts/push_release.sh
```

`build_image.sh` 的 `VERSION` 默认取 `ictrek.app/VERSION`（`--version` 覆盖）；`--profile default|l4t` 选择构建变体（默认 `default` 即 `docker/Dockerfile` + arch tag，`l4t` 即 `docker/Dockerfile.l4t` + `l4t_${VERSION}`）；`--no-push` / `--no-feishu` 用于调试。
镜像 tag 必须与 `VERSION` 一致，且**必须先于 tag 推送构建完成**（`package.sh` 只校验字符串、不校验 SWR 上是否存在）。SWR 镜像从 0.1.2 起接入；更早的 0.1.1 历史包仍指向 Docker Hub。

## 打包

发布入口是 `ictrek.app/scripts/push_release.sh`：读 `VERSION` 拼出 `vos-nowen-video-v${VERSION}`，确认镜像就绪后推 tag；GitHub Actions 收到 tag 后生成 pull 包并更新 GitHub release / VOS App Store。`update_version.sh` 只负责 bump VERSION、提交 release commit、推分支并打本地 tag，**不推 tag**。

本地 `package.sh` 只用于调试或手动验证，不会递增或写回 `VERSION`：

```bash
cd apps/nowen-video
PACKAGE_VERSION=0.1.2 ./ictrek.app/scripts/package.sh
```

产出：

```text
ictrek.app/dist/nowen-video_${VERSION}_pull.tar
```

包内为 pull 模式：只有一个 `docker-compose.yml`，含 `amd`、`arm`、`l4t` 三个 profile，镜像名写入包内 `.env`，不内嵌镜像归档。`l4t` profile 使用 `runtime: nvidia` + `privileged: true`（Jetson nvmpi 需要）。

## Profiles

| profile | 适用平台 |
| --- | --- |
| `amd` | x86_64 / AMD64 |
| `arm` | 通用 ARM64 |
| `l4t` | Jetson / L4T（Jetson Orin 等，nvmpi 硬解/硬编） |

安装时由 VOS 指定其中一个 profile。手动验证 Compose 时也只启用一个：

```bash
docker compose --profile amd config
docker compose --profile arm config
docker compose --profile l4t config
```
