#!/usr/bin/env bash
# scripts/vos-dev.sh — VOS 平台内联调（免 git push / 免构建推镜像 / 免重装应用）
#
# 让本机 dev 环境顶替 VOS 平台上已安装的 v-cine，一条命令起两端、两端都热加载：
#   Traefik /app/com.ictrek.v-cine
#     ├─ 临时 dev 路由（priority 更高）
#     │    ├─ 默认          → 宿主 38087 → vite dev server（HMR，~300ms 起）
#     │    └─ VOS_DEV_WEB=0 → 宿主 38086 → dev 容器里的 web/dist-vos 产物（保真）
#     └─ 平台正式路由        → 宿主 38085 → 平台上已安装的应用（全程不动）
#
# 用法：
#   scripts/vos-dev.sh up         起后端(air)+前端(vite)，装临时路由，前台跟随日志（= make vos-dev）
#                                 Ctrl-C 统一收尾；VOS_DEV_WEB=0 时前端改用 dist 产物
#   scripts/vos-dev.sh down       撤临时路由 + 断网 + 停 dev 容器（= make vos-dev-down）
#   scripts/vos-dev.sh route-on   只装临时路由（dist 模式；vite 模式由 up 装）
#   scripts/vos-dev.sh route-off  只撤临时路由（流量切回平台已安装应用）
#   scripts/vos-dev.sh status     查看容器/前端/路由/健康状态
#   scripts/vos-dev.sh logs       跟踪 dev 容器日志
#   scripts/vos-dev.sh web-watch  只重建前端产物到 web/dist-vos（保真模式下用）
#
# 可覆盖的环境变量：
#   VOS_DEV_PORT(38086)  VOS_HOST_GW_IP(172.17.0.1)  VOS_PGV_PORT(25432)
#   VOS_TRAEFIK_CONTAINER(traefik)  VOS_APP_MATCH(name=nowen-video-amd)
#   VOS_DEV_CONTAINER(nowen-video-dev)
#   VOS_DEV_WEB(1)                  1=前端跑 vite dev server；0=改用 web/dist-vos 产物（保真）
#   VOS_DEV_WEB_PORT(38087)         vite dev server 宿主端口
#   VOS_DEV_DB_NAME(nowen_video)    VOS_DEV_DB_HOST  VOS_DEV_MEDIA_PATH  VOS_DEV_EXPOSED_PATH
#   VOS_DEV_JOIN_VOS_NETWORK(1)     VOS_DEV_NETWORK(vos_default)  VOS_DEV_NETWORK_ALIAS(nowen-video-dev)
#   VOS_DEV_HEALTH_TIMEOUT(300)     等待 dev 容器健康的秒数（air 首次编译较慢）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_ID="com.ictrek.v-cine"
BASE_PATH="/app/${APP_ID}"
DEV_PORT="${VOS_DEV_PORT:-38086}"
WEB_DEV_PORT="${VOS_DEV_WEB_PORT:-38087}"   # vite dev server 的宿主端口
HOST_GW="${VOS_HOST_GW_IP:-172.17.0.1}"
TRAEFIK_CONTAINER="${VOS_TRAEFIK_CONTAINER:-traefik}"
ROUTE_DIR="${VOS_TRAEFIK_DYNAMIC_DIR:-/etc/traefik/dynamic-conf}"   # traefik 容器内路径
ROUTE_FILE="${ROUTE_DIR}/${APP_ID}.dev.yml"
ROUTE_TMPL="docker/vos-dev/traefik.dev.yml.tmpl"            # 两种模式共用，上游/标记头由脚本渲染
APP_MATCH="${VOS_APP_MATCH:-name=nowen-video-amd}"                 # 平台安装的 v-cine 容器
DEV_CONTAINER="${VOS_DEV_CONTAINER:-nowen-video-dev}"              # 本仓库 vos-dev 容器名
WEB_DIST="dist-vos"
ENV_FILE=".env.dev"
VOS_NETWORK="${VOS_DEV_NETWORK:-vos_default}"
NETWORK_ALIAS="${VOS_DEV_NETWORK_ALIAS:-nowen-video-dev}"

