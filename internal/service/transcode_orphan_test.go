package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/testutil"
	"go.uber.org/zap"
)

func TestTranscodeServiceCleanupOrphanTranscodeCaches(t *testing.T) {
	db := testutil.NewTestDB(t)
	repos := repository.NewRepositories(db)
	mediaRepo := repos.Media
	cacheDir := t.TempDir()
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cacheDir}}
	svc := &TranscodeService{repo: repos.Transcode, mediaRepo: mediaRepo, cfg: cfg, logger: zap.NewNop().Sugar()}

	existing := &model.Media{LibraryID: "library-1", Title: "Existing", FilePath: "/tmp/existing.mp4", FileSize: 10}
	if err := mediaRepo.Create(existing); err != nil {
		t.Fatal(err)
	}

	orphanID := uuid.NewString()
	memoryOrphanID := uuid.NewString()

	// 模拟内存中正在跑的 job（对应媒体在 DB 中已不存在）
	svc.running = map[string]*TranscodeJob{
		uuid.NewString(): {Task: &model.TranscodeTask{MediaID: memoryOrphanID}},
	}

	writeCache := func(mediaID string) {
		dir := filepath.Join(cacheDir, "transcode", mediaID, "720p")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(dir, "seg.ts")
		if err := os.WriteFile(file, []byte("data"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeCache(existing.ID)
	writeCache(orphanID)
	writeCache(memoryOrphanID)

	if err := svc.CleanupOrphanTranscodeCaches(); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(cacheDir, "transcode", orphanID)); !os.IsNotExist(err) {
		t.Fatalf("orphan dir should be removed, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, "transcode", existing.ID)); err != nil {
		t.Fatalf("existing media cache should remain, err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, "transcode", memoryOrphanID)); err != nil {
		t.Fatalf("orphan dir with in-memory running job should be kept, err=%v", err)
	}
}
