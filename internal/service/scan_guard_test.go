package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestShouldSkipStaleCleanup(t *testing.T) {
	mkRoot := func(t *testing.T, files ...string) string {
		t.Helper()
		root := t.TempDir()
		for _, f := range files {
			full := filepath.Join(root, f)
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
			if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
				t.Fatalf("write: %v", err)
			}
		}
		return root
	}

	t.Run("没有待清理记录时不干预", func(t *testing.T) {
		if skip, _ := shouldSkipStaleCleanup([]string{"/definitely/not/exist"}, 0); skip {
			t.Fatal("existingCount=0 时不应跳过")
		}
	})

	t.Run("库根不存在且有待清理记录 → 跳过", func(t *testing.T) {
		skip, reason := shouldSkipStaleCleanup([]string{"/definitely/not/exist"}, 10)
		if !skip {
			t.Fatal("库根不存在时应跳过清理")
		}
		if reason == "" {
			t.Error("应返回原因")
		}
	})

	t.Run("库根是空目录 → 跳过（挂载未就绪/授权撤销）", func(t *testing.T) {
		root := t.TempDir()
		if skip, _ := shouldSkipStaleCleanup([]string{root}, 10); !skip {
			t.Fatal("空目录应跳过清理")
		}
	})

	t.Run("库根有内容 → 正常清理", func(t *testing.T) {
		root := mkRoot(t, "Movies/a.mkv")
		if skip, _ := shouldSkipStaleCleanup([]string{root}, 10); skip {
			t.Fatal("库根有内容时不应跳过")
		}
	})

	t.Run("多路径：任一根不可用 → 跳过（远程根可用不代表本地文件还在）", func(t *testing.T) {
		empty := t.TempDir()
		full := mkRoot(t, "b.mkv")
		if skip, _ := shouldSkipStaleCleanup([]string{empty, "/definitely/not/exist", full}, 10); !skip {
			t.Fatal("存在不可用根时应跳过清理")
		}
	})

	t.Run("纯远程库不参与本地判定", func(t *testing.T) {
		if skip, _ := shouldSkipStaleCleanup([]string{"webdav://dav.example.com/media"}, 10); skip {
			t.Fatal("纯远程库不应因本地根判定而跳过")
		}
	})

	t.Run("库路径为空列表 → 不干预", func(t *testing.T) {
		if skip, _ := shouldSkipStaleCleanup(nil, 10); skip {
			t.Fatal("无本地根时不应跳过（交由原有逻辑）")
		}
	})
}
