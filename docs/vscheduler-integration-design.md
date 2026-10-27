# V-Cine 接入 V-Scheduler 设计（免 key 模型网关）

> 目标：参照 V-ChatCut 的接入模式，把 VOS 的 V-Scheduler 模型网关作为 V-Cine 的一等 AI provider 接入——**免 API Key、模型目录动态获取、新装默认 provider 即 vscheduler**。配套任务分解见 [tasks/plan.md](../tasks/plan.md)。

## 0. 验收标准（可检验）

1. **免 key**：vscheduler 条目只填 APIBase（不填 API Key）即可启用、测试连接、正常调用。
2. **现有行为不变**：deepseek/openai/qwen 等不配 Key 仍报"未配置"，无任何放水。
3. **新装默认**：全新安装启动后 ActiveProvider 即 vscheduler，零配置（V-Scheduler 可达时）。
4. **动态模型**：模型列表从 V-Scheduler `/v1/models` 实时拉取，不静态硬编码。
5. **错误可读**：V-Scheduler 不可达 / 401 时，错误信息能指出原因与下一步。

---

## 1. 背景与依据

### 1.1 V-Scheduler 鉴权模型（来自 V-Scheduler docs/auth.md，权威）

| 凭证 | 模型推理 | 用量归属 |
|---|---|---|
| 有效 VOS OIDC token | 允许 | 验证后的 VOS 用户 |
| 共享网关 Key（`REQUIRE_KEY=true` 且非空） | 允许 | gateway-admin |
| **无凭证** | **仅 `REQUIRE_KEY=false` 时允许** | internal |

- **`REQUIRE_KEY` 默认 false** → 容器网络内免 key 即可调用，这是"免key获取"的根据。
- V-Scheduler 官方推荐接入方式（原文）："其他 VOS 应用**不需要保存云端 API Key、上游地址或模型清单**，也不要让用户在每个应用里重复配置模型"。用当前 VOS 账户 token 读 `GET /v1/models`（OpenAI 格式 `data[].id`）填模型下拉框，调 `/v1/chat/completions` 等统一接口。
- 能力未知时应用侧**不要硬拦截**（如不强制 `response_format=json_object`），显示 V-Scheduler 或上游返回的具体错误。

### 1.2 地址

| 部署形态 | APIBase | 说明 |
|---|---|---|
| VOS 内嵌（同 docker network） | `http://v-scheduler:8080/v1` | compose 服务名，免 key 直连 |
| 独立 NAS 部署 | `http://<vos-host>:22888/v1` | V-Scheduler 宿主机端口 |

### 1.3 V-ChatCut 参考实现（4 个要点）

1. **preset 一等公民**（`shared/llm-providers.ts`）：`vscheduler` 预设 = `openai-compatible` + `http://v-scheduler:8080/v1` + `defaultModel: ''`（模型动态拉取，不硬编码）。
2. **不查 key**（`model-selection.ts`）：`if (preset.id === 'vscheduler' || isLocalLlmProvider(...)) { if (!savedModel) return []; }`——vscheduler 只要求有 model；其他 provider 才查 `apiKey.configured`。
3. **token 转发可选**（`v-scheduler-client.ts`）：VOS auth 开启时带 `Bearer <当前用户 VOS accessToken>`（按用户归集用量）；关闭时**完全不带 Authorization 头**。
4. **探活+拉目录**（`key-probes.ts`）：`GET /api/v1/models`，`needs: [[]]`（无前置条件）。

---

## 2. V-Cine 现状与阻塞点

| # | 位置 | 现状 | 性质 |
|---|---|---|---|
| 1 | `ai_config_provider.go` `IsEnabled()` | `ap.APIKey == ""` → false | 🔴 阻塞点 1 |
| 2 | `ai.go:295` `chatCompletion` | `ap.APIKey == ""` → 报"未配置 AI 供应商" | 🔴 阻塞点 2 |
| 3 | `ai.go:1118` `TestConnection` | `apiKey == ""` → 报"未配置 API Base 或 API Key" | 🔴 阻塞点 3 |
| 4 | `ai.go:358` | 无条件 `Authorization: Bearer + apiKey` | 🟡 空 key 会发出 `Bearer ` |
| 5 | `handler/ai.go` `FetchModels` | **apiKey 为空时不发 Authorization** | 🟢 已天然免 key |
| 6 | `config/ai_presets.go` | 6 个预设，无 vscheduler | 补预设 |
| 7 | `config.go:901` | 默认 `ai.provider = "deepseek"` | 改默认 |
| 8 | `service/vos_oidc.go` | VOS OIDC 登录已有，但登录后不保留 accessToken（只绑 vos_subject） | 二期 |
| 9 | `service/ai_router.go` | 内部 `AIRouter` 是故障转移路由器 | 命名规避 |

