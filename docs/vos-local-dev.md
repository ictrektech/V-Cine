# VOS 平台内本地联调（免 git push / 免推镜像 / 免重装应用）

## 痛点

之前和 VOS 平台联调只能走完整交付链：

```
改代码 → git push → 构建机上 git pull && ./build_image.sh（构建镜像推 SWR）
       → ./update_version 触发 CI 打包上架 → 平台内重装应用
```

一轮几分钟起步，且 OIDC 免登、`/app/com.ictrek.v-cine` 子路径、iframe 注入这些
平台集成行为必须在平台内才验证得到，本机 `make dev`（38080 根路径）测不出来。

## 方案一（推荐）：dev 容器顶替平台上已安装的应用

开发机上已有一套 `make dev` 的开发容器（源码挂载 + air 热重载 + ffmpeg）。
本方案让这套容器 + 一个 vite dev server 直接顶替平台上已安装的 V-Cine，
**只改一条 Traefik 路由**，两端都热加载：

```
浏览器 / 平台 iframe   /app/com.ictrek.v-cine/...
        │
   VOS Traefik（file provider，/data/vos/traefik/dynamic-conf/）
        ├── com.ictrek.v-cine.dev.yml   （临时，priority 2000/3000，make vos-dev 写入）
        │        ├─ 默认          → 172.17.0.1:38087 → vite dev server（HMR，/api 反代给 38086）
        │        └─ VOS_DEV_WEB=0 → 172.17.0.1:38086 → dev 容器里的 web/dist-vos 产物
        └── com.ictrek.v-cine.yml       （平台正式路由，安装应用时生成）
                 └─→ 172.17.0.1:38085 → 平台上已安装的 V-Cine（全程不动）

   38086 的 dev 容器里跑 air，Go 代码热重载；vite 模式下 38086 只提供 /api
```

### 用法

```bash
make vos-dev          # 一条命令：起后端(air) + 前端(vite)，装好路由，前台跟随日志
# 在 VOS 平台侧边栏点开 V-Cine（或刷新平台内 iframe）→ 走的就是本机 dev 环境
# 首次要等 air 全量编译，日志出现「就绪」后即可打开页面
# Ctrl-C 退出 → 停两端 + 注销路由（等价于 make vos-dev-down），平台立刻回到已安装应用

make vos-dev-status   # 另开终端：看容器 / 前端进程 / 路由 / 健康状态
make vos-dev-logs     # 只跟容器日志
make vos-dev-down     # 不在会话里时的收尾手段（撤路由 + 断网 + 停容器）
```

前端有两种模式，默认第一种：

| 模式 | 命令 | 启动 | 改完前端 | 说明 |
| --- | --- | --- | --- | --- |
| **vite dev server（默认）** | `make vos-dev` | **~300ms** | **HMR，保存即热更新** | 跑 dev 转换结果，非线上产物 |
| 保真（产物） | `VOS_DEV_WEB=0 make vos-dev` | ~13s 全量构建 | 重跑一次 + 刷页面 | 跑的就是线上那份产物 |

保真模式下想"保存即生效"，另开终端常驻 `make vos-dev-web-watch`（增量约 1s，仍需刷页面）。
gin 是按请求读盘的（`cmd/server/main.go` 的 `r.Static` + `NoRoute`），重建后无需重启容器。

用标记头分辨当前走的是哪条路（DevTools → Network → `/app/com.ictrek.v-cine/api/*`）：

| `X-VCine-Dev` | 含义 |
| --- | --- |
| `vite` | 走 vite dev server（默认模式） |
| `1` | 走 `web/dist-vos` 产物（`VOS_DEV_WEB=0`） |
| 无该头 | 走平台上已安装的应用（临时路由已注销） |

日常迭代：

- 改后端 Go 代码：air 自动重编译重启，浏览器刷新即可，**无需任何命令**；
- 改前端 TS/TSX：默认模式 HMR 自动生效，**也无需任何命令**；保真模式下重跑 `make vos-dev`
  或让 `make vos-dev-web-watch` 常驻；
- 只想临时把平台流量切回正式应用：`make vos-dev-route-off`，切回用 `make vos-dev-route-on`
  （它装的是 dist 产物模式）。

> 保真模式不是 HMR：静态产物最多做到"自动重新打包"，仍是整页刷新；也不跑 `tsc`，
> 类型错误不中断构建（要类型反馈另开 `cd web && bunx tsc -b --watch`）。

> **默认模式下仍会保留 `web/dist-vos`**：容器启动时会校验 `$VCINE_APP_WEB_DIR/index.html`
> 存在（`cmd/server/main.go`，缺了直接 fatal），所以产物缺失时会构建一次；已存在就直接复用，
> 不再重复构建。该产物在默认模式下不被服务，只为过校验。

