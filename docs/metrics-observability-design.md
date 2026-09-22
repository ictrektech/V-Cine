# HTTP 指标与 pprof 可观测性设计（RED 指标 + 按需性能分析）

> 背景：全服务约 60 个 HTTP handler / 448 个路由模式，当前**零指标**（无 Prometheus client、无 `/metrics` 端点）、
> **零性能分析**（无 pprof 接入）。生产出现延迟抖动、错误率上升或 CPU/内存问题时无从诊断。
> 日志侧已有 `log_sanitizer`（PII 脱敏）与 `request_logger` 中间件，本设计补齐指标与 profiling 两个信号。
> 前置审计参考 `tasks/metrics-observability/PLAN.md`。

---

## 1. 现状与缺口

| 信号 | 现状 | 缺口 |
|---|---|---|
| 指标 | 无 Prometheus client，无 `/metrics` | 所有路由无请求速率、延迟、错误率数据 |
| 性能分析 | 无 pprof | 生产 CPU/内存/goroutine 问题无法现场诊断 |
| 日志 | zap + lumberjack，有脱敏中间件 | （独立迁移任务，不在本设计范围） |
| 追踪 | 无 OpenTelemetry | （后续任务，不在本设计范围） |

现有接入点理想：

- `cmd/server/main.go:95` `gin.Default()`；`:109-121` 中间件统一注册（CORS → Security → RateLimit → LogSanitizer → RequestLogger）
- `internal/middleware/` 有现成中间件模式可参考
- `internal/config/` 有结构化配置 + env 覆盖管线

## 2. 设计

### 2.1 核心：一个指标文件 + 一个内部端口

新增 `internal/middleware/metrics.go`（指标声明 + RED 中间件）与 `internal/observability/server.go`
（内部 HTTP 服务器：`/metrics` + `/debug/pprof`，独立端口，默认仅绑定 localhost）。
主 Gin 路由是面向用户的媒体服务入口，**指标与 pprof 不挂主路由**，避免暴露与路由耦合。

```
internal/middleware/metrics.go        # 指标声明 + PrometheusMiddleware
internal/observability/server.go      # 内部端口：/metrics + /debug/pprof（pprof 运行时开关）
internal/observability/pprof.go       # pprof 运行时开关（atomic.Bool + handler 级 gating）
```

### 2.2 RED 指标：Gin 中间件，路由模式做标签

三个信号一条中间件产出，标签只用**有界值**：

```go
// prometheus.NewHistogramVec —— Histogram 而非 Summary（可聚合，支持 histogram_quantile）
// registry：自定义 prometheus.NewRegistry() 一处收口（决策 5）——DefaultRegisterer 已内置
// Go/Process collector，重复 MustRegister(NewGoCollector()) 会 AlreadyRegisteredError panic；
// 自定义 registry 让包级指标在测试间互不污染（配合 delta 断言，不走构造函数注入）。
// 查询示例：
//   rate(http_requests_total{route="/api/media/:id"}[5m])                          # 流量
//   histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))           # P99 延迟
//   rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])   # 错误率
var httpRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
    Name: "http_requests_total",
    Help: "HTTP requests by method/route/status.",
}, []string{"method", "route", "status"})

var httpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
    Name:    "http_request_duration_seconds",
    Help:    "HTTP request latency by method/route.",
    Buckets: prometheus.DefBuckets,
}, []string{"method", "route"})
```

- 路由标签取 `c.FullPath()`（Gin 路由模式，如 `/api/media/:id`）——**有界**（实测 448 个路由模式），绝不使用完整 URL 或用户 ID
- 未匹配路由（404）`FullPath()` 为空 → 归入 `"UNMATCHED"`，防止标签爆炸
- 延迟在 `c.Next()` 前后计时，状态码取 `c.Writer.Status()`
- **长连接/流式路由 exclusion**（一张前缀表，收口在 `metrics.go`）：`/api/ws`（计时的是连接生命周期，分钟~小时，计数还只在关闭时 +1）、`/stream/`、`/federation/stream/`、`/preprocess/media/`（计时的是整个播放时长）——这些只进 Counter，**不进延迟直方图**，否则 `DefBuckets` 观测值全部落 `+Inf`、ws 流量曲线不可见
- `http_requests_in_flight` gauge：`c.Next()` 前后 Inc/Dec，观测并发在途请求（~10 行）

### 2.3 内部端口：/metrics + pprof 运行时开关

```go
// internal/observability/server.go
// 独立 HTTP 服务器，默认绑定 127.0.0.1:9090（config 可覆盖）。
// pprof 默认开启（默认值 true，出问题即可现场诊断）。启动默认值由 observability.pprof_enabled
// （env VCINE_OBSERVABILITY_PPROF_ENABLED=1）决定；运行期经 admin 端点真·不重启切换
// （http.ServeMux handler 级 gating）——关闭态 /debug/pprof 返回 404。
// 实现要点：mux 逐个注册 pprof handler 时统一过 guard 包装（或整个 mux 外层包一层
// gating），勿裸注册 pprof.Index/pprof.Profile——漏包一个就是开关失效。
// 注意：仅改 env 不重启进程不生效（env 启动时读取，运行中无法从外部修改）。
```

