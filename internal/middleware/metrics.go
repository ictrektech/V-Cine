// Package middleware —— HTTP RED 指标中间件（请求速率 / 延迟 / 错误率）。
package middleware

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
)

// registry 自定义注册表，收口本包全部指标注册。
var registry = prometheus.NewRegistry()

// Registry 返回指标 registry，供内部服务器 promhttp.HandlerFor 使用。
func Registry() *prometheus.Registry { return registry }

// RED 指标：请求速率 / 延迟 / 错误率，一条中间件产出，标签只用有界值
// （route = Gin 路由模式，如 /api/media/:id，绝不使用完整 URL 或用户 ID）。
// 查询示例：
//
//	rate(http_requests_total{route="/api/media/:id"}[5m])                        # 流量
//	histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))     # P99 延迟
//	rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) # 错误率
var httpRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
	Name: "http_requests_total",
	Help: "HTTP requests by method/route/status.",
}, []string{"method", "route", "status"})

var httpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
	Name:    "http_request_duration_seconds",
	Help:    "HTTP request latency by method/route.",
	Buckets: prometheus.DefBuckets,
}, []string{"method", "route"})

var httpRequestsInFlight = prometheus.NewGauge(prometheus.GaugeOpts{
	Name: "http_requests_in_flight",
	Help: "Current number of requests being served.",
})

// streamingPathPrefixes 流式/ws 路由表：命中路由只进 Counter，不进延迟直方图。
// 同时覆盖 /api 前缀注册与裸路径两种形式。
var streamingPathPrefixes = []string{
	"/api/ws",
	"/api/stream/",
	"/api/federation/stream/",
	"/api/preprocess/media/",
	"/stream/",
	"/federation/stream/",
	"/preprocess/media/",
}

func isStreamingPath(p string) bool {
	for _, prefix := range streamingPathPrefixes {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}

func init() {
	// 自定义 registry 不含默认 collector，Go/Process runtime 指标需显式注册
	registry.MustRegister(prometheus.NewGoCollector())
	registry.MustRegister(prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}))
	registry.MustRegister(httpRequests)
	registry.MustRegister(httpDuration)
	registry.MustRegister(httpRequestsInFlight)
}

// PrometheusMiddleware RED 指标中间件：请求计数、延迟直方图、在途请求 gauge。
// route 标签取 c.FullPath()（注册的路由模式，基数 ≈ 路由数，有界）；
// 未匹配路由（404/扫描器探测）归入 "UNMATCHED"，防止标签爆炸。
func PrometheusMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		httpRequestsInFlight.Inc()
		defer httpRequestsInFlight.Dec()

		// route 请求前即可确定（注册的路由模式，有界）
		route := c.FullPath()
		if route == "" {
			route = "UNMATCHED"
		}
		record := func(status string) {
			httpRequests.WithLabelValues(c.Request.Method, route, status).Inc()
			// 流式/ws 路由只计数，不进延迟直方图
			if !isStreamingPath(c.Request.URL.Path) {
				httpDuration.WithLabelValues(c.Request.Method, route).Observe(time.Since(start).Seconds())
			}
		}

		// 记录收口到 defer：正常返回与 panic 两条路径都会计数。
		// panic 按 500 计，记后 re-panic 交外层 Recovery 写响应。
		defer func() {
			if rec := recover(); rec != nil {
				record("500")
				panic(rec)
			}
			record(strconv.Itoa(c.Writer.Status()))
		}()

		c.Next()
	}
}