log()  { printf '\033[36m[vos-dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[vos-dev] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m[vos-dev][ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

COMPOSE_FILES=(
  -f docker/docker-compose.yml
  -f docker/docker-compose.dev.yml
  -f docker/docker-compose.vos-dev.yml
)

compose() {
  docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" "$@"
}

# 平台已安装的 v-cine 应用容器（dev 容器名是 nowen-video-dev，不会被该 filter 命中）
installed_app_container() {
  docker ps -q --filter "$APP_MATCH" 2>/dev/null | head -1
}

# dev 容器当前加入的网络列表
dev_networks() {
  docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$DEV_CONTAINER" 2>/dev/null || true
}

# 入网：手工 connect 而不是写进 compose，可精确控制别名（只写 nowen-video-dev）
cmd_net_join() {
  if [ "${VOS_DEV_JOIN_VOS_NETWORK:-1}" = "0" ]; then
    log "已跳过平台网络（VOS_DEV_JOIN_VOS_NETWORK=0）：dev 容器只在自身网络"
    return 0
  fi
  if ! docker network inspect "$VOS_NETWORK" >/dev/null 2>&1; then
    warn "未找到 Docker 网络 ${VOS_NETWORK}：dev 容器只在自身网络，跨应用直连不可用"
    return 0
  fi
  case " $(dev_networks) " in
    *" ${VOS_NETWORK} "*) log "已在平台网络 ${VOS_NETWORK}（别名 ${NETWORK_ALIAS}）"; return 0 ;;
  esac
  docker network connect --alias "$NETWORK_ALIAS" "$VOS_NETWORK" "$DEV_CONTAINER"
  log "已加入平台网络 ${VOS_NETWORK}，别名 ${NETWORK_ALIAS}（vos_default 上不会出现 nowen-video，不干扰已安装应用）"
}

# 退网：容器被 compose 重建前先摘掉平台网络
cmd_net_leave() {
  case " $(dev_networks) " in
    *" ${VOS_NETWORK} "*) docker network disconnect -f "$VOS_NETWORK" "$DEV_CONTAINER" 2>/dev/null || true ;;
  esac
}

# 读取已安装容器某个挂载点在宿主的真实路径（VOS 的 share uid 会变，不能硬编码）
mount_source() {
  docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Source}}{{end}}{{end}}" "$1" 2>/dev/null
}

# $1 为空 = 一次性构建；--watch = 常驻监听，改前端即重建产物
build_web() {
  local mode="${1:-}"
  if [ -n "$mode" ]; then
    log "前端 watch：VITE_BASE=${BASE_PATH}/ → web/${WEB_DIST}（保存即重建，Ctrl-C 退出）"
  else
    log "构建前端：VITE_BASE=${BASE_PATH}/ → web/${WEB_DIST}（避免污染普通 dev 的 web/dist）"
  fi
  [ -d web/node_modules ] || (cd web && bun install)
  (cd web && VITE_BASE="${BASE_PATH}/" bunx vite build --outDir "$WEB_DIST" $mode)
}

cmd_route_on() {
  local mode="${1:-dist}" port marker
  case "$mode" in
    dist) port="$DEV_PORT";     marker="1" ;;
    vite) port="$WEB_DEV_PORT"; marker="vite" ;;
    *) die "未知路由模式：$mode（dist|vite）" ;;
  esac
  [ -f "$ROUTE_TMPL" ] || die "缺少路由模板 $ROUTE_TMPL"
  if ! docker ps --format '{{.Names}}' | grep -qx "$TRAEFIK_CONTAINER"; then
    warn "未发现 Traefik 容器 ${TRAEFIK_CONTAINER}：临时路由未写入，仅能本机直连 :${port}${BASE_PATH}/"
    return 0
  fi
  sed -e "s|__UPSTREAM__|${HOST_GW}:${port}|g" -e "s|__MARKER__|${marker}|g" "$ROUTE_TMPL" \
    | docker exec -i "$TRAEFIK_CONTAINER" sh -c "cat > '${ROUTE_FILE}'"
  log "已写入临时路由 ${ROUTE_FILE}（模式 ${mode}，上游 ${HOST_GW}:${port}；route-off 即回退）"
}

cmd_route_off() {
  docker ps --format '{{.Names}}' | grep -qx "$TRAEFIK_CONTAINER" || return 0
  docker exec -i "$TRAEFIK_CONTAINER" sh -c "rm -f '${ROUTE_FILE}'"
  log "已删除临时路由 ${ROUTE_FILE}，流量回到平台上已安装的应用（38085）"
}

# 等 dev 容器健康（air 首次全量编译可能要几分钟）。返回 0 = 健康。
wait_healthy() {
  local timeout="${VOS_DEV_HEALTH_TIMEOUT:-300}" waited=0
  local url="http://127.0.0.1:${DEV_PORT}${BASE_PATH}/api/health"
  while [ "$waited" -lt "$timeout" ]; do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then
      [ "$waited" -gt 0 ] && echo
      return 0
    fi
    printf '\r\033[36m[vos-dev]\033[0m 等待 dev 容器就绪（air 编译中）… %ss/%ss' "$waited" "$timeout"
    sleep 5
    waited=$((waited + 5))
  done
  echo
  return 1
}

