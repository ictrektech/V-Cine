package handler

import (
	"encoding/json"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/service"
	"github.com/nowen-video/nowen-video/internal/testutil"
	pgvector "github.com/pgvector/pgvector-go"
)

// sceneHandlerDim 测试 embedding 维度
const sceneHandlerDim = 768

// newHandlerFakeEmbeddingServer 任意文本 query 返回 e0（第 0 维=1）的假 V-Router
func newHandlerFakeEmbeddingServer(t *testing.T) *httptest.Server {
	t.Helper()
	queryVec := make([]float64, sceneHandlerDim)
	queryVec[0] = 1
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []map[string]string{{"id": "ml-server/ViT-B-16-SigLIP2__webli"}}})
		case "/v1/embeddings":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"object": "list",
				"data":   []map[string]any{{"object": "embedding", "embedding": queryVec, "index": 0}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func handlerSceneUnitVector(pos int) pgvector.Vector {
	vec := make([]float32, sceneHandlerDim)
	vec[pos] = 1
	return pgvector.NewVector(vec)
}

// setupSceneSearchHandler 构建带 sceneRepo + 假 embedding 服务的 SearchScenes handler
func setupSceneSearchHandler(t *testing.T) (*VideoAnalysisHandler, *repository.VideoAnalysisTaskRepo, *repository.SceneRepo, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
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
	embClient, err := service.NewEmbeddingProvider(config.EmbeddingAIConfig{
		APIBase: newHandlerFakeEmbeddingServer(t).URL,
		Model:   "ml-server/ViT-B-16-SigLIP2__webli",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	vaService := service.NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, &fakeHandlerVideoAnalysisClient{}, repos.Scene, embClient, filepath.Join(dir, "cache"), false, nil, nil, time.Millisecond, time.Second, nil)
	return NewVideoAnalysisHandler(vaService, nil, &config.Config{}, zap.NewNop().Sugar()), repos.VideoAnalysis, repos.Scene, media.ID
}

// TestVideoAnalysisHandlerSearchScenesModes 验证 SearchScenes 的 mode 参数：
// mode=image 检索视觉 embedding（文搜图），默认 mode=text 检索描述 embedding（文搜文）。
func TestVideoAnalysisHandlerSearchScenesModes(t *testing.T) {
	h, tasks, sceneRepo, mediaID := setupSceneSearchHandler(t)
	task := &model.VideoAnalysisTask{
		MediaID: mediaID, LibraryID: "library-1", MediaTitle: "Movie",
		VideoPath: "/media/movie.mp4", MappedVideoPath: "/photos/movie.mp4",
		Trigger: model.VideoAnalysisTriggerManual, Status: model.VideoAnalysisStatusSucceeded, Stage: model.VideoAnalysisStageDone,
	}
	if err := tasks.CreateIfNoActive(task); err != nil {
		t.Fatal(err)
	}
	// sceneA(0): 视觉=e0（文搜图命中）；sceneB(1): 描述=e0（文搜文命中）
	embA := handlerSceneUnitVector(0)
	descA := handlerSceneUnitVector(2)
	embB := handlerSceneUnitVector(2)
	descB := handlerSceneUnitVector(0)
	scenes := []model.Scene{
		{SceneIndex: 0, StartTime: 0, EndTime: 1, Description: "scene A", Embedding: &embA, DescriptionEmbedding: &descA},
		{SceneIndex: 1, StartTime: 1, EndTime: 2, Description: "scene B", Embedding: &embB, DescriptionEmbedding: &descB},
	}
	if err := sceneRepo.BatchCreate(task.ID, scenes); err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.GET("/video-analysis/scenes/search", h.SearchScenes)

	getScenes := func(url string) (int, []repository.SceneSearchResult) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, url, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var body struct {
			Data []repository.SceneSearchResult `json:"data"`
		}
		if w.Code == http.StatusOK {
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
		}
		return w.Code, body.Data
	}

	t.Run("文搜图 mode=image", func(t *testing.T) {
		code, data := getScenes("/video-analysis/scenes/search?q=rainy&mode=image&limit=10")
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if len(data) != 2 {
			t.Fatalf("len(data) = %d, want 2", len(data))
		}
		if data[0].SceneIndex != 0 || data[1].SceneIndex != 1 {
			t.Fatalf("mode=image 顺序 = [%d, %d], want [0, 1]", data[0].SceneIndex, data[1].SceneIndex)
		}
	})

	t.Run("文搜文 默认 mode", func(t *testing.T) {
		code, data := getScenes("/video-analysis/scenes/search?q=rainy&limit=10")
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if len(data) != 2 {
			t.Fatalf("len(data) = %d, want 2", len(data))
		}
		if data[0].SceneIndex != 1 || data[1].SceneIndex != 0 {
			t.Fatalf("默认 mode 顺序 = [%d, %d], want [1, 0]", data[0].SceneIndex, data[1].SceneIndex)
		}
	})

	t.Run("缺少 q 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/video-analysis/scenes/search?mode=image", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400, body = %s", w.Code, w.Body.String())
		}
	})
}

// TestVideoAnalysisHandlerSearchScenesValidation 验证服务不可用时返回 503（无需 DB）
func TestVideoAnalysisHandlerSearchScenesValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &VideoAnalysisHandler{service: nil}
	r := gin.New()
	r.GET("/video-analysis/scenes/search", h.SearchScenes)
	req := httptest.NewRequest(http.MethodGet, "/video-analysis/scenes/search?q=x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}