> vite 默认只放行 `localhost` / IP 访问，若平台是用**域名**打开的会返回 403。脚本固定传
> `VITE_ALLOWED_HOSTS=true` 放行（见 `web/vite.config.ts` 与脚本的 `start_vite_bg`）。

自检（确认平台链路已指向 dev 容器）：

```bash
# 平台 Traefik 入口（HTTP 内部 / HTTPS）：走 dev 时 version 是本机版本（0.1.0），
# 走平台已安装应用时是正式版本号（如 0.1.38），两者的 lan_ips 也不同
curl -s http://127.0.0.1:1182/app/com.ictrek.v-cine/api/health
curl -sk https://127.0.0.1:1180/app/com.ictrek.v-cine/api/health

# 最省事的判据：临时 dev 路由会加标记响应头 X-VCine-Dev: 1
curl -sI http://127.0.0.1:1182/app/com.ictrek.v-cine/api/health | grep -i x-vcine-dev
```

浏览器里同理：DevTools → Network → 任一条 `/app/com.ictrek.v-cine/api/*` 的
Response Headers 有 **`X-VCine-Dev: 1`** = 走 dev 容器；没有 = 走平台上已安装的应用。
该标记头由 `docker/vos-dev/traefik.dev.yml.tmpl` 里的 `v-cine-dev-marker` 中间件添加，
只存在于临时路由文件中，`route-off` / `vos-dev-down` 后即消失，不影响平台正式路由。

### 它为什么能"在平台内"工作

1. **同源**：iframe 地址是 `/app/com.ictrek.v-cine/`（`routers.yml` 的 `iframe-src`），
   只要这条前缀经 Traefik 返回你的 dev 容器，浏览器视角仍是平台同域；
   平台前端在 iframe `onload` 时把 `window.vos_platform`（OIDC Fastpath bridge）直接
   `Object.defineProperty` 到同源 `contentWindow`——**注入是浏览器行为，与后端是谁无关**。
2. **子路径**：dev 容器用与正式安装一致的子路径配置：
   - 后端 `VCINE_APP_WEB_BASE_PATH=/app/com.ictrek.v-cine`（http.Server 层剥离前缀）；
   - 前端构建期 `VITE_BASE=/app/com.ictrek.v-cine/`（脚本产出到 `web/dist-vos`，
     由 `VCINE_APP_WEB_DIR` 指向，不污染普通 dev 的 `web/dist`）。
3. **同一套后端依赖**：连平台共享 PGV（`172.17.0.1:25432`）、验平台 JWKS
   （`http://172.17.0.1:8105/v1000/oauth2/jwks`）、挂同一媒体库与 exposed 目录
   （路径由脚本从已安装容器动态读取，VOS share uid 变了也不用改代码）。
   所以账号、媒体库、播放链路与正式安装完全一致。

### 关键取舍：**不要 stop 平台上已安装的应用**

平台后端有 60s 周期的资源就绪收敛（`resource_dependency/reconcile`），对已安装应用会
反复执行 `docker compose up -d --remove-orphans`：手动 `docker stop` 的容器会被自动拉起。
因此本方案**不碰平台容器**，只装一条优先级更高的临时路由；dev 容器用独立宿主端口
（38086，`VOS_DEV_PORT` 可改）。

### 网络：dev 容器叫 `nowen-video-dev`，与生产完全隔离

dev 容器用独立容器名 **`nowen-video-dev`**（`docker/docker-compose.vos-dev.yml`），并由脚本以

```bash
docker network connect --alias nowen-video-dev nowen-video-dev vos_default
```

手工接进平台网络（不写进 compose）。手工 connect 只写入指定别名，所以 `vos_default` 上
**只有 `nowen-video-dev`**，不会出现第二个 `nowen-video` —— 平台已安装应用与平台内其他应用
完全不受影响。实测：

| 名字（在 `vos_default` 内） | 解析到 |
| --- | --- |
| `nowen-video` | 192.168.64.21（平台上已安装的 V-Cine，唯一） |
| `nowen-video-dev` | 192.168.64.22（本仓库 dev 容器，唯一） |

互通方式：

| 方向 | 用法 |
| --- | --- |
| dev → 平台应用 | 直接用别名：`pgv`、`traefik`、`vivibit-web-business`、`model-hub-backend`… |
| 平台应用 → dev | **`nowen-video-dev:8080`**（容器内端口对齐生产的 8080） |
| 用别名连共享库 | `VOS_DEV_DB_HOST=pgv make vos-dev`（默认走宿主 `172.17.0.1:25432`） |

- `vos_default` 始终是平台自己的网络：脚本只是 `network connect/disconnect`，**不会**创建或删除它。
- 不需要入网时：`VOS_DEV_JOIN_VOS_NETWORK=0 make vos-dev`（平台内 iframe 联调不受影响）。
- 如果用其他 compose 命令重建了 dev 容器（例如又跑了一次 `make dev`），入网会随容器消失，
  重新执行 `make vos-dev` 即可（脚本会检查并补齐）。

