#!/usr/bin/env bash
set -euo pipefail

# =========================
# push_feishu.sh — 推送 nowen-video 镜像 tag 到飞书发布表
#
# 发布表约定（与 model_hub / vector-rag 一致）：
#   第 1 行  表头，组件名所在列（如 "nowen-video"）
#   第 4 行起 版本登记区，按日期分块；每天一行，一个组件一行一版
#   （同一天重复写入同列会覆盖旧值，即"每天每组件一个最新 tag"）
#
# 用法:
#   交互式:            ./push_feishu.sh
#   命令行指定:        ./push_feishu.sh --sheet "Nowen Video" --val "amd64_20260812_f7c2c7b"
#   从本地 docker 选:  ./push_feishu.sh --col nowen-video --from-docker
#
# 鉴权:
#   - FEISHU_SPREADSHEET_TOKEN：表 token，缺省读 ~/.feishu.components.json 的
#     feishu_spreadsheet_token，再回退 ~/.feishu.json（同样键）
#   - feishu_app_id / feishu_app_secret：同上配置文件
#   - 全部可通过环境变量覆盖（FEISHU_SPREADSHEET_TOKEN 优先于配置文件）
# =========================

# ---- 默认值 ----
DEFAULT_SHEET="ARM_with_cuda"          # 需与 ictrek.app/scripts/package.sh 的 SHEET_TITLE 一致
DEFAULT_COL="nowen-video"            # 发布表第 1 行组件列名（与 package.sh 的 COMPONENT 一致）
DEFAULT_DK="nowen-video"             # 本地 docker 镜像搜索关键词
HEADER_ROW=1                         # 表头行号
DATA_START_ROW=4                     # 版本登记起始行（与 package.sh 的 find_latest_tag 一致）

FEISHU_CONFIG="${FEISHU_CONFIG:-${HOME}/.feishu.components.json}"
FEISHU_FALLBACK_CONFIG="${FEISHU_FALLBACK_CONFIG:-${HOME}/.feishu.json}"
SPREADSHEET_TOKEN="${FEISHU_SPREADSHEET_TOKEN:-}"

_LARK="https://open.feishu.cn/open-apis"

err() { echo "[ERROR] $*" >&2; exit 1; }
log() { echo "[INFO] $*"; }

# ---- 配置读取（首个可读文件生效） ----

read_field() { # config_file field
  python3 - "$1" "$2" <<'PY'
import json, sys
path, field = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
val = data.get(field, "")
print(val if isinstance(val, str) else str(val))
PY
}

load_auth() {
  local config_file tried=""
  for config_file in "$FEISHU_CONFIG" "$FEISHU_FALLBACK_CONFIG"; do
    [[ -n "$config_file" && "$tried" != *"|$config_file|"* ]] || continue
    tried="${tried}|${config_file}|"
    [[ -r "$config_file" ]] || { log "跳过不可读配置: ${config_file}"; continue; }
    FEISHU_APP_ID="${FEISHU_APP_ID:-$(read_field "$config_file" feishu_app_id)}"
    FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-$(read_field "$config_file" feishu_app_secret)}"
    SPREADSHEET_TOKEN="${SPREADSHEET_TOKEN:-$(read_field "$config_file" feishu_spreadsheet_token)}"
    if [[ -n "$FEISHU_APP_ID" && -n "$FEISHU_APP_SECRET" && -n "$SPREADSHEET_TOKEN" ]]; then
      log "使用飞书配置: ${config_file}"
      return 0
    fi
    log "配置不完整，尝试下一份: ${config_file}"
  done
  err "缺少 feishu_app_id / feishu_app_secret / feishu_spreadsheet_token（环境变量或 ~/.feishu.components.json / ~/.feishu.json）"
}

# ---- 飞书 API ----

TOKEN=""

_get_token() {
  curl --fail -sS -X POST "${_LARK}/auth/v3/tenant_access_token/internal" \
    -H 'Content-Type: application/json' \
    -d "{\"app_id\":\"$FEISHU_APP_ID\",\"app_secret\":\"$FEISHU_APP_SECRET\"}" | \
    python3 -c 'import json,sys; print(json.load(sys.stdin)["tenant_access_token"])'
}

_api() { # METHOD path [json_data]
  curl --fail -sS -X "$1" "${_LARK}/$2" \
    -H "Authorization: Bearer $TOKEN" \
    ${3:+-H "Content-Type: application/json" --data "$3"}
}

# ---- 参数解析 ----

SHEET_TITLE="" COL_NAME="" VALUE=""
FROM_DOCKER=0

