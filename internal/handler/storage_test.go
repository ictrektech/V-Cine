package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestUpdateWebDAVConfigMissingServerURLReturnsFriendlyError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/admin/storage/webdav", strings.NewReader(`{"enabled":true,"server_url":""}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h := &StorageHandler{}
	h.UpdateWebDAVConfig(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
	body := w.Body.String()
	if !strings.Contains(body, "启用 WebDAV 时必须提供服务器地址") {
		t.Fatalf("body = %s, want friendly missing-server-url error", body)
	}
	if strings.Contains(body, "required_if") {
		t.Fatalf("body = %s, must not leak validator tag error", body)
	}
}
