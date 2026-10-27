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
  scene_base_url: "http://scene-detection:8910"
  structure_base_url: "http://structure:8911"
  # asset_dir: ""   # 默认 <cache_dir>/structure，一般无需配置
  max_concurrent: 2
  poll_interval_seconds: 2
  job_timeout_minutes: 120
  describe_enabled: false  # 场景描述功能，默认关闭
```

**`asset_dir`（结构化产物数据目录）**：结构服务通过 HTTP artifact 交付产物（v2 Pull），Nowen 下载后存到 `asset_dir/<hash>/`（下载即归 Nowen 持久持有）。`asset_dir` 默认跟随 `cache_dir`，即 `<cache_dir>/structure`，一般无需显式配置。

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

### 3. 结构化产物交付（v2 Pull）与 asset_dir 数据目录

结构服务采用无状态化契约，产物由 Nowen 通过 **HTTP artifact 拉取**（`GET /api/v2/video/structure/jobs/{id}/artifact`）下载到自己的 `asset_dir/<hash>/`，下载完成后调用 `DELETE /api/v2/video/structure/jobs/{id}` 释放服务端 staging。Nowen 不再需要知道服务端 staging 目录路径，也不需要共享卷。

`asset_dir` 默认跟随 `cache_dir`，即 `<cache_dir>/structure`，一般无需单独配置；Nowen 容器无需挂载宿主 staging 目录。

VOS 构建时通过 `VITE_BASE` 注入前端子路径前缀（如 `/app/com.ictrek.v-cine/`），与 VAI 其他 app 一致；后端只负责静态文件与反向代理层剥离前缀，不再向 `index.html` 注入 `<base href>`。

```yaml
# docker-compose.yml 示例（v2 Pull，Nowen 无需 staging 卷）
services:
  nowen:
    volumes:
      # 原生视频只读（Nowen 读取并传给结构化）
      - /media:/media:ro
      # cache 目录（asset_dir 默认落在 <cache_dir>/structure）
      - cache:/cache

  video-structure:
    volumes:
      # 结构服务本地 staging 缓存（仅结构服务使用，Nowen 不挂载）
      - video-structure-cache:/data/video-structure-cache

volumes:
  video-structure-cache:
```

**重要：**
- Nowen 通过 HTTP 下载产物后即归 Nowen 所有；服务端 staging 由 `DELETE` 显式释放，未释放的由 TTL（默认 6h）兜底清理
- `asset_dir` 默认 `<cache_dir>/structure`，已在 cache 卷内，无需单独挂载
- 路径映射中的 `target` 必须与 Structure 服务看到的视频路径一致

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
      - cache:/cache                                            # asset_dir 默认落在 /cache/structure
    environment:
      - VIDEO_ANALYSIS_ENABLED=true
      - VIDEO_ANALYSIS_SCENE_BASE_URL=http://scene-detection:8910
      - VIDEO_ANALYSIS_STRUCTURE_BASE_URL=http://structure:8911

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
      - video-structure-cache:/data/video-structure-cache  # 结构服务本地 staging 缓存

volumes:
  video-structure-cache:
  cache:
```

对应的 Nowen 配置：

```yaml
video_analysis:
  enabled: true
  scene_base_url: "http://scene-detection:8910"
  structure_base_url: "http://structure:8911"
  path_mappings:
    - source: "/media"
      target: "/photos"
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

**原因：** v2 Pull 下载 artifact 失败，结构化产物未落地。

**解决：**
- 确认结构服务已实现 `/api/v2/video/structure/jobs/{id}/artifact`，且 job 状态返回值含 `artifact` 清单
- 检查 `structure_base_url` 连通性
- 重试任务：RetryTask 会从 structure 阶段重新提交并再次下载

### 5. 任务失败，错误码为 DESCRIBE_ERROR / DESCRIBE_PARTIAL

**原因：** 场景描述阶段未全部成功。`DESCRIBE_ERROR` 表示全部场景描述失败（describe job 状态为 failed）；`DESCRIBE_PARTIAL` 表示部分场景失败，失败详情在任务 `error_message` 中（形如 `3/73 个场景描述失败（scene_index: 12,45,70）`）。

**扇出方不同，重试行为不同：**

| 配置 | 谁调视觉模型 | 重试粒度 |
|---|---|---|
| 未配置 `ai.scene_describe_ai.model` | structure 服务端（`DescribeModelCfg` 注入凭证） | 由服务端决定（按其 staging 缓存做增量） |
| 配置了 `ai.scene_describe_ai.model` | V-Cine 自己（`describe_concurrency` 并发） | **只补 DB 中 `description` 为空的场景**，已成功场景不重发 |

**解决：**
- 任务状态为 partial/failed 时可直接重试；配置了自定义描述模型时，重试只会为缺口场景调用视觉模型
- 描述服务的 staging 产物有 TTL（生产 6 小时 / dev 7 天），请在 TTL 内重试；V-Cine 已在描述失败时把九宫格 claim 到本地，不受 TTL 影响
- 检查 describe 使用的视觉模型配置（`scene_describe_ai`）与供应商连通性
- 鉴权失败（401/403）与模型缺失（网关 404 `unknown model or upstream`）属于不可重试错误：系统会立即中止本轮扇出，修好配置后重试即可，不会逐个场景白跑
- 模型缺失时，上游（structure/describe 服务）通过 `error.detail.model` 回传本次请求的模型名（形如 `v-scheduler/ollama-qa/minicpm-v4.6:latest`），任务据此给出 V-Scheduler 模型仓库的下载入口；旧版上游没有该字段时退回 `unknown model: model-hub/...` 文本解析
- 模型仓库里存的是 `ollama://minicpm-v4.6:latest` 这类 id，V-Cine 用"最后一段原生模型名"对齐网关命名；同名模型在多个来源下存在时不做猜测，直接提示"不在模型仓库中"，需人工确认

### 6. 九宫格图片无法显示

**原因：** asset_dir 挂载配置错误或产物未下载

**解决：**
- 确认 `asset_dir` 与容器挂载点一致
- 检查 `asset_dir/<hash>/grids/` 下图片文件是否存在，确认 artifact 下载成功

### 7. STRM 文件无法分析

**原因：** 远程流媒体文件不支持视频分析

**说明：** 视频分析需要直接读取视频文件进行帧采样，STRM 等远程流媒体格式暂不支持。

### 8. 任务一直卡在 "running" 状态

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
