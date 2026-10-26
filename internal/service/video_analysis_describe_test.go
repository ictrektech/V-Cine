package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
)

// ==================== 测试替身 ====================

// fakeSceneStore 内存版场景存储：模拟"部分场景已有描述"的重试现场。
type fakeSceneStore struct {
	mu      sync.Mutex
	scenes  []model.Scene
	updates [][]repository.SceneDescriptionUpdate
}

func (f *fakeSceneStore) GetByTaskID(string) ([]model.Scene, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]model.Scene, len(f.scenes))
	copy(out, f.scenes)
	return out, nil
}

func (f *fakeSceneStore) UpdateDescriptions(_ string, updates []repository.SceneDescriptionUpdate) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updates = append(f.updates, updates)
	for _, update := range updates {
		for i := range f.scenes {
			if f.scenes[i].SceneIndex == update.SceneIndex {
				f.scenes[i].Description = update.Description
			}
		}
	}
	return nil
}

// describedIndexes 返回当前已有描述的场景索引（升序），用于断言增量语义。
func (f *fakeSceneStore) describedIndexes() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []int
	for _, scene := range f.scenes {
		if strings.TrimSpace(scene.Description) != "" {
			out = append(out, scene.SceneIndex)
		}
	}
	sort.Ints(out)
	return out
}

// fakeVisionClient 记录被请求的图片，并按需注入失败。
type fakeVisionClient struct {
	mu       sync.Mutex
	calls    []string
	failOn   map[int]error
	describe func(index int) string
}

func (f *fakeVisionClient) DescribeImage(_ context.Context, imagePath string) (string, error) {
	f.mu.Lock()
	f.calls = append(f.calls, imagePath)
	f.mu.Unlock()
	index := sceneIndexFromGridPath(imagePath)
	if err, ok := f.failOn[index]; ok {
		return "", err
	}
	if f.describe != nil {
		return f.describe(index), nil
	}
	return fmt.Sprintf("场景 %d 的描述", index), nil
}

func (f *fakeVisionClient) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeVisionClient) calledIndexes() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]int, 0, len(f.calls))
	for _, path := range f.calls {
		out = append(out, sceneIndexFromGridPath(path))
	}
	sort.Ints(out)
	return out
}

// sceneIndexFromGridPath 从 scene_003.jpg 解析场景索引。
func sceneIndexFromGridPath(path string) int {
	base := filepath.Base(path)
	var index int
	if _, err := fmt.Sscanf(base, "scene_%d.jpg", &index); err != nil {
		return -1
	}
	return index
}

