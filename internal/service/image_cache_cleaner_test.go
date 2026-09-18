package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/testutil"
	"go.uber.org/zap"
)

// newImageCacheCleanerFixture 构造带 cache 临时目录的清理器。
func newImageCacheCleanerFixture(t *testing.T) (*ImageCacheCleaner, string, *repository.Repositories) {
	t.Helper()
	db := testutil.NewTestDB(t)
	repos := repository.NewRepositories(db)
	cacheDir := t.TempDir()
	cfg := &config.Config{Cache: config.CacheConfig{CacheDir: cacheDir}}
	return NewImageCacheCleaner(cfg, repos.Media, repos.Series, repos.Person, zap.NewNop().Sugar()), cacheDir, repos
}

// writeCacheDir 创建缓存目录并写入一个文件；backdate=true 时把目录 mtime 回拨 48h（越过宽限期）。
// 注意必须写在文件之后：创建文件会刷新所在目录的 mtime。
func writeCacheDir(t *testing.T, cacheDir string, backdate bool, parts ...string) string {
	t.Helper()
	dir := filepath.Join(append([]string{cacheDir}, parts...)...)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "img.jpg"), []byte("image-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	if backdate {
		old := time.Now().Add(-48 * time.Hour)
		if err := os.Chtimes(dir, old, old); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func assertDirExists(t *testing.T, dir, why string) {
	t.Helper()
	if _, err := os.Stat(dir); err != nil {
		t.Errorf("%s：目录应保留但已丢失 %s (%v)", why, dir, err)
	}
}

func assertDirRemoved(t *testing.T, dir, why string) {
	t.Helper()
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("%s：目录应被删除但仍存在 %s (stat err=%v)", why, dir, err)
	}
}

// TestImageCacheCleanerCleanOrphanImageCaches 验证孤儿判定与保护规则：
// 有数据库引用的保留、无引用的删除、命名空间目录不被误删、宽限期内的孤儿暂不删除。
func TestImageCacheCleanerCleanOrphanImageCaches(t *testing.T) {
	cleaner, cacheDir, repos := newImageCacheCleanerFixture(t)

	media := &model.Media{LibraryID: "lib-1", Title: "Existing", FilePath: "/tmp/existing.mp4", FileSize: 1}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}
	series := &model.Series{LibraryID: "lib-1", Title: "Existing Series", FolderPath: "/tmp/existing-series"}
	if err := repos.Series.Create(series); err != nil {
		t.Fatal(err)
	}
	person := &model.Person{Name: "Existing Person"}
	if err := repos.Person.Create(person); err != nil {
		t.Fatal(err)
	}

	orphanMediaID := uuid.NewString()
	orphanSeriesID := uuid.NewString()
	orphanPersonID := uuid.NewString()
	graceMediaID := uuid.NewString()

	keep := []string{
		writeCacheDir(t, cacheDir, true, "images", media.ID),
		writeCacheDir(t, cacheDir, true, "images", "series", series.ID),
		writeCacheDir(t, cacheDir, true, "images", "persons", person.ID),
		writeCacheDir(t, cacheDir, true, "covers", media.ID),
		writeCacheDir(t, cacheDir, true, "thumbnails", media.ID),
		// 宽限期内的孤儿：图片可能刚落盘、引用尚未写入
		writeCacheDir(t, cacheDir, false, "images", graceMediaID),
		// 非 UUID 的命名空间目录：不得被当成"查不到的 media_id"删除
		writeCacheDir(t, cacheDir, true, "thumbnails", "photos", uuid.NewString()),
		writeCacheDir(t, cacheDir, true, "images", "some-namespace"),
	}
	remove := []string{
		writeCacheDir(t, cacheDir, true, "images", orphanMediaID),
		writeCacheDir(t, cacheDir, true, "images", "series", orphanSeriesID),
		writeCacheDir(t, cacheDir, true, "images", "persons", orphanPersonID),
		writeCacheDir(t, cacheDir, true, "covers", orphanMediaID),
		writeCacheDir(t, cacheDir, true, "thumbnails", orphanMediaID),
	}

	res, err := cleaner.CleanOrphanImageCaches()
	if err != nil {
		t.Fatal(err)
	}

	for _, dir := range keep {
		assertDirExists(t, dir, "有引用或受保护")
	}
	for _, dir := range remove {
		assertDirRemoved(t, dir, "无数据库引用")
	}

	if res.Cleaned != len(remove) {
		t.Errorf("清理数量不符: got=%d want=%d", res.Cleaned, len(remove))
	}
	if res.Skipped != 1 {
		t.Errorf("宽限期跳过数不符: got=%d want=1", res.Skipped)
	}
	if res.FreedBytes <= 0 {
		t.Errorf("释放字节数应大于 0, got=%d", res.FreedBytes)
	}
}

