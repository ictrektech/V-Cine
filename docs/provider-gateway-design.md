# Provider 网关判定与 Key 可选化设计（根治供应商语义猜测）

> 背景：自定义云端 provider 401 误报「V-Router 网关鉴权失败」、本地推理 provider（llama.cpp）
> 空 key 误报「未配置 API Base 或 API Key」。两者是同一根因的症状。本设计从数据模型层根治：
> **V-Router 网关判定收口为一处；API Key 全局可选（空 key 不发 Authorization，由服务端 401 兜底）**。
> 前置设计参考 [vrouter-integration-design.md](vrouter-integration-design.md)。

---

## 1. 根因分析

### 1.1 现状：provider 语义靠子串现场猜测

`AIProviderEntry` 数据模型只有 `{ID, Name, APIBase, APIKey, Models, Enabled}`。所有行为差异
（是否免 key、是否本地推理、是否 V-Router 网关、错误如何解释、VOS token 是否转发）
由多处使用点各自从 id/name/apiBase 子串**现场重新猜**：

| # | 站点 | 猜什么 | 口径 |
|---|------|--------|------|
| 1 | `config.IsKeyFreeProvider` | 是否免 key | id 白名单（`vrouter`/`ollama`/`custom_vrouter`/`custom_v-router`）+ apiBase 特征（`://v-router:`/`:22888`） |
| 2 | `service.isLocalAIProvider` | 是否本地推理 | 名称白名单 + 地址特征表（与 #1 各自维护） |
| 3 | `service.friendlyGatewayError` | 错误怎么解释 | **不带 provider 上下文**：任何 401/403 → V-Router 文案 |
| 4 | `service/ai.go` BlockLocalAI 分支 | 云端强制豁免 | 硬编码 `ActiveProvider != "vrouter"` |
| 5 | `service/ai.go` chatCompletion | VOS token 转发 | 硬编码 `== "vrouter" && IsKeyFreeProvider(...)` |
| 6 | `service/ai.go` TestConnection | VOS token 转发 | 同上，重复一份 |
| 7 | `service/video_analysis.go` | 占位 key + token 转发 | 又一套 `== "vrouter"` 判断 |
| 8 | `config.go` / `handler/ai.go` 种子与内置管理 | 内置条目 | `id == "vrouter"`（**身份判断，合理**） |
| 9 | `AITab.tsx` isVRouter | 前端网关判定 | `includes('vrouter'/'v-router')`，**比后端更宽**，口径漂移 |
| 10 | `AITab.tsx` 列表/弹窗 | 免 key 提示 | 只认 vrouter，其他 provider 空 key 显示「⚠️ 未配置密钥」 |

### 1.2 三条根因

- **RC1 — key 可选性被建模成白名单**：key 本质只是一个 Bearer 头，空 key = 不发头，
  服务端不需要就通、需要就 401。现有设计把「哪些 provider 免 key」建成静态白名单，
  每出现一种新 provider（llama.cpp）就要补名单——补丁永远追不上。
- **RC2 — 网关判定特征表多处漂移**：config / service / 前端各维护一份
  「是否 V-Router」判定，口径不一（前端 `includes` 更宽、后端 id 精确白名单）。
- **RC3 — 错误解释与 provider 解耦**：HTTP 状态码 → 可读文案的映射是全局的，
  不知道错误来自哪个 provider。vrouter 单 provider 时代成立，多 provider 后误报。

---

## 2. 设计

### 2.1 核心：两类判定 + key 全局可选

只有两类：**gateway（vrouter）** 与 **custom（其他一切）**。不做更细分类。

```go
// IsVRouterGateway 判断是否为 V-Router 网关（网关判定的唯一入口，
// 特征表全仓只维护这一份）。custom = 非网关，无独立判定函数。
func IsVRouterGateway(id, apiBase string) bool {
    p := strings.ToLower(strings.TrimSpace(id))
    b := strings.ToLower(strings.TrimSpace(apiBase))
    return strings.Contains(p, "vrouter") || strings.Contains(p, "v-router") ||
        strings.Contains(b, "://v-router:") || strings.Contains(b, ":22888")
}
```

