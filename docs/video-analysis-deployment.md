# 视频分析部署指南

## 概述

视频分析功能依赖两个外部服务：
- **Scene Detection (场景检测)**：端口 8910，负责视频场景边界检测
- **Structure (结构分析)**：端口 8911，负责视频结构化分析、九宫格图片生成和场景描述

## 配置

### 1. 基础配置

在 `config.yaml` 或环境变量中添加：

```yaml
video_analysis:
  enabled: true
  scene_base_url: "http://localhost:8910"
  structure_base_url: "http://localhost:8911"
  cache_root: "/analysis-cache"
  max_concurrent: 2
  poll_interval_seconds: 2
  job_timeout_minutes: 120
  describe_enabled: false  # 场景描述功能，默认关闭
```

### 2. 路径映射

如果 Nowen 和外部服务看到的视频路径不同，需要配置路径映射：

```yaml
video_analysis:
  path_mappings:
    - source: "/media"      # Nowen 看到的视频路径前缀
      target: "/photos"     # 外部服务看到的视频路径前缀
```

**注意：**
- 支持多个映射规则，按最长前缀优先匹配
- 源路径和目标路径必须是绝对路径
- 路径映射后不允许跳出目标根目录（防止路径穿越攻击）

### 3. 共享缓存挂载

Structure 服务生成的九宫格图片存储在 `cache_base_path` 下。为了让 Nowen 能访问这些图片，需要共享挂载：

```yaml
# docker-compose.yml 示例
services:
  nowen:
    volumes:
      - video-structure-cache:/analysis-cache:ro  # 只读挂载

  video-structure:
    volumes:
      - video-structure-cache:/data/video-structure-cache

volumes:
  video-structure-cache:
```

**重要：**
- Nowen 挂载为只读 (`ro`)，防止意外修改缓存文件
- 路径映射中的 `target` 必须与 Structure 服务看到的视频路径一致
- `cache_root` 是 Nowen 挂载点的路径

### 4. 配置验证

启动后，可以通过以下 API 验证配置：

```bash
# 检查视频分析服务状态
curl http://localhost:38080/api/admin/video-analysis/statistics

# 详细统计（包含成功率、平均耗时）
curl http://localhost:38080/api/admin/video-analysis/statistics/detailed
```

如果返回 503，表示服务未启用或配置无效。

## Docker Compose 完整示例

```yaml
version: '3.8'

services:
  nowen:
    image: nowen-video:latest
    ports:
      - "38080:38080"
    volumes:
      - ./config:/app/config
      - /media:/media:ro
      - video-structure-cache:/analysis-cache:ro
    environment:
      - VIDEO_ANALYSIS_ENABLED=true
      - VIDEO_ANALYSIS_SCENE_BASE_URL=http://scene-detection:8910
      - VIDEO_ANALYSIS_STRUCTURE_BASE_URL=http://video-structure:8911

  scene-detection:
    image: scene-detection:latest
    ports:
      - "8910:8910"
    volumes:
      - /media:/media:ro

  video-structure:
    image: video-structure:latest
    ports:
      - "8911:8911"
    volumes:
      - /media:/photos  # 注意：这里映射为 /photos
      - video-structure-cache:/data/video-structure-cache

volumes:
  video-structure-cache:
```

对应的 Nowen 配置：

```yaml
video_analysis:
  enabled: true
  scene_base_url: "http://scene-detection:8910"
  structure_base_url: "http://video-structure:8911"
  path_mappings:
    - source: "/media"
      target: "/photos"
  cache_root: "/analysis-cache"
  max_concurrent: 2
```

## 排障指南

### 1. 任务一直处于 "排队中"

**原因：** Worker 未启动或 max_concurrent 太小

**解决：**
- 检查日志中是否有 `VideoAnalysisWorker started` 消息
- 增大 `max_concurrent` 配置
- 检查是否有任务卡在 running 状态（可能服务重启导致）

### 2. 任务失败，错误信息包含 "submit detect job"

**原因：** Scene Detection 服务不可用

**解决：**
- 检查 `scene_base_url` 配置是否正确
- 确认 Scene Detection 服务正在运行
- 检查网络连通性

### 3. 任务失败，错误信息包含 "submit structure job"

**原因：** Structure 服务不可用或路径映射错误

**解决：**
- 检查 `structure_base_url` 配置
- 验证路径映射是否正确（Structure 看到的视频路径必须存在）
- 检查 Structure 服务日志

### 4. 九宫格图片无法显示

**原因：** 缓存挂载配置错误

**解决：**
- 确认 `cache_root` 与 Structure 的 `cache_base_path` 指向同一存储
- 确认 Nowen 挂载为只读 (`ro`)
- 检查图片文件是否存在

### 5. STRM 文件无法分析

**原因：** 远程流媒体文件不支持视频分析

**说明：** 视频分析需要直接读取视频文件进行帧采样，STRM 等远程流媒体格式暂不支持。

### 6. 任务一直卡在 "running" 状态

**原因：** 服务重启导致任务状态丢失

**解决：**
- 系统会在启动时自动恢复 running 状态的任务
- 如果仍未恢复，可以手动重试任务

## 回滚方案

如果视频分析功能出现问题，可以快速禁用：

```yaml
video_analysis:
  enabled: false
```

禁用后：
- 已排队的任务不会被处理
- 已完成的任务结果保留
- 前端显示 "视频分析服务未启用" 提示
- 不影响其他功能

## 监控指标

通过 `/api/admin/video-analysis/statistics/detailed` 获取：

- `total_tasks`：总任务数
- `queued_count`：排队中任务数
- `running_count`：正在执行任务数
- `success_rate`：成功率 (%)
- `error_rate`：失败率 (%)
- `partial_rate`：部分完成率 (%)
- `avg_elapsed_seconds`：平均耗时 (秒)

## 日志查看

视频分析相关日志关键词：

- `Video analysis task created`：任务创建
- `Video analysis task started`：任务开始执行
- `Video analysis detect stage completed`：场景检测完成
- `Video analysis structure stage completed`：结构分析完成
- `Video analysis describe stage completed`：场景描述完成
- `Video analysis task completed successfully`：任务成功完成
- `Video analysis task failed`：任务失败