VITE_PID=""

# 用 node 直接跑 vite 的 bin：$! 即 vite 本体，bunx 会夹一层包装进程杀不干净
kill_vite() {
  [ -n "$VITE_PID" ] || return 0
  kill "$VITE_PID" 2>/dev/null || true
  wait "$VITE_PID" 2>/dev/null || true
  VITE_PID=""
}

# Traefik 路由写死了 WEB_DEV_PORT，而 vite 默认在端口被占时会自己 +1 换一个 →
# 路由会指向没人监听的端口。所以先探（bash 内建 /dev/tcp）后报错，vite 侧再传 --strictPort 兜底。
ensure_web_port_free() {
  if (exec 3<>"/dev/tcp/127.0.0.1/${WEB_DEV_PORT}") 2>/dev/null; then
    die "端口 ${WEB_DEV_PORT} 已被占用（多半是残留的 vite 进程）。先关掉它，或换端口：VOS_DEV_WEB_PORT=38089 make vos-dev"
  fi
}

start_vite_bg() {
  [ -d web/node_modules ] || (cd web && bun install)
  ensure_web_port_free
  log "启动 vite dev server：http://127.0.0.1:${WEB_DEV_PORT}${BASE_PATH}/（HMR；日志与 air 共用本终端）"
  (
    cd web
    VITE_BASE="${BASE_PATH}/" WEB_PORT="$WEB_DEV_PORT" \
      VITE_API_PROXY_TARGET="http://127.0.0.1:${DEV_PORT}" \
      VITE_ALLOWED_HOSTS=true \
      exec node node_modules/vite/bin/vite.js --host --strictPort --clearScreen false
  ) &
  VITE_PID=$!
}

# 会话收尾走 cmd_down；只挂 EXIT 一个 trap 就够 ——
# 脚本被 Ctrl-C 的 SIGINT 终止时 bash 同样会跑 EXIT trap。
# set +e：收尾不能因为中间某步失败（如 traefik 已不在）就中断，否则容器停不掉。
cleanup_on_exit() {
  local rc=$?
  printf '\n'
  log "退出联调：停两端 + 注销临时路由"
  set +e
  cmd_down
  return "$rc"
}

cmd_up() {
  command -v docker >/dev/null || die "缺少 docker"

  local use_vite=1
  if [ "${VOS_DEV_WEB:-1}" = "0" ]; then
    use_vite=0
  else
    # 先探端口再动容器：vite 起不来的话没必要把容器也拉起来
    ensure_web_port_free
  fi

  local app_cid media exposed
  app_cid="$(installed_app_container || true)"
  if [ -n "$app_cid" ]; then
    media="$(mount_source "$app_cid" /media)"
    exposed="$(mount_source "$app_cid" /exposed)"
    log "复用已安装应用的挂载：media=${media:-<无>} exposed=${exposed:-<无>}"
  else
    warn "未找到已安装的 v-cine 应用容器（VOS_APP_MATCH=${APP_MATCH}）"
    warn "→ 媒体/授权目录用默认值；平台侧边栏需先安装过 V-Cine 才能在平台内打开页面"
  fi
  export VOS_DEV_MEDIA_PATH="${media:-${VOS_DEV_MEDIA_PATH:-/data/vos_workspace/public/media_video}}"
  export VOS_DEV_EXPOSED_PATH="${exposed:-${VOS_DEV_EXPOSED_PATH:-/nonexistent}}"

  # 容器启动会校验 $VCINE_APP_WEB_DIR/index.html，缺了 fatal。vite 模式下这份产物
  # 不被服务，只为过校验 → 已存在就复用（省一次 13s 构建）；保真模式必须重建。
  if [ "$use_vite" = "1" ] && [ -f "web/${WEB_DIST}/index.html" ]; then
    log "复用已有 web/${WEB_DIST}（vite 模式不服务它，仅用于容器启动校验）"
  else
    build_web
  fi

  log "启动 dev 容器（容器内 :8080，air 热重载 + 挂载平台 PGV/OIDC）"
  # 上一次 recreate/down 尚未结束时报错，重试即可
  local attempt=0
  until compose up -d; do
    attempt=$((attempt + 1))
    [ "$attempt" -ge 3 ] && die "docker compose up 连续失败，请检查 docker 状态"
    warn "compose up 失败（第 ${attempt} 次），3s 后重试…"
    sleep 3
  done

  if [ "$use_vite" = "1" ]; then
    start_vite_bg
  fi

  # 先确认 dev 容器可用再切流量：否则平台侧会 502，比“不切”更糟
  if ! wait_healthy; then
    kill_vite || true
    warn "dev 容器 ${VOS_DEV_HEALTH_TIMEOUT:-300}s 内未就绪，**未**切换平台路由（平台仍走已安装应用）"
    warn "容器保留运行以便排查：make vos-dev-logs ；就绪后重跑 make vos-dev 即可"
    exit 1
  fi
  log "dev 容器健康（http://127.0.0.1:${DEV_PORT}${BASE_PATH}/）"

  cmd_net_join
  if [ "$use_vite" = "1" ]; then
    cmd_route_on vite
  else
    cmd_route_on dist
  fi

  log "就绪：在 VOS 平台侧边栏打开 V-Cine（或刷新平台内 iframe）"
  if [ "$use_vite" = "1" ]; then
    log "  前端：vite dev server（HMR，保存即热更新；X-VCine-Dev: vite）"
  else
    log "  前端：web/${WEB_DIST} 静态产物（保真模式；配合 make vos-dev-web-watch 自动重建）"
  fi
  log "  后端：air 热重载；跨应用直连：其他应用用 ${NETWORK_ALIAS}:8080"
  log "  Ctrl-C 退出联调（停两端 + 注销路由）；下面开始跟随容器日志"
  printf '\n'

  trap 'cleanup_on_exit' EXIT
  compose up
}