if [[ $# -eq 0 ]]; then
  # 交互式
  read -r -p "Sheet 标题 [${DEFAULT_SHEET}]: " SHEET_TITLE
  SHEET_TITLE=${SHEET_TITLE:-$DEFAULT_SHEET}
  read -r -p "组件列名 [${DEFAULT_COL}]: " COL_NAME
  COL_NAME=${COL_NAME:-$DEFAULT_COL}
  read -r -p "镜像 tag（回车则从本地 docker 选）: " VALUE
  if [[ -z "$VALUE" ]]; then
    FROM_DOCKER=1
  fi
else
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --sheet) SHEET_TITLE="$2"; shift 2 ;;
      --col)   COL_NAME="$2";    shift 2 ;;
      --val)   VALUE="$2";       shift 2 ;;
      --from-docker) FROM_DOCKER=1; shift ;;
      *) err "未知参数: $1（需要 --sheet / --col / --val / --from-docker）" ;;
    esac
  done
  : "${SHEET_TITLE:?缺少 --sheet}"
  : "${COL_NAME:?缺少 --col}"
  [[ -n "$VALUE" || "$FROM_DOCKER" -eq 1 ]] || err "缺少 --val 或 --from-docker"
fi

load_auth
TOKEN="$(_get_token)"

# ---- 从本地 docker 选 tag ----

if [[ "$FROM_DOCKER" -eq 1 ]]; then
  read -r -p "搜索关键词 [${DEFAULT_DK}]: " DK
  DK=${DK:-$DEFAULT_DK}
  mapfile -t IMAGES < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -i "$DK" | grep -v '<none>' | sed 's|.*/||' | sort -ur)
  [[ ${#IMAGES[@]} -gt 0 ]] || err "未找到匹配 \"$DK\" 的 docker 镜像"
  echo "选择镜像版本:"
  select FULL in "${IMAGES[@]}"; do
    [[ -n "$FULL" ]] && break
    echo "无效选择"
  done
  VALUE="${FULL#*:}"
fi
[[ -n "$VALUE" ]] || err "没有可写入的 tag 值"

log "Sheet: $SHEET_TITLE / Col: $COL_NAME / Value: $VALUE"

# ---- 1. 查 sheet_id ----

RESP=$(_api GET "sheets/v3/spreadsheets/${SPREADSHEET_TOKEN}/sheets/query")
SHEET_ID=$(python3 - "$SHEET_TITLE" "$RESP" <<'PY'
import json, sys
target, resp = sys.argv[1], sys.argv[2]
for s in json.loads(resp)["data"]["sheets"]:
    if s.get("title") == target:
        print(s["sheet_id"])
        raise SystemExit(0)
raise SystemExit(f"sheet not found: {target}")
PY
)
log "  sheet_id: $SHEET_ID"

# ---- 2. 查列字母 ----

RESP=$(_api GET "sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${SHEET_ID}!A1:ZZ1")
COL_LETTER=$(python3 - "$COL_NAME" "$RESP" <<'PY'
import json, sys
target, resp = sys.argv[1], sys.argv[2]
row = json.loads(resp).get("data",{}).get("valueRange",{}).get("values",[[None]])[0]
for i, v in enumerate(row, 1):
    if str(v).strip() == target:
        s = ""
        while i > 0: i, r = divmod(i-1, 26); s = chr(65+r) + s
        print(s)
        raise SystemExit(0)
raise SystemExit(f"column not found: {target}")
PY
)
log "  col: $COL_LETTER"

# ---- 3. 按日期找行（当天已有行则复用，否则 prepend 新行到数据起始行） ----

RESP=$(_api GET "sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${SHEET_ID}!A${DATA_START_ROW}:A2000")
TODAY=$(date +%Y%m%d)
DATE_ROW=$(python3 - "$TODAY" "$DATA_START_ROW" "$RESP" <<'PY'
import json, sys
target, start, resp = sys.argv[1], int(sys.argv[2]), sys.argv[3]
values = json.loads(resp).get("data",{}).get("valueRange",{}).get("values",[])
for idx, row in enumerate(values, start):
    if row and str(row[0]).strip() == target:
        print(idx)
        raise SystemExit(0)
PY
)
if [[ -z "$DATE_ROW" ]]; then
  log "  当天日期未找到，prepend 新行到第 ${DATA_START_ROW} 行"
  _api POST "sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values_prepend" \
    "{\"valueRange\":{\"range\":\"${SHEET_ID}!A${DATA_START_ROW}:A${DATA_START_ROW}\",\"values\":[[\"$TODAY\"]]}}" > /dev/null
  DATE_ROW="$DATA_START_ROW"
fi
log "  row: $DATE_ROW"

# ---- 4. 写入 ----

CELL="${COL_LETTER}${DATE_ROW}"
_api PUT "sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values" \
  "{\"valueRange\":{\"range\":\"${SHEET_ID}!${CELL}:${CELL}\",\"values\":[[\"${VALUE}\"]]}}" > /dev/null
log "Done → ${SHEET_TITLE}!${CELL} = ${VALUE}"
