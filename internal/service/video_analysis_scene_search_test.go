package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/testutil"
	pgvector "github.com/pgvector/pgvector-go"
)

// sceneTestDim 测试用 embedding 维度（与生产 768 维对齐）
const sceneTestDim = 768

// newFakeEmbeddingServer 返回固定查询向量的假 emb_server：
// 任意文本 query 都返回 e0（第 0 维 = 1 的单位向量），验证文本向量被送入检索。
func newFakeEmbeddingServer(t *testing.T) *httptest.Server {
	t.Helper()
	queryVec := make([]float64, sceneTestDim)
	queryVec[0] = 1
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/embed" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"embeddings": [][]float64{queryVec},
			"dim":        sceneTestDim,
			"model":      "vit-b-16-siglip2__webli",
			"modality":   "text",
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

// sceneUnitVector 生成指定位置为 1 的单位向量
func sceneUnitVector(pos int) pgvector.Vector {
	vec := make([]float32, sceneTestDim)
	vec[pos] = 1
	return pgvector.NewVector(vec)
}

// setupSceneSearchService 构建带真实 sceneRepo + 假 embedding 服务的 VideoAnalysisService
func setupSceneSearchService(t *testing.T, embServer *httptest.Server) (*VideoAnalysisService, *repository.VideoAnalysisTaskRepo, string) {
	t.Helper()
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}, &model.VideoAnalysisTask{}, &model.Scene{}); err != nil {
		t.Fatal(err)
	}
	repos := repository.NewRepositories(db)
	dir := t.TempDir()
	videoPath := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	media := &model.Media{LibraryID: "library-1", Title: "Movie", FilePath: videoPath, FileSize: 5}
	if err := repos.Media.Create(media); err != nil {
		t.Fatal(err)
	}
	embClient, err := NewEmbeddingClient(embServer.URL, "vit-b-16-siglip2__webli")
	if err != nil {
		t.Fatal(err)
	}
	svc := NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, &fakeVideoAnalysisClient{}, repos.Scene, embClient, filepath.Join(dir, "cache"), false, nil, nil, time.Millisecond, time.Second, nil)
	return svc, repos.VideoAnalysis, media.ID
}

// insertSceneSearchFixture 写入一个成功任务 + 两个场景：
//
//	sceneA(0): 视觉 embedding=e0（文搜图命中）, 描述 embedding=e2
//	sceneB(1): 视觉 embedding=e2,                描述 embedding=e0（文搜文命中）
//
// 查询向量固定为 e0，因此文搜图应返回 [A,B]，文搜文应返回 [B,A]。
func insertSceneSearchFixture(t *testing.T, tasks *repository.VideoAnalysisTaskRepo, svc *VideoAnalysisService, mediaID string) string {
	t.Helper()
	task := &model.VideoAnalysisTask{
		MediaID: mediaID, LibraryID: "library-1", MediaTitle: "Movie",
		VideoPath: "/media/movie.mp4", MappedVideoPath: "/photos/movie.mp4",
		Trigger: model.VideoAnalysisTriggerManual, Status: model.VideoAnalysisStatusSucceeded, Stage: model.VideoAnalysisStageDone,
	}
	if err := tasks.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}
	embA := sceneUnitVector(0)
	descA := sceneUnitVector(2)
	embB := sceneUnitVector(2)
	descB := sceneUnitVector(0)
	scenes := []model.Scene{
		{SceneIndex: 0, StartTime: 0, EndTime: 1, Description: "scene A", Embedding: &embA, DescriptionEmbedding: &descA},
		{SceneIndex: 1, StartTime: 1, EndTime: 2, Description: "scene B", Embedding: &embB, DescriptionEmbedding: &descB},
	}
	if err := svc.sceneRepo.BatchCreate(task.ID, scenes); err != nil {
		t.Fatal(err)
	}
	return task.ID
}

// TestVideoAnalysisServiceSceneSearchTextToImage 验证文搜图与文搜文两条路径：
// 同样的文本查询，分别检索视觉 embedding 列和描述 embedding 列，返回顺序不同。
func TestVideoAnalysisServiceSceneSearchTextToImage(t *testing.T) {
	svc, tasks, mediaID := setupSceneSearchService(t, newFakeEmbeddingServer(t))
	insertSceneSearchFixture(t, tasks, svc, mediaID)

	t.Run("文搜图: 检索视觉 embedding 列", func(t *testing.T) {
		results, err := svc.SearchScenesByTextToImage("rainy night chase", 10)
		if err != nil {
			t.Fatalf("SearchScenesByTextToImage: %v", err)
		}
		if len(results) != 2 {
			t.Fatalf("len(results) = %d, want 2", len(results))
		}
		// sceneA 视觉向量 e0 与查询 e0 距离 0，应排第一
		if results[0].SceneIndex != 0 || results[1].SceneIndex != 1 {
			t.Fatalf("文搜图顺序 = [%d, %d], want [0, 1]", results[0].SceneIndex, results[1].SceneIndex)
		}
		if results[0].Distance > results[1].Distance {
			t.Fatalf("文搜图距离未按升序: %v", results)
		}
	})

	t.Run("文搜文: 检索描述 embedding 列", func(t *testing.T) {
		results, err := svc.SearchScenesByTextQuery("rainy night chase", 10)
		if err != nil {
			t.Fatalf("SearchScenesByTextQuery: %v", err)
		}
		if len(results) != 2 {
			t.Fatalf("len(results) = %d, want 2", len(results))
		}
		// sceneB 描述向量 e0 与查询 e0 距离 0，应排第一
		if results[0].SceneIndex != 1 || results[1].SceneIndex != 0 {
			t.Fatalf("文搜文顺序 = [%d, %d], want [1, 0]", results[0].SceneIndex, results[1].SceneIndex)
		}
	})
}

// TestVideoAnalysisServiceSceneSearchEmbeddingUnavailable 验证 embedding 服务不可用时报错
func TestVideoAnalysisServiceSceneSearchEmbeddingUnavailable(t *testing.T) {
	svc := &VideoAnalysisService{sceneRepo: &repository.SceneRepo{}}
	if _, err := svc.SearchScenesByTextToImage("q", 10); err == nil {
		t.Fatal("expected error when embedding service unavailable, got nil")
	}
	if _, err := svc.SearchScenesByTextQuery("q", 10); err == nil {
		t.Fatal("expected error when embedding service unavailable, got nil")
	}
}

// TestVideoAnalysisServiceSceneSearchSceneRepoUnavailable 验证 sceneRepo 不可用时报错
func TestVideoAnalysisServiceSceneSearchSceneRepoUnavailable(t *testing.T) {
	svc := &VideoAnalysisService{embeddingClient: &EmbeddingClient{}}
	if _, err := svc.SearchScenesByTextToImage("q", 10); err == nil {
		t.Fatal("expected error when scene repo unavailable, got nil")
	}
	if _, err := svc.SearchScenesByTextQuery("q", 10); err == nil {
		t.Fatal("expected error when scene repo unavailable, got nil")
	}
}