cmd_down() {
  kill_vite || true
  cmd_route_off
  cmd_net_leave
  compose down
  log "dev 容器已停止"
}

cmd_status() {
  local app_cid
  app_cid="$(installed_app_container || true)"
  echo "── 平台已安装应用（VOS 托管，勿手动 stop） ──"
  if [ -n "$app_cid" ]; then
    docker ps --filter "id=${app_cid}" --format '  {{.Names}}\t{{.Image}}\t{{.Ports}}'
  else
    echo "  （未找到：${APP_MATCH}）"
  fi
  echo "── 本仓库 dev 容器 ──"
  compose ps nowen-video --format '  {{.Name}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  local dev_cid
  dev_cid="$(compose ps -q nowen-video)"
  echo "── dev 容器网络/别名 ──"
  if [ -n "$dev_cid" ]; then
    docker inspect "$dev_cid" --format '{{range $k,$v := .NetworkSettings.Networks}}  {{$k}} ip={{$v.IPAddress}} aliases={{$v.Aliases}}{{"\n"}}{{end}}'
  else
    echo "  （dev 容器未运行）"
  fi
  echo "── 临时 Traefik 路由 ${ROUTE_FILE} ──"
  docker exec -i "$TRAEFIK_CONTAINER" sh -c "test -f '${ROUTE_FILE}' && cat '${ROUTE_FILE}' || echo '  （未启用 → 平台走已安装应用）'" 2>/dev/null || echo "  （traefik 容器不可用）"
  echo "── 前端（vite dev server）──"
  if curl -fsS -m 3 "http://127.0.0.1:${WEB_DEV_PORT}${BASE_PATH}/" >/dev/null 2>&1; then
    echo "  在跑（http://127.0.0.1:${WEB_DEV_PORT}${BASE_PATH}/，标记头 X-VCine-Dev: vite）"
  else
    echo "  未在跑（:${WEB_DEV_PORT} 无响应；若临时路由指向它则平台会 502）"
  fi
  echo "── 健康检查 ──"
  if curl -fsS -m 3 "http://127.0.0.1:${DEV_PORT}${BASE_PATH}/api/health" >/dev/null 2>&1; then
    echo "  dev 容器 OK（http://127.0.0.1:${DEV_PORT}${BASE_PATH}/）"
  else
    echo "  dev 容器不可达（未启动或仍在 air 首次编译）"
  fi
}

case "${1:-up}" in
  up)        cmd_up ;;
  down)      cmd_down ;;
  route-on)  cmd_route_on ;;
  route-off) cmd_route_off ;;
  status)    cmd_status ;;
  logs)      compose logs -f nowen-video ;;
  web-watch) build_web --watch ;;
  -h|--help|help)
    # 打印文件头部的连续注释块（不写死行号，避免增删用法行后 help 与实现脱节）
    awk 'NR>1 { if ($0 ~ /^#/) print; else exit }' "$0" ;;
  *) die "未知子命令：$1（up|down|route-on|route-off|status|logs|web-watch）" ;;
esac
