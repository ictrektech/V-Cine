# 搜索策略

## 关键词搜索最佳实践

`search --keyword` 适合精确查找已知标题的媒体：

```bash
# 精确标题
search --keyword "肖申克的救赎"

# 模糊匹配
search --keyword "肖申克"

# 外文原名
search --keyword "The Shawshank Redemption"
```

## 高级搜索精确过滤

`search --advanced` 适合按已知条件组合筛选：

```bash
# 某年份范围的高分电影
search --advanced --type movie --year-min 1990 --year-max 2000 --rating 8 --sort-by rating_desc

# 指定类型的作品
search --advanced --genre 科幻 --sort-by year_desc

# 某年份的剧集
search --advanced --type episode --year-min 2023
```

## 混合搜索

`search --mixed` 同时搜索媒体和合集，适合想找"某个电影系列"时：

```bash
# 搜索电影及其所属合集
search --mixed "黑客帝国"

# 模糊系列名
search --mixed "三部曲"
```

## AI 智能搜索

`search --smart` 使用 LLM 解析自然语言，适合模糊描述：

```bash
# 模糊记忆
search --smart "找一部诺兰的太空电影"

# 组合描述
search --smart "90年代的香港动作片，评分高的"

# 按场景描述
search --smart "讲越狱的老电影"
```

## 链式查询

### 搜索 → 详情

```bash
# Step 1: 关键词搜索
search --keyword "肖申克" --size 5

# Step 2: 从结果中获取媒体 ID，查看完整元数据
detail --id <uuid>
```

### 统计 → 深入筛选

```bash
# Step 1: 全库统计
stats

# Step 2: 按类型和年份深入
stats --type movie --year-min 2020

# Step 3: 查看具体内容
search --advanced --type movie --year-min 2020 --sort-by rating_desc
```

### 浏览 → 详情

```bash
# Step 1: 查看所有剧集
explore --mode series

# Step 2: 查看剧集详情
explore --mode series --id <uuid>

# Step 3: 搜索该剧集相关内容
search --advanced --type episode --genre 科幻
```

## 分页

- `--size N`：每页条数（默认 20，最大 100）
- `--page N`：翻页
- 结果中包含 `total` 字段指示总匹配数

```bash
search --advanced --type movie --size 50 --page 1
search --advanced --type movie --size 50 --page 2
```

## 空结果处理

当搜索无匹配时，返回 `total: 0` 加空 `results` 数组。此时建议：
1. 缩小关键词试试模糊匹配
2. 使用 `stats` 查看全库概览
3. 使用 `explore --mode series` 浏览库中有什么