- `/metrics`：Prometheus 抓取端点，仅内网/localhost 可达
- `/debug/pprof`：注册 `net/http/pprof`（CPU/heap/goroutine/mutex/block），受**运行时开关**保护（`observability.SetPprofEnabled(bool)`：`atomic.Bool` + handler 级 gating），与 `/metrics` 同端口
- 运行时开关来源：admin 端点（`PUT /api/admin/settings/observability/pprof`，~25 行）；内部服务器本身仍仅 localhost 可达，对外暴露面不变
- Go/Process runtime 指标（goroutine 数、GC、内存、FD/CPU）经自定义 registry 显式注册（决策 5）

### 2.4 配置项

| 配置 | env 覆盖 | 默认值 | 说明 |
|---|---|---|---|
| `observability.metrics_addr` | `VCINE_OBSERVABILITY_METRICS_ADDR` | `127.0.0.1:9090` | 内部服务器监听地址 |
| `observability.pprof_enabled` | `VCINE_OBSERVABILITY_PPROF_ENABLED` | `true` | pprof 启动默认值；运行期可用 admin 开关切换 |

> env 命名遵循全仓统一的 `VCINE_` 前缀（`internal/config/config.go:721-723`：`SetEnvPrefix("VCINE")` + `.`→`_` replacer，README env 表唯一文档化形式）；勿引入 `OBS_` 之类第二套前缀。

## 3. 关键决策

### 决策 1：独立内部端口，不挂主 Gin 路由

媒体服务主路由暴露给用户。`/metrics` 与 pprof 挂主路由需要额外的鉴权中间件且容易误配成公网可达；
独立端口绑定 localhost 天然隔离，**代价**：多一个 goroutine + 端口管理（~40 行）。
**容器部署注意**：默认 bind `127.0.0.1` 只回环，docker-compose 的 `ports: "9090:9090"` 映射到容器 eth0 也**连不上**——
需要抓取/诊断时必须同时覆盖 `VCINE_OBSERVABILITY_METRICS_ADDR=0.0.0.0:9090` 并加端口映射（二者缺一不可，compose 里留注释示例）。

### 决策 2：route 标签用 FullPath，不用 URL

有界标签值是 Prometheus 的硬约束。`c.FullPath()` 返回注册的路由模式，基数 ≈ 路由数（实测 448 个，有界）；
完整 URL 基数无界（含用户 ID、查询参数），会打爆内存与查询性能。

### 决策 3：Histogram，不用 Summary

Summary 的分位数只在单实例内有效，无法跨副本聚合；Histogram + `histogram_quantile()` 服务端聚合，
是标准做法。`DefBuckets` 覆盖 1ms–10s，满足媒体服务延迟分布。

### 决策 4：pprof 走运行时开关（config/env 定默认值 + admin 端点热切换），不做 continuous profiling

pprof 按需诊断（出问题 → 开 → 抓 profile → 关）已覆盖多数场景；Pyroscope 常驻分析成本更高，留作后续任务。
开关分两层：**启动默认值**走 config/env（`pprof_enabled`），**运行期切换**走 admin 端点 + handler 级 gating（真·不重启）。
最初设想"改 env 即切换"不成立——env 进程启动时读取、运行中无法从外部修改，
故运行时开关必须落在代码路径上（~25 行），避免"文档承诺不重启、实际要重启"的验收落差。

### 决策 5：自定义 registry，不用 DefaultRegisterer

`prometheus.DefaultRegisterer` 已内置 Go/Process collector，对其 `MustRegister(NewGoCollector())` 会
`AlreadyRegisteredError` panic（TODO Task 1/Task 5 曾同时暗示两种做法，此处收口）。自定义
`prometheus.NewRegistry()` 显式注册 Go/Process collector + 两个业务指标，内部服务器用
`promhttp.HandlerFor(reg, ...)`；测试用 delta 断言（请求前后读计数差值）隔离，不走依赖注入。

## 4. 验收标准

- [x] `go build ./...`、`go test ./...` 全绿（沿用 error-handling 口径：非 DB 包全绿，DB 类失败与 pristine HEAD 一致即可）
- [x] 启动后 `curl 127.0.0.1:9090/metrics` 返回 `http_requests_total` / `http_request_duration_seconds` / Go+Process runtime 指标（dev 环境无 DB 起不了完整服务，以 `internal/observability/server_test.go` httptest 集成测试等价验证）
- [x] 发起请求后计数与延迟直方图有观测值；404 请求归入 `route="UNMATCHED"`
- [x] pprof 三层行为：`VCINE_OBSERVABILITY_PPROF_ENABLED=0` 启动后 `/debug/pprof/` 返回 404；默认（true）启动后可访问；运行期 admin 开关切换**不重启**即生效（同上，httptest 等价验证；验收后默认值改为 true，见实施备注）
- [x] 流式/ws 路由（`/api/ws`、`/stream/**`、`/federation/stream/**`、`/preprocess/media/**`）有计数、无延迟观测值
- [x] 指标声明上方含 PromQL 查询注释（可发现性约定）
- [x] 标签基数有界：无 URL、用户 ID 等无界值
- [x] env 命名遵循 `VCINE_` 前缀，README env 表已同步（`.env.example` 被 sandbox denyWrite 拦截，待手动添加，见 TODO.md 实施备注）
