// Package observability 内部可观测性 HTTP 服务器：/metrics + /debug/pprof，
// 独立端口（默认 127.0.0.1:9090，config 可覆盖），不挂主 Gin 路由。
package observability

import (
	"context"
	"net/http"
	"net/http/pprof"
	"time"

	"github.com/nowen-video/nowen-video/internal/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Server 内部可观测性 HTTP 服务器。
type Server struct {
	srv *http.Server
}

// New 创建内部服务器：/metrics（Prometheus 抓取端点）+ /debug/pprof（运行时开关）。
func New(addr string) *Server {
	mux := http.NewServeMux()

	// Prometheus 抓取端点：自定义 registry（Go/Process runtime 指标 + RED 业务指标）
	mux.Handle("/metrics", promhttp.HandlerFor(middleware.Registry(), promhttp.HandlerOpts{}))

	// pprof（CPU/heap/goroutine/mutex/block）：handler 始终注册但统一过 gating 包装，
	// 关闭态返回 404。/debug/pprof/ 子树模式同时覆盖 /debug/pprof/<name>（经 Index 分发）。
	mux.HandleFunc("/debug/pprof/", gated(pprof.Index))
	mux.HandleFunc("/debug/pprof/cmdline", gated(pprof.Cmdline))
	mux.HandleFunc("/debug/pprof/profile", gated(pprof.Profile))
	mux.HandleFunc("/debug/pprof/symbol", gated(pprof.Symbol))
	mux.HandleFunc("/debug/pprof/trace", gated(pprof.Trace))

	return &Server{srv: &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}}
}

// gated pprof handler 级 gating：关闭态返回 404。
func gated(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !PprofEnabled() {
			http.NotFound(w, r)
			return
		}
		h(w, r)
	}
}

// ListenAndServe 启动监听（由调用方 goroutine 启动）。
func (s *Server) ListenAndServe() error {
	return s.srv.ListenAndServe()
}

// Shutdown 优雅关闭（ctx 由调用方传入）。
func (s *Server) Shutdown(ctx context.Context) error {
	return s.srv.Shutdown(ctx)
}
