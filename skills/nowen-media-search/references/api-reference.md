# nowen-video API 参考

nowen-media-search 使用的 nowen-video REST API 端点文档。

## 认证

所有 API 请求通过 `Authorization: Bearer` 头部传递 API Key：

```
Authorization: Bearer nk_a1b2c3d4e5f6...
```

API Key 由 `feat/api_key` 模块管理，在 nowen-video 前端或通过 `POST /api/users/me/api-keys` 创建。

---

## 搜索

### `GET /api/search` — 关键词搜索

搜索媒体标题/概要等文本字段。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `q` | string | 是 | 搜索关键词 |
| `page` | int | 否 | 页码（默认 1） |
| `size` | int | 否 | 每页条数（默认 20，最大 100） |

### `GET /api/search/advanced` — 多条件高级搜索

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `q` | string | 否 | 搜索关键词 |
| `page` | int | 否 | 页码 |
| `size` | int | 否 | 每页条数 |
| `type` | string | 否 | 媒体类型：`movie` / `episode` |
| `genre` | string | 否 | 类型标签（如 `科幻`, `动作`） |
| `year_min` | int | 否 | 最小年份 |
| `year_max` | int | 否 | 最大年份 |
| `min_rating` | float | 否 | 最低评分（0-10） |
| `sort_by` | string | 否 | 排序字段：`relevance` / `rating_desc` / `year_desc` / `year_asc` |
| `sort_order` | string | 否 | 排序方向：`asc` / `desc` |

### `GET /api/search/mixed` — 混合搜索

同时搜索媒体和电影系列合集。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `q` | string | 是 | 搜索关键词 |
| `page` | int | 否 | 页码 |
| `size` | int | 否 | 每页条数 |

### `GET /api/ai/search` — AI 智能搜索

使用 LLM 解析自然语言查询，支持模糊语义和组合条件。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `q` | string | 是 | 自然语言查询（如"找一部诺兰的太空电影"） |

---

## 媒体

### `GET /api/media` — 媒体列表

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `page` | int | 否 | 页码 |
| `size` | int | 否 | 每页条数（最大 100） |
| `library_id` | string | 否 | 按媒体库过滤 |

### `GET /api/media/:id` — 媒体详情

返回单条媒体的完整元数据，包括标题、年份、评分、类型、概要、技术规格等。

### `GET /api/media/:id/enhanced` — 增强详情

在标准详情基础上增加技术规格、媒体库信息和播放统计。

---

## 剧集

### `GET /api/series` — 剧集列表

返回所有剧集，每项含 id、title、year、season_count、media_count。

### `GET /api/series/:id` — 剧集详情

返回单部剧集的完整信息，包含各季和各集的概览。

### `GET /api/series/:id/seasons` — 季列表

### `GET /api/series/:id/seasons/:season` — 季内剧集

---

## 演职人员

### `GET /api/media/:id/persons` — 媒体的演职人员

### `GET /api/series/:id/persons` — 剧集的演职人员

### `GET /api/persons/:id` — 人物详情

### `GET /api/persons/:id/media` — 人物作品列表

返回该演员/导演参与的所有媒体。

---

## 合集

### `GET /api/collections` — 合集列表

### `GET /api/collections/:id` — 合集详情

### `GET /api/collections/search?q=xxx` — 搜索合集

---

## 系统

### `GET /api/health` — 服务健康检查

返回服务状态和版本信息。

响应示例：
```json
{
  "status": "ok",
  "version": "1.2.8",
  "server_name": "",
  "features": {
    "ai_enabled": true,
    "smart_search": true,
    "emby_compat": true
  }
}
```
