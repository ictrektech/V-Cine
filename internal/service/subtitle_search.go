package service

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

// SubtitleSearchService 字幕在线搜索服务
// 集成 OpenSubtitles 等主流字幕源，支持自动搜索和下载
type SubtitleSearchService struct {
	logger      *zap.SugaredLogger
	client      *http.Client
	mu          sync.RWMutex
	apiKey      string
	apiBase     string
	token       string
	tokenExpiry time.Time
	cacheDir    string
}

// SubtitleSearchResult 字幕搜索结果
type SubtitleSearchResult struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	FileName      string  `json:"file_name"`
	Language      string  `json:"language"`
	LanguageName  string  `json:"language_name"`
	Format        string  `json:"format"`
	Rating        float64 `json:"rating"`
	DownloadCount int     `json:"download_count"`
	Source        string  `json:"source"`
	DownloadURL   string  `json:"download_url"`
	MovieHash     string  `json:"movie_hash,omitempty"`
	MatchType     string  `json:"match_type"` // hash / title / imdb
}

// SubtitleDownloadResult 字幕下载结果
type SubtitleDownloadResult struct {
	FilePath string `json:"file_path"`
	FileName string `json:"file_name"`
	Language string `json:"language"`
	Format   string `json:"format"`
}

// OpenSubtitles API 响应结构
type osSearchResponse struct {
	TotalPages int              `json:"total_pages"`
	TotalCount int              `json:"total_count"`
	Data       []osSearchResult `json:"data"`
}

type osSearchResult struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Attributes struct {
		SubtitleID       string  `json:"subtitle_id"`
		Language         string  `json:"language"`
		DownloadCount    int     `json:"download_count"`
		NewDownloadCount int     `json:"new_download_count"`
		HearingImpaired  bool    `json:"hearing_impaired"`
		HD               bool    `json:"hd"`
		FPS              float64 `json:"fps"`
		Votes            int     `json:"votes"`
		Ratings          float64 `json:"ratings"`
		FromTrusted      bool    `json:"from_trusted"`
		ForeignPartsOnly bool    `json:"foreign_parts_only"`
		MovieHashMatch   bool    `json:"moviehash_match"`
		Release          string  `json:"release"`
		FeatureDetails   struct {
			Title     string `json:"title"`
			Year      int    `json:"year"`
			MovieName string `json:"movie_name"`
		} `json:"feature_details"`
		Files []struct {
			FileID   int    `json:"file_id"`
			FileName string `json:"file_name"`
		} `json:"files"`
	} `json:"attributes"`
}

type osDownloadResponse struct {
	Link      string `json:"link"`
	FileName  string `json:"file_name"`
	Remaining int    `json:"remaining"`
}

func NewSubtitleSearchService(apiKey string, cacheDir string, logger *zap.SugaredLogger) *SubtitleSearchService {
	return &SubtitleSearchService{
		logger: logger,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		apiKey:   apiKey,
		apiBase:  "https://api.opensubtitles.com/api/v1",
		cacheDir: filepath.Join(cacheDir, "subtitles"),
	}
}

// SetAPIKey 设置 OpenSubtitles API Key
func (s *SubtitleSearchService) SetAPIKey(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.apiKey = key
}

// IsConfigured 检查是否已配置 API Key
func (s *SubtitleSearchService) IsConfigured() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.apiKey != ""
}

// SearchByTitle 根据标题搜索字幕
func (s *SubtitleSearchService) SearchByTitle(title string, year int, language string, mediaType string) ([]SubtitleSearchResult, error) {
	s.mu.RLock()
	apiKey := s.apiKey
	s.mu.RUnlock()

	if apiKey == "" {
		return nil, fmt.Errorf("OpenSubtitles API Key 未配置")
	}

	params := url.Values{}
	params.Set("query", title)
	if year > 0 {
		params.Set("year", fmt.Sprintf("%d", year))
	}
	if language != "" {
		params.Set("languages", language)
	}
	if mediaType == "episode" {
		params.Set("type", "episode")
	} else {
		params.Set("type", "movie")
	}

	reqURL := fmt.Sprintf("%s/subtitles?%s", s.apiBase, params.Encode())
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Api-Key", apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nowen-video v1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("OpenSubtitles API 返回错误: HTTP %d", resp.StatusCode)
	}

	var osResp osSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&osResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	return s.convertResults(osResp.Data), nil
}

// SearchByHash 根据文件哈希搜索字幕（更精确）
func (s *SubtitleSearchService) SearchByHash(filePath string, language string) ([]SubtitleSearchResult, error) {
	s.mu.RLock()
	apiKey := s.apiKey
	s.mu.RUnlock()

	if apiKey == "" {
		return nil, fmt.Errorf("OpenSubtitles API Key 未配置")
	}

	// 计算文件哈希
	hash, err := computeOpenSubtitlesHash(filePath)
	if err != nil {
		s.logger.Warnw("计算文件哈希失败，回退到标题搜索", "error", err)
		return nil, err
	}

	params := url.Values{}
	params.Set("moviehash", hash)
	if language != "" {
		params.Set("languages", language)
	}

	reqURL := fmt.Sprintf("%s/subtitles?%s", s.apiBase, params.Encode())
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Api-Key", apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nowen-video v1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("OpenSubtitles API 返回错误: HTTP %d", resp.StatusCode)
	}

	var osResp osSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&osResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	return s.convertResults(osResp.Data), nil
}