// TestImageCacheCleanerScopedByCategory 验证按分类清理时不会波及其它分类。
func TestImageCacheCleanerScopedByCategory(t *testing.T) {
	cleaner, cacheDir, _ := newImageCacheCleanerFixture(t)

	orphanID := uuid.NewString()
	imagesOrphan := writeCacheDir(t, cacheDir, true, "images", orphanID)
	coversOrphan := writeCacheDir(t, cacheDir, true, "covers", orphanID)
	thumbsOrphan := writeCacheDir(t, cacheDir, true, "thumbnails", orphanID)

	res, err := cleaner.CleanOrphanImageCaches("images")
	if err != nil {
		t.Fatal(err)
	}
	if res.Cleaned != 1 {
		t.Errorf("仅 images 分类应清理 1 个目录, got=%d", res.Cleaned)
	}
	assertDirRemoved(t, imagesOrphan, "指定分类的孤儿")
	assertDirExists(t, coversOrphan, "未指定分类不应被清理")
	assertDirExists(t, thumbsOrphan, "未指定分类不应被清理")

	if _, err := cleaner.CleanOrphanImageCaches("not-a-category"); err == nil {
		t.Error("未知分类应返回错误")
	}
}

// TestImageCacheCleanerAbortsWhenAllDirsAreOrphans 验证安全阀：
// 当扫描到的目录"全部"无引用且数量达到下限时（疑似连错库 / 多实例共用 cache 目录），
// 应中止清理并返回错误，而不是把整批图片删光。
func TestImageCacheCleanerAbortsWhenAllDirsAreOrphans(t *testing.T) {
	cleaner, cacheDir, repos := newImageCacheCleanerFixture(t)

	dirs := make([]string, 0, imageCacheOrphanAllSuspectMin+1)
	for i := 0; i < imageCacheOrphanAllSuspectMin+1; i++ {
		dirs = append(dirs, writeCacheDir(t, cacheDir, true, "images", uuid.NewString()))
	}

	res, err := cleaner.CleanOrphanImageCaches("images")
	if err == nil {
		t.Fatal("全部目录均为孤儿时应中止并返回错误")
	}
	if res.Cleaned != 0 {
		t.Errorf("安全阀生效时不应删除任何目录, got=%d", res.Cleaned)
	}
	for _, dir := range dirs {
		assertDirExists(t, dir, "安全阀生效")
	}

	// 只要存在一个被引用的目录，就不再触发安全阀，孤儿应正常回收。
	referenced := &model.Media{LibraryID: "lib-1", Title: "Referenced", FilePath: "/tmp/ref.mp4", FileSize: 1}
	if err := repos.Media.Create(referenced); err != nil {
		t.Fatal(err)
	}
	keep := writeCacheDir(t, cacheDir, true, "images", referenced.ID)

	res, err = cleaner.CleanOrphanImageCaches("images")
	if err != nil {
		t.Fatalf("存在被引用目录时不应中止: %v", err)
	}
	if res.Cleaned != len(dirs) {
		t.Errorf("应回收全部孤儿目录: got=%d want=%d", res.Cleaned, len(dirs))
	}
	assertDirExists(t, keep, "被引用的目录")
}