// newLocalDescribeFixture 构造只依赖内存替身的本地 describe 现场：
// 三个场景 + 已 claim 到 asset_dir 的九宫格图片。
func newLocalDescribeFixture(t *testing.T, scenes []model.Scene) (*VideoAnalysisService, *fakeSceneStore, string) {
	t.Helper()
	assetDir := t.TempDir()
	const videoHash = "hash-1"
	gridDir := filepath.Join(assetDir, videoHash, "grids")
	if err := os.MkdirAll(gridDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, scene := range scenes {
		if strings.TrimSpace(scene.ImagePath) == "" {
			continue
		}
		if err := os.WriteFile(filepath.Join(gridDir, scene.ImagePath), []byte("jpeg"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	store := &fakeSceneStore{scenes: scenes}
	svc := &VideoAnalysisService{
		assetDir:              assetDir,
		sceneDescriptionStore: store,
		pollInterval:          time.Millisecond,
	}
	return svc, store, videoHash
}

// threeSceneFixture 三个场景，前 describedCount 个已有描述。
func threeSceneFixture(describedCount int) []model.Scene {
	scenes := make([]model.Scene, 0, 3)
	for i := 0; i < 3; i++ {
		scene := model.Scene{
			SceneIndex: i,
			ImagePath:  fmt.Sprintf("scene_%03d.jpg", i),
		}
		if i < describedCount {
			scene.Description = fmt.Sprintf("已有描述 %d", i)
		}
		scenes = append(scenes, scene)
	}
	return scenes
}

func localDescribeTask(videoHash string) *model.VideoAnalysisTask {
	return &model.VideoAnalysisTask{
		ID:                  "task-1",
		MediaID:             "media-1",
		VideoHash:           videoHash,
		IncludeDescriptions: true,
		Status:              model.VideoAnalysisStatusRunning,
		Stage:               model.VideoAnalysisStageDescribe,
		ResultJSON:          fmt.Sprintf(`{"video_hash":%q,"scenes":[{"scene_index":0,"grid_image":"scene_000.jpg"},{"scene_index":1,"grid_image":"scene_001.jpg"},{"scene_index":2,"grid_image":"scene_002.jpg"}]}`, videoHash),
	}
}

// ==================== 缺口计算 ====================

func TestBuildLocalDescribeRequestOnlyTargetsMissingDescriptions(t *testing.T) {
	svc, _, videoHash := newLocalDescribeFixture(t, threeSceneFixture(2))
	request, err := svc.buildLocalDescribeRequest(localDescribeTask(videoHash))
	if err != nil {
		t.Fatal(err)
	}
	if len(request.Targets) != 1 {
		t.Fatalf("targets = %+v, want exactly the one scene without description", request.Targets)
	}
	if request.Targets[0].SceneIndex != 2 {
		t.Fatalf("target scene_index = %d, want 2", request.Targets[0].SceneIndex)
	}
	if request.Targets[0].GridImage != "scene_002.jpg" {
		t.Fatalf("grid image = %q", request.Targets[0].GridImage)
	}
}

func TestBuildLocalDescribeRequestSkipsScenesWithoutGridImage(t *testing.T) {
	scenes := threeSceneFixture(0)
	scenes[1].ImagePath = ""
	svc, _, videoHash := newLocalDescribeFixture(t, scenes)
	request, err := svc.buildLocalDescribeRequest(localDescribeTask(videoHash))
	if err != nil {
		t.Fatal(err)
	}
	if len(request.Targets) != 2 {
		t.Fatalf("targets = %+v, want 2 (scene without grid image is skipped)", request.Targets)
	}
}

func TestBuildLocalDescribeRequestAllDescribedYieldsNoTargets(t *testing.T) {
	svc, _, videoHash := newLocalDescribeFixture(t, threeSceneFixture(3))
	request, err := svc.buildLocalDescribeRequest(localDescribeTask(videoHash))
	if err != nil {
		t.Fatal(err)
	}
	if len(request.Targets) != 0 {
		t.Fatalf("targets = %+v, want none", request.Targets)
	}
}

// ==================== 扇出语义 ====================

func TestDescribeLocallyOnlyCallsVisionForPendingScenes(t *testing.T) {
	svc, _, videoHash := newLocalDescribeFixture(t, threeSceneFixture(2))
	vision := &fakeVisionClient{}

	outcome, err := svc.describeLocally(context.Background(), vision, localDescribeRequest{
		VideoHash: videoHash,
		Targets:   []sceneDescriptionTarget{{SceneIndex: 2, GridImage: "scene_002.jpg"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if vision.callCount() != 1 {
		t.Fatalf("vision calls = %d, want 1 (only the missing scene)", vision.callCount())
	}
	if got := vision.calledIndexes(); len(got) != 1 || got[0] != 2 {
		t.Fatalf("called scene indexes = %v, want [2]", got)
	}
	if len(outcome.Failed) != 0 {
		t.Fatalf("failed = %v, want none", outcome.Failed)
	}
	if outcome.Total != 1 {
		t.Fatalf("total = %d, want 1", outcome.Total)
	}

	var result videoAnalysisDescribeResult
	if err := json.Unmarshal(outcome.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != describeStatusCompleted {
		t.Fatalf("status = %q, want completed", result.Status)
	}
	if len(result.Descriptions) != 1 || result.Descriptions[0].SceneIndex != 2 {
		t.Fatalf("descriptions = %+v", result.Descriptions)
	}
}

func TestDescribeLocallyPartialFailureKeepsSuccessfulScenes(t *testing.T) {
	svc, _, videoHash := newLocalDescribeFixture(t, threeSceneFixture(0))
	vision := &fakeVisionClient{
		failOn: map[int]error{
			1: &sceneDescribeError{Retryable: true, Message: "上游 500"},
		},
	}

	outcome, err := svc.describeLocally(context.Background(), vision, localDescribeRequest{
		VideoHash: videoHash,
		Targets: []sceneDescriptionTarget{
			{SceneIndex: 0, GridImage: "scene_000.jpg"},
			{SceneIndex: 1, GridImage: "scene_001.jpg"},
			{SceneIndex: 2, GridImage: "scene_002.jpg"},
		},
	})
	if err != nil {
		t.Fatalf("retryable failures must not abort the batch: %v", err)
	}
	if vision.callCount() != 3 {
		t.Fatalf("vision calls = %d, want 3", vision.callCount())
	}
	if len(outcome.Failed) != 1 || outcome.Failed[0] != 1 {
		t.Fatalf("failed = %v, want [1]", outcome.Failed)
	}

	var result videoAnalysisDescribeResult
	if err := json.Unmarshal(outcome.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != describeStatusPartial {
		t.Fatalf("status = %q, want partial", result.Status)
	}
	if len(result.Descriptions) != 2 {
		t.Fatalf("descriptions = %+v, want the 2 successful scenes", result.Descriptions)
	}
	for _, item := range result.Descriptions {
		if item.SceneIndex == 1 {
			t.Fatal("failed scene must not appear in descriptions")
		}
	}
	if len(result.Warnings) != 1 || result.Warnings[0].Code != "DESCRIBE_SCENE_FAILED" {
		t.Fatalf("warnings = %+v", result.Warnings)
	}
}

func TestDescribeLocallyAbortsOnUnretryableFailure(t *testing.T) {
	svc, _, videoHash := newLocalDescribeFixture(t, threeSceneFixture(0))
	vision := &fakeVisionClient{
		failOn: map[int]error{
			0: &sceneDescribeError{Retryable: false, Message: "unknown model: model-hub/x"},
		},
	}

	outcome, err := svc.describeLocally(context.Background(), vision, localDescribeRequest{
		VideoHash: videoHash,
		Targets: []sceneDescriptionTarget{
			{SceneIndex: 0, GridImage: "scene_000.jpg"},
			{SceneIndex: 1, GridImage: "scene_001.jpg"},
			{SceneIndex: 2, GridImage: "scene_002.jpg"},
		},
	})
	if !errors.Is(err, errSceneDescriptionUnretryable) {
		t.Fatalf("err = %v, want errSceneDescriptionUnretryable", err)
	}
	if len(outcome.Failed) == 0 {
		t.Fatal("failed list must contain the unretryable scene")
	}
	// 并发为 3，可能已全部派发；关键断言是错误被正确识别为不可重试。
	if outcome.Failed[0] != 0 {
		t.Fatalf("failed = %v, want 0 in the list", outcome.Failed)
	}
}

func TestDescribeLocallyEmptyTargetsReturnsCompleted(t *testing.T) {
	svc, _, videoHash := newLocalDescribeFixture(t, threeSceneFixture(3))
	vision := &fakeVisionClient{}
	outcome, err := svc.describeLocally(context.Background(), vision, localDescribeRequest{VideoHash: videoHash})
	if err != nil {
		t.Fatal(err)
	}
	if vision.callCount() != 0 {
		t.Fatalf("vision calls = %d, want 0", vision.callCount())
	}
	var result videoAnalysisDescribeResult
	if err := json.Unmarshal(outcome.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != describeStatusCompleted || len(result.Descriptions) != 0 {
		t.Fatalf("result = %+v", result)
	}
}

// ==================== 重试只补缺口（核心承诺） ====================

func TestLocalDescribeRetryOnlyDescribesFailedScenes(t *testing.T) {
	// 第一轮：场景 1 失败 → partial；第二轮：只请求场景 1。
	svc, store, videoHash := newLocalDescribeFixture(t, threeSceneFixture(0))
	firstRound := &fakeVisionClient{
		failOn: map[int]error{1: &sceneDescribeError{Retryable: true, Message: "上游 503"}},
	}
	request, err := svc.buildLocalDescribeRequest(localDescribeTask(videoHash))
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := svc.describeLocally(context.Background(), firstRound, request)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateDescriptions("task-1", sceneDescriptionUpdatesFrom(outcome.Result)); err != nil {
		t.Fatal(err)
	}
	if got := store.describedIndexes(); len(got) != 2 || got[0] != 0 || got[1] != 2 {
		t.Fatalf("described after round 1 = %v, want [0 2]", got)
	}

	secondRound := &fakeVisionClient{}
	retryRequest, err := svc.buildLocalDescribeRequest(localDescribeTask(videoHash))
	if err != nil {
		t.Fatal(err)
	}
	if len(retryRequest.Targets) != 1 || retryRequest.Targets[0].SceneIndex != 1 {
		t.Fatalf("retry targets = %+v, want only scene 1", retryRequest.Targets)
	}
	if _, err := svc.describeLocally(context.Background(), secondRound, retryRequest); err != nil {
		t.Fatal(err)
	}
	if secondRound.callCount() != 1 {
		t.Fatalf("retry vision calls = %d, want 1 (only the failed scene)", secondRound.callCount())
	}
	if got := secondRound.calledIndexes(); len(got) != 1 || got[0] != 1 {
		t.Fatalf("retry called indexes = %v, want [1]", got)
	}
}

// sceneDescriptionUpdatesFrom 把 describe result 转成 UpdateDescriptions 入参（测试辅助）。
func sceneDescriptionUpdatesFrom(result []byte) []repository.SceneDescriptionUpdate {
	updates, err := sceneDescriptionUpdates(result)
	if err != nil {
		return nil
	}
	return updates
}

// ==================== 描述路径选择 ====================

func TestDescribeLocalClientNilWhenNoCustomModel(t *testing.T) {
	svc := &VideoAnalysisService{}
	if client := svc.describeLocalClient(); client != nil {
		t.Fatalf("client = %v, want nil (falls back to remote describe job)", client)
	}
}

func TestDescribeLocalClientUsesInjectedClient(t *testing.T) {
	injected := &fakeVisionClient{}
	svc := &VideoAnalysisService{localDescribe: injected}
	if got := svc.describeLocalClient(); got != injected {
		t.Fatalf("client = %v, want injected fake", got)
	}
}

// TestDescribeLocallyMarksCanceledScenesAsFailed 验证上下文被取消（超时或不可重试错误）时，
// 未派发的场景计入失败。
func TestDescribeLocallyMarksCanceledScenesAsFailed(t *testing.T) {
	svc, _, videoHash := newLocalDescribeFixture(t, threeSceneFixture(0))
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 一开始就取消：所有场景都进不了派发

	outcome, err := svc.describeLocally(ctx, &fakeVisionClient{}, localDescribeRequest{
		VideoHash: videoHash,
		Targets: []sceneDescriptionTarget{
			{SceneIndex: 0, GridImage: "scene_000.jpg"},
			{SceneIndex: 1, GridImage: "scene_001.jpg"},
			{SceneIndex: 2, GridImage: "scene_002.jpg"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(outcome.Failed) != 3 {
		t.Fatalf("failed = %v, want all 3 scenes (canceled scenes must not be reported as done)", outcome.Failed)
	}
	var result videoAnalysisDescribeResult
	if err := json.Unmarshal(outcome.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != describeStatusPartial {
		t.Fatalf("status = %q, want partial", result.Status)
	}
}

// TestSceneDescriptionImageDataURLNormalizesBareBase64 验证脱敏回调返回 dataURL、
// 裸 base64、空串时都归一化为 dataURL。
func TestSceneDescriptionImageDataURLNormalizesBareBase64(t *testing.T) {
	dir := t.TempDir()
	imagePath := filepath.Join(dir, "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	want := base64.StdEncoding.EncodeToString([]byte("jpeg-bytes"))

	cases := []struct {
		name        string
		desensitize func(string) string
		wantB64     string
	}{
		{name: "no callback", desensitize: nil, wantB64: want},
		{name: "callback returns dataURL", desensitize: func(string) string {
			return "data:image/png;base64,MASKED"
		}, wantB64: "MASKED"},
		{name: "callback returns bare base64", desensitize: func(string) string {
			return "MASKEDBASE64\n"
		}, wantB64: "MASKEDBASE64"},
		{name: "callback returns empty", desensitize: func(string) string { return "" }, wantB64: want},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := sceneDescriptionImageDataURL(imagePath, tc.desensitize)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(got, "data:") {
				t.Fatalf("result %q must be a dataURL", got)
			}
			_, payload, ok := strings.Cut(got, ",")
			if !ok {
				t.Fatalf("result %q has no payload", got)
			}
			if payload != tc.wantB64 {
				t.Fatalf("payload = %q, want %q", payload, tc.wantB64)
			}
		})
	}
}

// TestDescribeLocalClientRebuildsOnConfigChange 验证配置变更后客户端按新配置重建。
func TestDescribeLocalClientRebuildsOnConfigChange(t *testing.T) {
	cfg := &config.Config{}
	cfg.SetSaveDir(t.TempDir())
	cfg.AI.Providers = []config.AIProviderEntry{{
		ID: "vrouter", Name: "V-Router", APIBase: "http://v-router:8080/v1", Enabled: true,
		Models: []config.AIModelEntry{{Name: "model-hub/test-vlm", IsVision: true}},
	}}
	cfg.AI.ActiveProvider = "vrouter"
	cfg.AI.SceneDescribeAI = config.SceneDescribeAIConfig{ProviderID: "vrouter", Model: "model-hub/test-vlm"}
	svc := &VideoAnalysisService{appCfg: cfg, sceneDescriptionStore: &fakeSceneStore{}}

	first, ok := svc.describeLocalClient().(*openAIVisionClient)
	if !ok || first == nil {
		t.Fatalf("client = %T, want *openAIVisionClient", svc.describeLocalClient())
	}
	if first.apiKey != "" {
		t.Fatalf("api key = %q, want empty", first.apiKey)
	}

	updated := cfg.AISnapshot()
	updated.Providers[0].APIKey = "new-key"
	if err := cfg.UpdateAIConfig(func(ai *config.AIConfig) { *ai = updated }); err != nil {
		t.Fatal(err)
	}

	second := svc.describeLocalClient().(*openAIVisionClient)
	if second.apiKey != "new-key" {
		t.Fatalf("api key after config change = %q, want new-key (client must not be cached)", second.apiKey)
	}
}
