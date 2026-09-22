package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// delta 断言 helper：包级 registry + 包级指标，测试隔离用请求前后读
// 计数/观测值差值。CounterVec/HistogramVec 子项是 Metric 而非 Collector，
// testutil.ToFloat64 不适用，故经 Write 采样。

// counterValue 读取指定 label 组合的 Counter 当前值。
func counterValue(t *testing.T, c prometheus.Counter) float64 {
	t.Helper()
	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatalf("读取 Counter 失败: %v", err)
	}
	return m.GetCounter().GetValue()
}

// histogramCount 读取指定 label 组合的延迟直方图观测次数（sample count）。
func histogramCount(t *testing.T, vec *prometheus.HistogramVec, labels ...string) uint64 {
	t.Helper()
	// WithLabelValues 返回 Observer（无 Write），子项具体类型为 Histogram（Metric）
	metric, ok := vec.WithLabelValues(labels...).(prometheus.Metric)
	if !ok {
		t.Fatal("HistogramVec 子项未实现 Metric")
	}
	var m dto.Metric
	if err := metric.Write(&m); err != nil {
		t.Fatalf("读取 Histogram 失败: %v", err)
	}
	return m.GetHistogram().GetSampleCount()
}

// newMetricsRouter 构造带指标中间件的最小测试路由。
func newMetricsRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(PrometheusMiddleware())
	r.GET("/api/test", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.GET("/api/test/err", func(c *gin.Context) { c.Status(http.StatusInternalServerError) })
	r.GET("/api/ws", func(c *gin.Context) { time.Sleep(5 * time.Millisecond); c.Status(http.StatusOK) })
	return r
}

func doRequest(r *gin.Engine, path string) {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
}

// TestPrometheusMiddleware_CounterAndDuration 正常请求：计数 +1、延迟有观测值。
func TestPrometheusMiddleware_CounterAndDuration(t *testing.T) {
	r := newMetricsRouter()

	counterBefore := counterValue(t, httpRequests.WithLabelValues("GET", "/api/test", "200"))
	durationBefore := histogramCount(t, httpDuration, "GET", "/api/test")

	doRequest(r, "/api/test")

	if got := counterValue(t, httpRequests.WithLabelValues("GET", "/api/test", "200")); got-counterBefore != 1 {
		t.Fatalf("请求计数 delta = %v，期望 1", got-counterBefore)
	}
	if got := histogramCount(t, httpDuration, "GET", "/api/test"); got-durationBefore != 1 {
		t.Fatalf("延迟直方图观测值 delta = %d，期望 1", got-durationBefore)
	}
}

// TestPrometheusMiddleware_Unmatched 404（未匹配路由）归入 route="UNMATCHED"。
func TestPrometheusMiddleware_Unmatched(t *testing.T) {
	r := newMetricsRouter()

	before := counterValue(t, httpRequests.WithLabelValues("GET", "UNMATCHED", "404"))

	doRequest(r, "/api/not-exist")

	if got := counterValue(t, httpRequests.WithLabelValues("GET", "UNMATCHED", "404")); got-before != 1 {
		t.Fatalf("UNMATCHED 计数 delta = %v，期望 1", got-before)
	}
}

// TestPrometheusMiddleware_StatusSeparation 同路由不同状态分开计数。
func TestPrometheusMiddleware_StatusSeparation(t *testing.T) {
	r := newMetricsRouter()

	okBefore := counterValue(t, httpRequests.WithLabelValues("GET", "/api/test", "200"))
	errBefore := counterValue(t, httpRequests.WithLabelValues("GET", "/api/test/err", "500"))

	doRequest(r, "/api/test")
	doRequest(r, "/api/test/err")
	doRequest(r, "/api/test/err")

	if got := counterValue(t, httpRequests.WithLabelValues("GET", "/api/test", "200")); got-okBefore != 1 {
		t.Fatalf("200 计数 delta = %v，期望 1", got-okBefore)
	}
	if got := counterValue(t, httpRequests.WithLabelValues("GET", "/api/test/err", "500")); got-errBefore != 2 {
		t.Fatalf("500 计数 delta = %v，期望 2", got-errBefore)
	}
}

// TestPrometheusMiddleware_StreamingExclusion exclusion 路由（/api/ws 等流式/ws
// 路由）有计数、无延迟观测值。
func TestPrometheusMiddleware_StreamingExclusion(t *testing.T) {
	r := newMetricsRouter()

	counterBefore := counterValue(t, httpRequests.WithLabelValues("GET", "/api/ws", "200"))
	durationBefore := histogramCount(t, httpDuration, "GET", "/api/ws")

	doRequest(r, "/api/ws")

	if got := counterValue(t, httpRequests.WithLabelValues("GET", "/api/ws", "200")); got-counterBefore != 1 {
		t.Fatalf("ws 计数 delta = %v，期望 1", got-counterBefore)
	}
	if got := histogramCount(t, httpDuration, "GET", "/api/ws"); got != durationBefore {
		t.Fatalf("ws 不应进延迟直方图，观测值 delta = %d，期望 0", got-durationBefore)
	}
}

// TestPrometheusMiddleware_PanicCounted panic 路径：请求按 500 计数且有延迟观测值。
func TestPrometheusMiddleware_PanicCounted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// 外层 Recovery，等价生产链路中 gin.Default() 内置 Recovery 的位置
	r.Use(func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				c.Status(http.StatusInternalServerError)
			}
		}()
		c.Next()
	})
	r.Use(PrometheusMiddleware())
	r.GET("/api/panic", func(c *gin.Context) { panic("boom") })

	counterBefore := counterValue(t, httpRequests.WithLabelValues("GET", "/api/panic", "500"))
	durationBefore := histogramCount(t, httpDuration, "GET", "/api/panic")

	doRequest(r, "/api/panic")

	if got := counterValue(t, httpRequests.WithLabelValues("GET", "/api/panic", "500")); got-counterBefore != 1 {
		t.Fatalf("panic 请求计数 delta = %v，期望 1", got-counterBefore)
	}
	if got := histogramCount(t, httpDuration, "GET", "/api/panic"); got-durationBefore != 1 {
		t.Fatalf("panic 延迟直方图观测值 delta = %d，期望 1", got-durationBefore)
	}
}

// TestPrometheusMiddleware_InFlight in-flight gauge 在请求处理期间 ≥1。
func TestPrometheusMiddleware_InFlight(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(PrometheusMiddleware())

	var during float64
	r.GET("/api/inflight", func(c *gin.Context) {
		var m dto.Metric
		if err := httpRequestsInFlight.Write(&m); err != nil {
			t.Fatalf("读取 in-flight gauge 失败: %v", err)
		}
		during = m.GetGauge().GetValue()
		c.Status(http.StatusOK)
	})

	doRequest(r, "/api/inflight")

	if during < 1 {
		t.Fatalf("请求处理期间 in-flight = %v，期望 >= 1", during)
	}
}
