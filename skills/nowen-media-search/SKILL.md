---
name: nowen-media-search
description: |
  搜索 nowen-video 媒体库。当用户想要查找电影、按自然语言描述搜索、浏览剧集/合集、统计资产数量或测试 nowen-video 连接时触发。
allowed-tools: Bash
---

# /nowen-media-search

通过 REST API 搜索 nowen-video 媒体库。支持关键词搜索、高级多条件筛选、混合搜索（媒体+合集）、AI 智能搜索、资产统计和详情查询。

## 使用方式

### 方式一：uv run（自动管理依赖，推荐）

```bash
cd skills/nowen-media-search
uv run scripts/nowen_media_search <模式> [选项]
```

### 方式二：python3（需已安装 requests + pyyaml + toon）

```bash
cd skills/nowen-media-search
python3 scripts/nowen_media_search <模式> [选项]
```

`uv run` 会自动根据脚本内嵌的 PEP 723 元数据创建虚拟环境并安装依赖，无需手动 `pip install`。

所有输出为 **TOON** 格式——一种面向 LLM 的紧凑结构化数据格式（相比 JSON 节省 30-60% token）。

## 7 种搜索模式

| 模式 | 用途 |
|------|------|
| `search --keyword "星际穿越"` | 关键词搜索媒体 |
| `search --advanced --genre 科幻 --year-min 2020 --rating 7` | 多条件高级搜索 |
| `search --mixed "matrix"` | 混合搜索媒体+合集 |
| `search --smart "找一部诺兰的太空电影"` | AI 智能自然语言搜索 |
| `stats` | 统计媒体数量（按类型/条件） |
| `detail --id <uuid>` | 单条媒体完整元数据 |
| `explore --mode series` | 浏览剧集列表 |
| `explore --mode collections` | 浏览电影系列合集 |
| `explore --mode series --id <uuid>` | 查看剧集详情 |
| `config --test` | 测试 nowen-video 连通性 |

### 通用选项

`--page N`（翻页）、`--size N`（每页条数，最大 100）

### search --advanced 筛选条件

`--type movie|episode`、`--genre`、`--year-min`、`--year-max`、`--rating`、`--sort-by relevance|rating_desc|year_desc|year_asc`

## 链式工作流

1. **搜索 → 详情**：先 `search --keyword "星际穿越"` 找到媒体，再 `detail --id <uuid>` 获取完整信息
2. **统计 → 深入**：先 `stats` 查看全库概览，再 `search --advanced --type movie --genre 科幻` 查看具体内容
3. **演员作品**：先 `explore --mode persons` 浏览演员，再 `search --advanced --genre 动作` 精确筛选
4. **浏览 → 详情**：先 `explore --mode series` 列出剧集，再用 `detail --id <uuid>` 获取媒体详情
5. **统计 → 分类型**：先 `stats` 查看全库，再 `stats --type movie --genre 科幻` 深入细分

## 输出格式

所有输出为 TOON 格式——一种面向 LLM 的紧凑结构化数据格式。

- **search**：`mode`、`query`、`total`、`page` 元信息 + `results` 数组（每项含 id, title, year, type, rating, genres）
- **stats**：`mode`、`total`、`type`、`filters`
- **detail**：`mode`、`id` 元信息 + 媒体完整字段
- **explore**：`mode`、`type`、`total` + `results` 数组
- **config**：`mode`、`url`、`api_key`、`status`（--test 时）
- **空结果**：`total: 0` + 空 `results` 数组

示例输出：

```toon
mode: search
query: 星际穿越
total: 1
page: 1
results[1,]{id,title,year,type,rating,genres}:
  uuid-xxx,Interstellar,2014,movie,9.3,"科幻,冒险"
```

## 视频场景检索（结构化场景）

> 场景数据由视频分析管线生成，文本与图片向量同属 SigLIP2 模型空间，支持跨模态检索。

客户端方法（`lib/client.py`）：

```python
api.scene_search("雨夜追逐", limit=20, mode="image")  # 文搜图：文字 → 场景视觉 embedding
api.scene_search("雨夜追逐", limit=20, mode="text")   # 文搜文（默认）：文字 → 场景描述文本 embedding
api.scene_list(task_id)                                # 列出某次分析任务的全部场景
```

对应的 API：

```
GET /api/video-analysis/scenes/search?q=<文本>&mode=image|text&limit=<N>
GET /api/video-analysis/tasks/<task_id>/scenes
GET /api/media/<id>/video-analysis/scenes/<sceneIndex>/grid?task_id=<task_id>   # 九宫格图
```

场景搜索结果含 `scene_index, start_time, end_time, description, distance, media_id, media_title`，可结合 `detail --id` 定位到具体媒体。

## 配置

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `$NOWEN_API_KEY` | API 密钥（必需） | — |
| `$NOWEN_URL` | nowen-video 服务器地址 | `http://localhost:38080` |
| `$NOWEN_FRONTEND_URL` | nowen-video 前端地址 | 同 `$NOWEN_URL`（需手动设置） |

或参考 `config.yaml.sample` 创建 `config.yaml`。

> `frontend_url` 用于生成 `view_url` 字段。不设置时，`view_url` 不会出现在结果中。

## 参考资源

高级用法参见 `references/` 目录（按需加载）：

- **API 参考** — `references/api-reference.md`：端点和请求/响应结构
- **搜索策略** — `references/search-strategies.md`：高级组合查询技巧
- **工作流示例** — `references/workflow-examples.md`：端到端场景示例

## 回复格式

呈现搜索结果时，使用带编号的引用格式：

- 正文中用 `<cite idx="N" view_url="URL"></cite>` 标记引用每条搜索结果（N 从 1 开始）
- idx 是引用编号，view_url 是资产的可访问链接

示例回复：

```markdown
找到以下匹配的影视资产：

1. **Interstellar** (2014) — 评分 9.3<cite idx="1" view_url="http://localhost:38080/media/uuid-xxx"></cite>
   - 类型：科幻, 冒险

2. **Arrival** (2016) — 评分 8.5<cite idx="2" view_url="http://localhost:38080/media/uuid-yyy"></cite>
   - 类型：科幻, 剧情
```

> **注意**：当 `frontend_url` 未配置时，`view_url` 不显示。引用编号与前端自动生成的引用列表一一对应，务必准确连贯。