// Download 下载字幕文件
func (s *SubtitleSearchService) Download(fileID string, mediaFilePath string) (*SubtitleDownloadResult, error) {
	s.mu.RLock()
	apiKey := s.apiKey
	s.mu.RUnlock()

	if apiKey == "" {
		return nil, fmt.Errorf("OpenSubtitles API Key 未配置")
	}

	// 请求下载链接
	payload := map[string]interface{}{
		"file_id": fileID,
	}
	body, _ := json.Marshal(payload)

	reqURL := fmt.Sprintf("%s/download", s.apiBase)
	req, err := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("创建下载请求失败: %w", err)
	}

	req.Header.Set("Api-Key", apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nowen-video v1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("下载请求返回错误: HTTP %d", resp.StatusCode)
	}

	var dlResp osDownloadResponse
	if err := json.NewDecoder(resp.Body).Decode(&dlResp); err != nil {
		return nil, fmt.Errorf("解析下载响应失败: %w", err)
	}

	// 下载字幕文件
	subResp, err := s.client.Get(dlResp.Link)
	if err != nil {
		return nil, fmt.Errorf("下载字幕文件失败: %w", err)
	}
	defer subResp.Body.Close()

	// 确定保存路径（与媒体文件同目录）
	mediaDir := filepath.Dir(mediaFilePath)
	mediaBase := strings.TrimSuffix(filepath.Base(mediaFilePath), filepath.Ext(mediaFilePath))
	subExt := filepath.Ext(dlResp.FileName)
	if subExt == "" {
		subExt = ".srt"
	}

	// 生成字幕文件名：视频名.语言.srt
	subFileName := fmt.Sprintf("%s%s", mediaBase, subExt)
	subFilePath := filepath.Join(mediaDir, subFileName)

	// 写入文件
	outFile, err := os.Create(subFilePath)
	if err != nil {
		// 如果媒体目录不可写，保存到缓存目录
		os.MkdirAll(s.cacheDir, 0755)
		subFilePath = filepath.Join(s.cacheDir, subFileName)
		outFile, err = os.Create(subFilePath)
		if err != nil {
			return nil, fmt.Errorf("创建字幕文件失败: %w", err)
		}
	}
	defer outFile.Close()

	if _, err := io.Copy(outFile, subResp.Body); err != nil {
		return nil, fmt.Errorf("写入字幕文件失败: %w", err)
	}

	s.logger.Infof("字幕下载成功: %s -> %s", dlResp.FileName, subFilePath)

	return &SubtitleDownloadResult{
		FilePath: subFilePath,
		FileName: subFileName,
		Language: "",
		Format:   strings.TrimPrefix(subExt, "."),
	}, nil
}

// convertResults 转换 OpenSubtitles 结果为统一格式
func (s *SubtitleSearchService) convertResults(data []osSearchResult) []SubtitleSearchResult {
	results := make([]SubtitleSearchResult, 0, len(data))

	for _, item := range data {
		attrs := item.Attributes
		fileName := ""
		fileID := ""
		if len(attrs.Files) > 0 {
			fileName = attrs.Files[0].FileName
			fileID = fmt.Sprintf("%d", attrs.Files[0].FileID)
		}

		matchType := "title"
		if attrs.MovieHashMatch {
			matchType = "hash"
		}

		results = append(results, SubtitleSearchResult{
			ID:            fileID,
			Title:         attrs.FeatureDetails.Title,
			FileName:      fileName,
			Language:      attrs.Language,
			LanguageName:  getLanguageName(attrs.Language),
			Format:        getSubtitleFormat(fileName),
			Rating:        attrs.Ratings,
			DownloadCount: attrs.DownloadCount,
			Source:        "opensubtitles",
			DownloadURL:   "",
			MatchType:     matchType,
		})
	}

	return results
}

// computeOpenSubtitlesHash 计算 OpenSubtitles 文件哈希
// 使用文件前后各 64KB 的 MD5 作为简化哈希
func computeOpenSubtitlesHash(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return "", err
	}

	if fi.Size() < 131072 { // 文件太小
		return "", fmt.Errorf("文件太小，无法计算哈希")
	}

	h := md5.New()

	// 读取前 64KB
	buf := make([]byte, 65536)
	if _, err := io.ReadFull(f, buf); err != nil {
		return "", err
	}
	h.Write(buf)

	// 读取后 64KB
	if _, err := f.Seek(-65536, io.SeekEnd); err != nil {
		return "", err
	}
	if _, err := io.ReadFull(f, buf); err != nil {
		return "", err
	}
	h.Write(buf)

	return hex.EncodeToString(h.Sum(nil)), nil
}

// getLanguageName 获取语言显示名称
func getLanguageName(code string) string {
	names := map[string]string{
		"zh-cn": "简体中文", "zh-tw": "繁体中文", "en": "English",
		"ja": "日本語", "ko": "한국어", "fr": "Français",
		"de": "Deutsch", "es": "Español", "pt": "Português",
		"ru": "Русский", "it": "Italiano", "ar": "العربية",
		"th": "ไทย", "vi": "Tiếng Việt",
	}
	if name, ok := names[strings.ToLower(code)]; ok {
		return name
	}
	return code
}

// getSubtitleFormat 从文件名获取字幕格式
func getSubtitleFormat(fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".srt":
		return "srt"
	case ".ass", ".ssa":
		return "ass"
	case ".vtt":
		return "vtt"
	case ".sub":
		return "sub"
	default:
		return "srt"
	}
}
