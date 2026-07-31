# 工作流示例

## 示例 1：找一部记不清名字的老电影

```bash
# 1. 用模糊记忆尝试 AI 搜索
search --smart "90年代越狱的老电影，主角很聪明"

# 2. 如果没找到，用类型 + 年份缩小范围
search --advanced --type movie --genre 犯罪 --year-min 1990 --year-max 2000 --sort-by rating_desc

# 3. 找到后查看详情
detail --id 2589729f-5f7f-4bec-a5d3-c7b8ef0cf7ba
```

## 示例 2：统计全库影视资产

```bash
# 1. 全库总览
stats

# 2. 按类型细分
stats --type movie
stats --type episode

# 3. 查看某一年份的入库量
stats --type movie --year-min 2024
```

## 示例 3：浏览剧集并查看详情

```bash
# 1. 列出所有剧集
explore --mode series

# 2. 查看某部剧集详情
explore --mode series --id <uuid>

# 3. 搜索该剧集演员的作品
search --advanced --type movie --genre 剧情 --sort-by rating_desc
```

## 示例 4：查找电影系列合集

```bash
# 1. 用混合搜索找系列
search --mixed "黑客帝国"

# 2. 查看合集
explore --mode collections

# 3. 查看合集中具体媒体详情
detail --id <media-uuid>
```

## 示例 5：从概览到精确筛选

```bash
# 1. 全库概览
stats

# 2. 看看有哪些剧集
explore --mode series

# 3. 搜索高分科幻电影
search --advanced --type movie --genre 科幻 --rating 7 --sort-by rating_desc

# 4. 查看最详细的信息
detail --id <uuid> --enhanced
```

## 示例 6：场景语义搜索

用户："找一下有雨夜追逐的场景"

Agent 工作流：
```bash
# 1. 用文搜图模式查找视觉相似的场景
scene "雨夜追逐" --mode image --limit 10

# 2. 也可用文搜文模式匹配场景描述
scene "雨夜追逐" --mode text

# 3. 结合 detail 定位到具体媒体
detail --id <media-uuid>
```

Agent 回复：
```markdown
找到以下与"雨夜追逐"相关的场景：

1. **肖申克的救赎** — 场景 4 (00:31-00:37)<cite idx="1" view_url="..."></cite>
   - 最相关：雨中出狱的经典画面

2. **肖申克的救赎** — 场景 10 (01:14-01:22)<cite idx="2" view_url="..."></cite>
   - 相关：雨夜场景
```

## 示例 7：Agent 对话集成

用户："帮我看看库里有什么好看的科幻片？"

Agent 工作流：
```bash
# 1. 先统计一下
stats --type movie --genre 科幻
# → total: 5

# 2. 列出具体内容
search --advanced --type movie --genre 科幻 --sort-by rating_desc --size 10
# → 返回 5 部科幻片

# 3. 查看最高评分电影详情
detail --id <highest-rated-uuid>
```

Agent 回复：
```markdown
库中有 **5 部科幻电影**，按评分排列：

1. **星际穿越** (2014) — 评分 9.3<cite idx="1" view_url="..."></cite>
   - 导演：Christopher Nolan
   - 类型：科幻, 冒险

2. **Arrival** (2016) — 评分 8.5<cite idx="2" view_url="..."></cite>
   ...
```