**兼容性确认**（已核实，无需改动）：

- `isLocalAIProvider("vscheduler", "http://v-scheduler:8080/v1")` → false（Docker DNS 名不命中本地地址特征）。
- `supportsJSONResponseFormat("vscheduler")` → false（白名单外）→ 不强制 json_object，**符合 V-Scheduler 文档**"能力未知不要硬拦截"。
- `FetchModels` 解析标准 OpenAI 格式，V-Scheduler `/v1/models` 兼容。

---

## 3. 架构决策

### 3.1 provider id 用 `vscheduler`（命名规避）

V-Cine 内部已有 `AIRouter`（service/ai_router.go，AI 故障转移路由器），与 VOS V-Scheduler 服务**重名不同物**。provider id 采用小写 `vscheduler`（对齐 V-ChatCut 的 preset id），概念上称"V-Scheduler 网关"，代码中不引入 `VScheduler` 结构体名以免混淆。

### 3.2 免 key 判定收口在 `config.IsKeyFreeProvider()`

```go
// IsKeyFreeProvider 无需 API Key 即可调用的 provider（免 key 判定的唯一来源）。
func IsKeyFreeProvider(provider, apiBase string) bool
```

免 key 两类：

- **id 命中**：`vscheduler` / `ollama`（及手动添加的 `custom_vscheduler` / `custom_v-scheduler`——
  AddProvider 会给名称加 `custom_` 前缀）；
- **APIBase 指向 V-Scheduler 网关**：`://v-scheduler:`（docker 服务名）或 `:22888`（宿主机端口）——
  任意命名的手动条目都免 key（语义正确：指向网关即免 key，与命名无关）。

三处检查点（IsEnabled / chatCompletion / TestConnection）统一引用；其他 provider 现有行为完全不变。

### 3.3 默认 provider = vscheduler，配启动种子

`ActiveProfile()` 从 `Providers` 列表解析，**列表为空时返回 nil**（死代码）——单纯改默认值不生效。因此在 `config.Load()` 中新增 `ensureDefaultProvider(cfg)`：

- **种子条件**：`len(cfg.AI.Providers) == 0`（全新安装）→ 追加一条 vscheduler 免 key 条目（默认 APIBase、无 Key、Enabled=true）并设 `ActiveProvider = "vscheduler"`。
- **已有用户不受影响**：Providers 非空时绝不种子（用户删除条目后重启也不会复活）。
- **仅在内存生效**：不落盘，行为幂等。
- 不做启动网络探测（不 ping `/healthz`）：`ai.enabled` 默认 false，用户启用 AI 时本来就要过 UI；V-Scheduler 不可达时调用报明确错误。与 V-ChatCut 行为一致。

### 3.4 vscheduler 豁免 BlockLocalAI

V-Scheduler 是**云模型网关**不是本地推理。默认 APIBase 不命中本地特征，但用户改为宿主机私网 IP（`http://172.17.0.1:22888/v1`）时会被 `isLocalAIProvider` 误判、被 `BlockLocalAI=true` 拦截。在 BlockLocalAI 分支按 provider id 豁免 vscheduler。

### 3.5 模型目录动态拉取（零改动）

现有 `FetchModels` handler 已天然免 key（apiKey 为空时不发 Authorization），且兼容 V-Scheduler 的 OpenAI `data[].id` 格式。用户在 vscheduler 下点"拉取模型"即从网关填充模型下拉框。`AvailableModels` 预设留空——V-Scheduler 是动态 Model Hub，静态清单必然过时（V-ChatCut 的 `defaultModel: ''` 同理）。

### 3.6 v1 不转发 VOS token（二期）

免 key 已满足需求。token 转发需改 auth service 保留 accessToken（现在 `LoginWithVOSOIDC` 验证后即丢弃，只绑 vos_subject），涉及敏感凭证的服务端存储。留二期：登录时把 token 存入内存 session，vscheduler 调用时带 `Authorization: Bearer <vos-token>`，用量归属从 `internal` 变为 VOS 用户。

---

## 4. 数据流（改造后）

```
新装用户启用 AI → ActiveProvider = "vscheduler"（启动种子，免 key）
    → FetchModels: GET http://v-scheduler:8080/v1/models（无 Authorization）→ 填充模型下拉
    → chatCompletion: POST /v1/chat/completions（无 Authorization）
    → V-Scheduler 用量归 "internal"
    → 失败时沿用现有 401/5xx 错误路径，信息可读

独立 NAS 用户 → AI 配置 → vscheduler APIBase 改 http://<vos-host>:22888/v1 → 同上
```

## 5. 改动清单

