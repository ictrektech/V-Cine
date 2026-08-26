package service

import (
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"go.uber.org/zap"
)

func TestWebDAVServiceUpdateConfigReinitializes(t *testing.T) {
	cases := []struct {
		name string
		url  string
	}{
		{"changed URL", "http://127.0.0.1:2"},
		{"same URL enable", "http://127.0.0.1:1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logger := zap.NewNop().Sugar()
			vfsMgr := NewVFSManager(logger)
			cfg := &config.Config{}
			cfg.Storage.WebDAV = config.WebDAVConfig{
				Enabled:   false,
				ServerURL: "http://127.0.0.1:1",
				BasePath:  "/",
				Timeout:   2,
			}
			svc := NewWebDAVService(cfg, logger, vfsMgr)

			done := make(chan error, 1)
			go func() {
				done <- svc.UpdateConfig(config.WebDAVConfig{
					Enabled:   true,
					ServerURL: tc.url,
					BasePath:  "/",
					Timeout:   2,
				})
			}()

			select {
			case err := <-done:
				if err == nil {
					t.Fatal("expected connection error, got nil")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("UpdateConfig deadlocked")
			}
		})
	}
}
