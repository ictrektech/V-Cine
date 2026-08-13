# Nowen Video VOS 应用打包说明

本目录包含 VOS app `com.ictrek.nowen-video` 的安装包模板。
发布流程以 `update_version.sh` 触发的 GitHub Actions 为准。

## 镜像准备（发布前必做）

镜像**从源码构建**（`docker/Dockerfile`），版本 pin 到 arch tag，并写入飞书当记录。
`package.sh` **不读飞书**——tag 直接从 `ictrek.app/VERSION` 派生；飞书仅作团队可见的发布记录。

```text
swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video:amd_${VERSION}
swr.cn-southwest-2.myhuaweicloud.com/ictrek/nowen-video:arm_${VERSION}
```

**一次性 / 基镜像版本变动时**：把 3 个基镜像（`node` / `golang` / `alpine`）同步到 SWR。华为 SWR 不接受 OCI 多架构索引，所以**按架构各跑一次**，产出 `<base>-amd64` / `<base>-arm64` 分架构 tag（基镜像不进飞书）：

```bash
ssh tc232  'cd nowen-video && ./scripts/mirror_base_images.sh'   # amd64 基镜像
ssh tc192  'cd nowen-video && ./scripts/mirror_base_images.sh'   # arm64 基镜像
```

**每次发布**：在两台构建机上原生构建（基镜像从 SWR 拉，构建走 `--pull=false`），推 SWR 并写飞书记录。飞书记录写入该架构的全部 sheet（与 motrix 同一套：amd → `AMD_with_cuda`、`AMD_with_mxn100`；arm → `ARM_without_cuda`、`ARM_with_cuda`、`l4t`、`thor_spark`），组件列头 `nowen-video`。先在各构建机 `git pull` 取到最新的 `build_image.sh`：

```bash
cd apps/nowen-video
ssh tc232  && ./build_image.sh         # AMD64: 构建 amd_${VERSION} + 推送 + 写飞书
ssh tc192  && ./build_image.sh         # ARM64: 构建 arm_${VERSION} + 推送 + 写飞书
```

`VERSION` 默认取 `ictrek.app/VERSION`（`--version` 覆盖）；`--no-push` / `--no-feishu` 用于调试。
两个架构都构建完，再执行下面的 VOS 发布。SWR 镜像从 0.1.2 起接入；更早的 0.1.1 历史包仍指向 Docker Hub。

## 打包

发布入口是 `ictrek.app/scripts/update_version.sh`：它只更新 `VERSION`、提交 release commit、推送 `vos-nowen-video-v${VERSION}` 触发 tag；GitHub Actions 收到 tag 后生成 pull 包并更新 GitHub release / VOS App Store。

本地 `package.sh` 只用于调试或手动验证，不会递增或写回 `VERSION`：

```bash
cd apps/nowen-video
PACKAGE_VERSION=0.1.2 ./ictrek.app/scripts/package.sh
```

产出：

```text
ictrek.app/dist/nowen-video_${VERSION}_pull.tar
```

包内为 pull 模式：只有一个 `docker-compose.yml`，含 `amd` 和 `arm` 两个 profile，镜像名写入包内 `.env`，不内嵌镜像归档。

## Profiles

| profile | 适用平台 |
| --- | --- |
| `amd` | x86_64 / AMD64 |
| `arm` | ARM64 |

安装时由 VOS 指定其中一个 profile。手动验证 Compose 时也只启用一个：

```bash
docker compose --profile amd config
docker compose --profile arm config
```