| 层 | 文件 | 改动 |
|---|---|---|
| config | `internal/config/ai_presets.go` | vscheduler 预设（排第一、Recommended）+ `IsKeyFreeProvider` |
| config | `internal/config/config.go` | `Load()` 新增 `ensureDefaultProvider` |
| service | `internal/service/ai_config_provider.go` | `IsEnabled()` key-free 放行 |
| service | `internal/service/ai.go` | `chatCompletion`/`TestConnection` 放行 + 条件 Authorization 头 + BlockLocalAI 豁免 |
| web | `web/src/components/admin/AITab.tsx` | vscheduler 的 APIKey 输入框免 key 提示（功能零改动） |
| docs | `docs/vscheduler-integration-design.md` | 本文档 |

测试：`ai_presets_test.go`、`ai_keyfree_test.go`、`config_seed_vscheduler_test.go`（均为新建）。

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 用户改 vscheduler APIBase 为私网 IP 被 BlockLocalAI 误拦 | Medium | §3.4 按 provider id 豁免 |
| 用户删除 vscheduler 条目后重启复活 | Low | 种子条件限定 `len(Providers)==0` |
| V-Scheduler 部署 `REQUIRE_KEY=true` 时免 key 调用 401 | Medium | 沿用现有 401 错误路径；文档注明默认 false |
| 已有用户默认 provider 被改变 | High | 种子仅限全新安装；老用户通过 UI 手动切换 |
| 空 key 发出 `Bearer ` 头 | Low | 条件设置 Authorization 头 |

## 7. 二期展望

- **VOS token 转发**：用量按 VOS 用户归集（需 auth service 保留 accessToken）。
- **模型元数据**：拉取 `/api/v1/models`（含 `qualified`/`kind`/`capabilities`），前端按能力过滤（chat/image/embedding）。
- **一键配置**：vscheduler 版 QuickConfig（当前种子已使之一键即用，暂无必要）。

---

# 附：Embedding 接入（CLIP 图片/文本向量 → V-Scheduler → ML Server）

> 实现见 `tasks/embedding-vscheduler/`。目标：场景向量的 embedding 后端统一经 V-Scheduler 调用 ML Server 的 SigLIP2（`ml-server/ViT-B-16-SigLIP2__webli`）。原直连 emb_server 的代码已全部删除。

## A. 协议约束（从 v-scheduler 源码核实的硬约束）

| 项 | 约束 |
|---|---|
| 模型名 | 必须用完整限定名 `ml-server/ViT-B-16-SigLIP2__webli`（`AcquireFor` 精确匹配，大小写敏感） |
| 文本向量 | `POST /v1/embeddings`（OpenAI 兼容）。**只支持文本**；v-scheduler 内部转 ML Server `entries.clip.textual`，响应 `data[].embedding`，无 usage |
| 图片向量 | 只能走扩展 `POST /v1/ml/predictions`（multipart：`model` + `image` 文件）；响应透传 ML Server `{"clip": "[序列化数组]", ...}` |
| 模型发现 | `GET /v1/models` 返回 `data[].id`；ML Server 每 30s 自动发现，未运行则模型不在列表 |
| 鉴权 | `REQUIRE_KEY=false`（默认）匿名可用；开启时用网关 Key 或 VOS token |

## B. 本仓库实现

- **接口抽象**（`internal/service/embedding_provider.go`）：`EmbeddingProvider` 接口（图片/文本计算 + `IsAvailable` + `Probe`），工厂 `NewEmbeddingProvider` 按 model 是否带 `/` 前缀自动选择后端；后续新增后端 = 新文件 + 工厂分支。
- **唯一后端**（`embedding_vscheduler.go`）：v-scheduler 协议已内置；`EmbeddingProvider` 接口 + `NewEmbeddingProvider` 工厂保留，供未来接入其他 embedding 后端（新增实现文件 + 工厂分发，消费方零改动）。
- **协议约束**（`embedding_vscheduler.go`）：
  - 文本 → `POST {base}/embeddings`（OpenAI 格式解析）
  - 图片 → dataURL →脱敏→ 还原字节 → multipart `POST {base}/ml/predictions`，解析 `clip` 字段
  - 调用前探测 `GET {base}/models`（30s TTL 缓存）：模型不在列表 / 网关不可达 / 鉴权失败均给出可读中文错误（“获取不到就提示”）
- **配置**（`ai.embedding_ai`）：`api_base` 指向 v-scheduler（地址即开关），`model` 用限定名，可选 `api_key`。

```yaml
embedding_ai:
  api_base: http://v-scheduler:8080/v1
  model: ml-server/ViT-B-16-SigLIP2__webli
  api_key: ""
```

- **健康展示**：`VideoAnalysisHealthInfo` 新增 `embedding_mode/model/available/error`，系统设置 → 视频分析抽屉展示。
- 与存量向量的兼容：新旧两后端同为 ViT-B-16-SigLIP2__webli 权重、768 维、同一 CLIP 空间，DB 存量向量无需重建。
