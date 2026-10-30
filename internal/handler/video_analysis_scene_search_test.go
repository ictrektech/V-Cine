package handler

import (
	"encoding/json"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

// newHandlerFakeEmbeddingServer 任意文本 query 返回 e0（第 0 维=1）的假 V-Scheduler
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
func setupSceneSearchHandler(t *testing.T) (*VideoAnalysisHandler, *repository.Repositories, string) {
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
		APIBase: newHandlerFakeEmbeddingServer(t).URL + "/v1",
		Model:   "ml-server/ViT-B-16-SigLIP2__webli",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	vaService := service.NewVideoAnalysisService(repos.VideoAnalysis, repos.Media, &fakeHandlerVideoAnalysisClient{}, repos.Scene, embClient, filepath.Join(dir, "cache"), false, nil, nil, time.Millisecond, time.Second, nil)
	return NewVideoAnalysisHandler(vaService, nil, &config.Config{}, zap.NewNop().Sugar()), repos, media.ID
}

// TestVideoAnalysisHandlerSearchScenesModes 验证 SearchScenes 的 mode 参数：
// mode=image 检索视觉 embedding（文搜图），默认 mode=text 检索描述 embedding（文搜文）。
func TestVideoAnalysisHandlerSearchScenesModes(t *testing.T) {
	h, repos, mediaID := setupSceneSearchHandler(t)
	tasks, sceneRepo := repos.VideoAnalysis, repos.Scene
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

// TestVideoAnalysisHandlerSearchScenesScope 验证范围过滤：
// library_id 按媒体库限定，media_id 限单片，media_ids 限多片。
func TestVideoAnalysisHandlerSearchScenesScope(t *testing.T) {
	h, repos, mediaID := setupSceneSearchHandler(t)

	dir := t.TempDir()
	videoPath := filepath.Join(dir, "movie2.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	media2 := &model.Media{LibraryID: "library-2", Title: "Movie 2", FilePath: videoPath, FileSize: 5}
	if err := repos.Media.Create(media2); err != nil {
		t.Fatal(err)
	}

	taskA := &model.VideoAnalysisTask{
		MediaID: mediaID, LibraryID: "library-1", MediaTitle: "Movie", VideoPath: "/media/movie.mp4",
		Trigger: model.VideoAnalysisTriggerManual, Status: model.VideoAnalysisStatusSucceeded, Stage: model.VideoAnalysisStageDone,
	}
	taskB := &model.VideoAnalysisTask{
		MediaID: media2.ID, LibraryID: "library-2", MediaTitle: "Movie 2", VideoPath: "/media/movie2.mp4",
		Trigger: model.VideoAnalysisTriggerManual, Status: model.VideoAnalysisStatusSucceeded, Stage: model.VideoAnalysisStageDone,
	}
	for _, task := range []*model.VideoAnalysisTask{taskA, taskB} {
		if err := repos.VideoAnalysis.CreateIfNoActive(task); err != nil {
			t.Fatal(err)
		}
	}
	embA := handlerSceneUnitVector(0)
	embB := handlerSceneUnitVector(1)
	if err := repos.Scene.BatchCreate(taskA.ID, []model.Scene{
		{SceneIndex: 0, StartTime: 0, EndTime: 1, Description: "A", Embedding: &embA, DescriptionEmbedding: &embA},
	}); err != nil {
		t.Fatal(err)
	}
	if err := repos.Scene.BatchCreate(taskB.ID, []model.Scene{
		{SceneIndex: 0, StartTime: 0, EndTime: 1, Description: "B", Embedding: &embB, DescriptionEmbedding: &embB},
	}); err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.GET("/video-analysis/scenes/search", h.SearchScenes)
	search := func(url string) []repository.SceneSearchResult {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, url, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		var body struct {
			Data []repository.SceneSearchResult `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		return body.Data
	}

	cases := []struct {
		name string
		url  string
		want []string
	}{
		{"不限范围", "/video-analysis/scenes/search?q=x&mode=image", []string{mediaID, media2.ID}},
		{"按媒体库", "/video-analysis/scenes/search?q=x&mode=image&library_id=library-2", []string{media2.ID}},
		{"按媒体库 文搜文", "/video-analysis/scenes/search?q=x&library_id=library-2", []string{media2.ID}},
		{"按单片", "/video-analysis/scenes/search?q=x&mode=image&media_id=" + mediaID, []string{mediaID}},
		{"按多片", "/video-analysis/scenes/search?q=x&mode=image&media_ids=" + mediaID + "," + media2.ID, []string{mediaID, media2.ID}},
		{"库与片取交集", "/video-analysis/scenes/search?q=x&mode=image&library_id=library-1&media_ids=" + media2.ID, nil},
		{"不存在的库", "/video-analysis/scenes/search?q=x&mode=image&library_id=missing", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := search(tc.url)
			if len(got) != len(tc.want) {
				t.Fatalf("结果数 = %d, want %d", len(got), len(tc.want))
			}
			seen := make(map[string]bool, len(got))
			for _, item := range got {
				seen[item.MediaID] = true
			}
			for _, want := range tc.want {
				if !seen[want] {
					t.Fatalf("结果缺少 media %s: %+v", want, got)
				}
			}
		})
	}

	t.Run("media_ids 超上限 400", func(t *testing.T) {
		ids := make([]string, 0, 501)
		for i := 0; i < 501; i++ {
			ids = append(ids, "m"+strconv.Itoa(i))
		}
		req := httptest.NewRequest(http.MethodGet, "/video-analysis/scenes/search?q=x&media_ids="+strings.Join(ids, ","), nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", w.Code)
		}
	})
}
