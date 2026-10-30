package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/service"
)

// 公开接口：服务未创建时也要返回 200 与完整清单。
func TestCapabilityListWithoutServices(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewCapabilityHandler(&service.Services{}, &config.Config{})

	r := gin.New()
	r.GET("/api/capabilities", h.List)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/capabilities", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}

	var body struct {
		Data struct {
			Items []service.Capability `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	if len(body.Data.Items) == 0 {
		t.Fatal("能力清单不得为空")
	}
	// 每个非可用项都必须带跳转信息，前端才能渲染按钮。
	for _, item := range body.Data.Items {
		if item.State != service.CapabilityAvailable && (item.Fix == nil || item.Fix.Drawer == "") {
			t.Fatalf("%s 缺少跳转信息", item.ID)
		}
	}
}

// services 为 nil 时不得 panic。
func TestCapabilityListNilServices(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewCapabilityHandler(nil, &config.Config{})

	r := gin.New()
	r.GET("/api/capabilities", h.List)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/capabilities", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}