### 可调环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VOS_DEV_PORT` | `38086` | dev 容器宿主端口（不要用 38085，那是正式安装的端口） |
| `VOS_DEV_CONTAINER` | `nowen-video-dev` | dev 容器名 |
| `VOS_DEV_JOIN_VOS_NETWORK` | `1` | 是否加入平台网络 `vos_default` |
| `VOS_DEV_NETWORK` / `VOS_DEV_NETWORK_ALIAS` | `vos_default` / `nowen-video-dev` | 入网的网络名与别名 |
| `VOS_HOST_GW_IP` | `172.17.0.1` | Docker 网关（平台服务/共享 PGV 入口） |
| `VOS_PGV_PORT` | `25432` | 平台 PGV 宿主端口 |
| `VOS_DEV_DB_HOST` | `172.17.0.1` | 设为 `pgv` 即用网络别名连库 |
| `VOS_DEV_DB_NAME` | `nowen_video` | 默认与平台应用共用同一个库 |
| `VOS_TRAEFIK_CONTAINER` | `traefik` | 平台 Traefik 容器名 |
| `VOS_APP_MATCH` | `name=nowen-video-amd` | 平台已安装应用容器筛选条件 |
| `VOS_DEV_HEALTH_TIMEOUT` | `300` | 等 dev 容器就绪的秒数（air 首次编译慢） |

## 方案二：本地安装包（验证平台安装/升级流程时用）

平台官方支持从本地安装包安装，无需经过 App Store / git push：

```bash
# 1) 本机构建镜像（不推送 registry）
./build_image.sh --no-push --no-feishu

# 2) 生成 pull 包（package.sh 会读飞书拿各 profile 镜像 tag，本地调试可手写 .env）
PACKAGE_VERSION=0.1.38 ./ictrek.app/scripts/package.sh

# 3) 本地安装（CLI 支持 .tar / .tar.gz / 已解压目录）
vos-platform-cli app install-local --package-path ictrek.app/dist/v-cine_0.1.38_pull.tar
```

对应平台接口 `POST /v1000/app/install_local[_async]`（需权限 `platform:app:install`）。
适合验证 **安装/升级/路由注册/profile 选择** 这类平台流程；单改业务代码时太慢，用方案一。

> 更彻底的做法是把镜像做成 `assets/amd64/*.tar`（`kind: docker-archive`）离线包，
> 由平台 `docker load` 导入，连镜像仓库都不用推；但每次仍要重建镜像，迭代速度不如方案一。

## 排错

| 现象 | 排查 |
| --- | --- |
| 平台内仍显示旧版本 | 先看响应头有无 `X-VCine-Dev: 1`（= 是否走在 dev 路由上）；再看 `make vos-dev-status` 的临时路由是否存在、是否被 `route-off`；Traefik file provider 热加载有 1~2s 延迟，可强刷 iframe |
| 平台内 502 | dev 容器没起来（air 编译中/报错）：`make vos-dev-logs`；`up` 只在健康后才切流量 |
| 前端白屏 / 资源 404 | 确认是 `make vos-dev` 构建的 `web/dist-vos`（带 `VITE_BASE`），不要用 `make build-web` 的 `web/dist` 覆盖 |
| OIDC 不生效、要求输账号密码 | iframe 跨域（bridge 只在同源注入）：确认访问地址是 `/app/com.ictrek.v-cine/` 而不是 `:38086` 直连 |
| 库里数据不对 | 默认共用平台 PGV（`VOS_DEV_DB_NAME=nowen_video`）；想隔离迁移实验可换独立库名 |
| 其他应用访问不到 dev 容器 | 用容器名/别名 `nowen-video-dev:8080`（不是 `nowen-video`）；确认 `make vos-dev-status` 里 dev 容器已列出 `vos_default` |

## 注意事项

- 临时路由文件 `com.ictrek.v-cine.dev.yml` 只由本仓库脚本管理；平台的正式路由文件
  `com.ictrek.v-cine.yml` 由平台在安装/升级时重写，两者互不影响（中间件在 dev 文件内自带一份）。
- `make vos-dev-down` 会删掉临时路由文件，平台立即回到已安装应用；**不需要**重启 Traefik。
- 共用同一个数据库时，dev 分支上的新迁移会作用在平台应用也在用的库上；如需隔离，用
  `VOS_DEV_DB_NAME=<独立库名>`（该库需已由 PGV provision 或手动建好 pgvector 扩展）。
- 卸载平台上这个应用后，请一并 `make vos-dev-down`（否则临时路由还会把
  `/app/com.ictrek.v-cine` 指向本机 dev 容器，但平台侧已无入口菜单）。