替代 `IsKeyFreeProvider`（删除）。presets 不需要新增字段——vrouter 预设的
APIBase（`http://v-router:8080/v1`）本就命中网关特征。

### 2.2 key 全局可选（修 RC1，两个症状的共同修复）

**API Key 是可选字段：空 key = 不发 Authorization 头，由服务端决定接受或 401。**

| 检查点 | 现状 | 新实现 |
|---|---|---|
| `IsEnabled`（ai_config_provider.go） | api_base + (key 或免 key 白名单) | 只要求 api_base |
| `chatCompletion`（ai.go） | 同上预检 | 同上；空 key 不发 Authorization（gateway 转发 VOS token） |
| `TestConnection`（ai.go） | api_base + key 白名单预检 | 只要求 api_base；空 key 不发 Authorization |
| `GetStatus` | 免 key 口径 | 只看 api_base |
| `video_analysis.go` | 空 key 白名单预检 + 占位 key | 删除预检；空 key 传占位 key（OpenAI SDK 不接受空串），gateway 转发 VOS token |

- 服务端不需要 key（本地推理、内网网关）→ 直接通。
- 服务端需要 key 而未配置 → 401 → 走 §2.3 的可读错误。401 不在重试列表，首次失败即停，无重试放大。

### 2.3 provider-aware 错误解释（修 RC3）

```go
// friendlyProviderError 按 provider 类别与 key 配置解释 HTTP 错误
//（替代 friendlyGatewayError）。
func friendlyProviderError(isGateway, hasKey bool, statusCode int, body string) string
```

- **gateway**：400 `requires model` → 网关模型提示；401/403 → 网关鉴权提示（REQUIRE_KEY/VOS）。
- **custom**：
  - 401/403 且 **空 key** → 「未配置 API Key：该服务商可能需要密钥，请在「设置」中配置后重试」
  - 401/403 且 **有 key** → 「鉴权失败：API Key 无效或未获授权，请检查 API Key 是否正确」
  - 其余状态沿用原始错误。
- `TestConnection` 调用点传入 `IsVRouterGateway(testProvider, apiBase)` 与 `apiKey != ""`。

### 2.4 网关相关行为收口（修 RC2）

| 现有硬编码 | 新实现 |
|---|---|
| VOS token 转发（ai.go ×2、video_analysis.go ×1，`== "vrouter" && IsKeyFreeProvider`） | 统一 `IsVRouterGateway(id, apiBase)` |
| BlockLocalAI 豁免 `!= "vrouter"` | `!IsVRouterGateway(...)` |
| `isLocalAIProvider` | **保留**，仅服务 BlockLocalAI 策略（回到其本来的用途，不再参与 key 判定） |
| `id == "vrouter"`（种子/内置管理/删除保护） | **保留**——身份判断不是能力判断 |
| `AITab.tsx` isVRouter 子串猜测 | 删除；后端 ViewMap/PresetsView 下发 `is_gateway`，前端按其渲染 |

### 2.5 前端（跟随后端下发）

- `ViewMap` / `PresetsView` 下发 `is_gateway` 字段。
- 列表提示：gateway → 「· 内网免鉴权」；custom → 无提示（key 可选，测试结果即事实来源）。
- 弹窗：gateway → placeholder「无需 API Key（内网免鉴权）」；custom → placeholder「sk-...（可选，服务商需要时必填）」。
- 删除「⚠️ 未配置密钥」警告——key 可选化后失去意义，未配 key 的实际后果由测试 401 报出。

### 2.6 设计模式（低耦合高拓展）

