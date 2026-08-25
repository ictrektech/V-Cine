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
  asset_dir: "/data/nowen-video-structure"   # Nowen 自己的结构化产物数据目录
  max_concurrent: 2
  poll_interval_seconds: 2
  job_timeout_minutes: 120
  describe_enabled: false  # 场景描述功能，默认关闭
```

**`asset_dir`（结构化产物数据目录）**：结构服务把产物暂存在 staging，Nowen 轮询到 succeeded 后把 `result.staging_dir` 整个 `mv` 到 `asset_dir/<hash>/`（搬走即归 Nowen 持久持有）。`asset_dir` 默认 `/data/nowen-video-structure`，部署时按需指定。

### 2. 路径映射

如果 Nowen 和外部服务看到的视频路径**不同**，需要配置路径映射：

```yaml
video_analysis:
  path_mappings:
    - source: "/media"      # Nowen 看到的视频路径前缀
      target: "/photos"     # 外部服务看到的视频路径前缀
```

如果两者看到的路径**完全相同**（最常见），可以不配置，直接按原路径透传。

**注意：**
- `path_mappings` 可选；不配置时按原路径透传（identity）
- 支持多个映射规则，按最长前缀优先匹配
- 源路径和目标路径必须是绝对路径
- 路径映射后不允许跳出目标根目录（防止路径穿越攻击）

### 3. staging 临时卷与 asset_dir 数据目录

结构服务采用无状态化契约：产物暂存于 **staging 目录**（`<staging_base>/<job_id>/`），Nowen 轮询到 succeeded 后把 `result.staging_dir` 整个 `mv` 到 **自己的 `asset_dir`**。因此两个卷都需要可写，且**必须在同一文件系统**（`os.Rename` 跨卷会 `EXDEV`）：

```yaml
# docker-compose.yml 示例
services:
  nowen:
    volumes:
      # 原生视频只读（Nowen 读取并传给结构化）
      - /media:/media:ro
      # staging 临时卷（可写子挂载覆盖父 ro；rename 需写父目录）
      - video-structure-cache:/data/video-structure-cache:rw
      # asset_dir（Nowen 持久持有，与 staging 同文件系统）
      - nowen-video-structure:/data/nowen-video-structure:rw

  video-structure:
    volumes:
      - video-structure-cache:/data/video-structure-cache

volumes:
  video-structure-cache:
  nowen-video-structure:
```

**重要：**
- staging 是**临时**目录：Nowen `mv` 搬走后即归 Nowen 所有，未搬走的由结构服务 TTL（默认 6h）清理
- `staging`（`video-structure-cache`）与 `asset_dir`（`nowen-video-structure`）**必须同一文件系统**，`os.Rename` 才原子
- Docker 中子路径 `rw` 挂载会覆盖父路径 `ro`：`/data:/data:ro` 保留（媒体只读），staging/asset 子路径可写
- 路径映射中的 `target` 必须与 Structure 服务看到的视频路径一致
- `asset_dir` 是 Nowen 在容器内 `config.yaml` 里配置的路径

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
      - video-structure-cache:/data/video-structure-cache:rw   # staging 可写
      - nowen-video-structure:/data/nowen-video-structure:rw         # asset_dir
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
  nowen-video-structure:
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
  asset_dir: "/data/nowen-video-structure"
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

### 4. 任务失败，错误信息包含 "CLAIM_STAGING_FAILED"

**原因：** staging 产物搬移失败（跨文件系统或权限问题）

**解决：**
- 确认 `asset_dir` 与 staging（`video-structure-cache`）在**同一文件系统**（`os.Rename` 跨卷返回 EXDEV）
- 确认 Nowen 对 staging 父目录有写权限（`/data:/data:ro` 下需子路径 `rw` 挂载）
- 重试任务：RetryTask 会从 structure 阶段重新提交并再次搬移

### 5. 九宫格图片无法显示

**原因：** asset_dir 挂载配置错误或产物未搬移

**解决：**
- 确认 `asset_dir` 与容器挂载点一致
- 确认 staging/asset 子路径以 `rw` 挂载（覆盖父 `ro`）
- 检查 `<asset_dir>/<hash>/grids/` 下图片文件是否存在

### 6. STRM 文件无法分析

**原因：** 远程流媒体文件不支持视频分析

**说明：** 视频分析需要直接读取视频文件进行帧采样，STRM 等远程流媒体格式暂不支持。

### 7. 任务一直卡在 "running" 状态

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
