package observability

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/middleware"
)

// 集成验证：/metrics 返回 RED 指标 + Go/Process runtime 指标；
// pprof 三层行为：默认 404 → 开启可访问 → 关闭立即 404。

func TestObservabilityServer_MetricsAndPprof(t *testing.T) {
	// 触发一次带指标中间件的请求，让 http_requests_total 有观测值
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.PrometheusMiddleware())
	r.GET("/api/test", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/test", nil))

	s := New("127.0.0.1:0")
	handler := s.srv.Handler

	// /metrics 返回 RED 指标 + Go/Process runtime 指标
	wm := httptest.NewRecorder()
	handler.ServeHTTP(wm, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if wm.Code != http.StatusOK {
		t.Fatalf("/metrics 状态码 = %d，期望 %d", wm.Code, http.StatusOK)
	}
	body := wm.Body.String()
	for _, want := range []string{"http_requests_total", "http_request_duration_seconds", "go_goroutines", "process_"} {
		if !strings.Contains(body, want) {
			t.Fatalf("/metrics 缺少指标 %s", want)
		}
	}

	// pprof gating 三层行为：关闭态 404 → admin 开启后不重启即可访问 → 关闭后立即 404
	//（默认值已在 config 设为 true，这里显式控制开关状态验证 gating 本身）
	defer SetPprofEnabled(PprofEnabled()) // 恢复进入测试前的全局开关状态

	SetPprofEnabled(false)
	wp := httptest.NewRecorder()
	handler.ServeHTTP(wp, httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil))
	if wp.Code != http.StatusNotFound {
		t.Fatalf("关闭态 /debug/pprof/ 状态码 = %d，期望 %d", wp.Code, http.StatusNotFound)
	}

	SetPprofEnabled(true)
	wp2 := httptest.NewRecorder()
	handler.ServeHTTP(wp2, httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil))
	if wp2.Code != http.StatusOK {
		t.Fatalf("开启后 /debug/pprof/ 状态码 = %d，期望 %d", wp2.Code, http.StatusOK)
	}

	SetPprofEnabled(false)
	wp3 := httptest.NewRecorder()
	handler.ServeHTTP(wp3, httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil))
	if wp3.Code != http.StatusNotFound {
		t.Fatalf("关闭后 /debug/pprof/ 状态码 = %d，期望 %d", wp3.Code, http.StatusNotFound)
	}
}