| 模式 | 落地形式 | 解决什么 |
|---|---|---|
| 收口函数（Single Choke Point） | `config.IsVRouterGateway` 唯一特征表 | 判定特征表三处漂移（RC2） |
| 表驱动能力映射 | 行为点只依赖判定结果，不互相依赖、不猜子串 | 新类型零调用点改动（OCP） |
| 轻量策略（函数级） | `resolveCredential` / `friendlyProviderError` 普通函数 | 凭证与错误解释收口；**不做 GoF Strategy 接口**——2 类 × 3 行为不值得接口层级 |
| 后端驱动渲染（DIP） | 前端依赖下发 `is_gateway`，删子串猜测 | 前后端口径漂移（RC2 前端侧） |

模式组装后的调用图：

```
              ┌────────────────────────┐
              │  config.IsVRouterGateway │  ← 收口函数：唯一特征表
              │  （判定层，全仓仅此一处） │
              └───────────┬──────────┘
                          │ (isGateway)
        ┌─────────────────┼────────────────┐
        ▼                 ▼                ▼
 resolveCredential  friendlyProviderError  BlockLocalAI 豁免
 （凭证策略）        （错误解释策略）        （策略消费点）
 custom有key→Bearer  gateway→网关文案       !isGateway 才放行
 gateway→VOS token   custom空key→未配置提示
 都无→不发头          custom有key→鉴权失败
        │                 │
        └────────┬────────┘
                 ▼
   HTTP 调用（401 = 事实来源，不重试）
                 ▼
   ViewMap 下发 is_gateway → 前端按字段渲染（后端驱动）
```

- **低耦合**：5 个入口（chatCompletion / TestConnection / IsEnabled / video_analysis / 前端）只依赖判定函数和下发字段，判定变更不波及行为点。
- **高拓展**：新 provider 类型 → 改 `IsVRouterGateway` 一个分支；新鉴权方式 → `resolveCredential` 加一个分支；新错误形态 → `friendlyProviderError` 加一个 case。均不触碰调用点。

---

## 3. 兼容性

- `/admin/ai/*` API **只增字段**（`is_gateway`）不改字段，旧前端兼容。
- `IsKeyFreeProvider` 删除（内部函数，无外部 API）；三处检查点简化为只看 api_base。
- 行为变化：① 本地推理/任意 provider 空 key 可测试可调用；② 非网关 401/403 报通用文案；③ 需 key 的 provider 未配 key 时从预检快失败改为 HTTP 401 失败（文案更可读）。

## 4. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 需 key 的 provider 未配 key 时每次调用都打到 401 | Low | 401 不重试，首次即停；错误文案指引配置 |
| 自定义 id 含 `v-router` 误判 gateway | Low | 语义正确：指向网关即网关，与命名无关 |
| 前端旧缓存缺 `is_gateway` 字段 | Low | 前端回退按 custom 处理，仅提示语退化 |
| 占位 key 发给真网关 | Low | 网关按 Bearer 校验失败即 401，无副作用 |

## 5. 成功标准

1. llama.cpp（空 key）测试连接成功，不再报「未配置」。
2. 自定义云端 provider 空 key 测试 → 401 报「未配置 API Key…」；有 key 但无效 → 报「鉴权失败…」；均不含「V-Router」。
3. vrouter 全部行为不变：免 key、VOS token 转发、网关专属文案、BlockLocalAI 豁免、内置管理。
4. 全仓 grep：`IsKeyFreeProvider` 删除；`IsVRouterGateway` 是网关判定唯一入口；`== "vrouter"` 只剩身份管理。
5. 前端无子串猜测，渲染只依赖后端下发的 `is_gateway`。
6. 现有测试全绿 + 新增网关判定/错误解释/key 可选化测试。

## 6. 开放问题

1. 下发字段命名：`is_gateway`（布尔）vs `class: "gateway"|"custom"`？（倾向 `is_gateway`，与现有 `api_key_configured`/`active` 布尔风格一致）
