package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAnalysisSourceToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("empty token skips auth", func(t *testing.T) {
		r := gin.New()
		r.Use(AnalysisSourceToken(""))
		r.GET("/source", func(c *gin.Context) { c.Status(http.StatusOK) })

		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/source", nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", w.Code)
		}
	})

	t.Run("header token accepted", func(t *testing.T) {
		r := gin.New()
		r.Use(AnalysisSourceToken("secret"))
		r.GET("/source", func(c *gin.Context) { c.Status(http.StatusOK) })

		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/source", nil)
		req.Header.Set("X-Analysis-Token", "secret")
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", w.Code)
		}
	})

	t.Run("query token accepted", func(t *testing.T) {
		r := gin.New()
		r.Use(AnalysisSourceToken("secret"))
		r.GET("/source", func(c *gin.Context) { c.Status(http.StatusOK) })

		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/source?token=secret", nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", w.Code)
		}
	})

	t.Run("wrong token rejected", func(t *testing.T) {
		r := gin.New()
		r.Use(AnalysisSourceToken("secret"))
		r.GET("/source", func(c *gin.Context) { c.Status(http.StatusOK) })

		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/source?token=wrong", nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", w.Code)
		}
	})
}
