package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"errors"
	"go.uber.org/zap"
)

// ==================== Alist 聚合网盘文件系统（V2.3）====================
//
// Alist 是一个支持多种网盘的统一文件列表程序（https://alist.nn.ci/）。
// 通过对接 Alist HTTP API，Nowen 可以一站式访问 20+ 网盘（阿里云盘/115/夸克/
// 百度网盘/OneDrive/Google Drive/FTP/SMB 等），无需为每家单独适配 SDK。
//
// 核心 API：
//   POST /api/auth/login           登录换 Token
//   POST /api/fs/list              列目录
//   POST /api/fs/get               获取文件信息（包含直链）
//
// 播放策略：
//   通过 /api/fs/get 拿到 raw_url（直链）后，使用 HTTP Range 请求访问，
//   直链通常支持 Range，seek/转码均可正常工作。

// ==================== Alist API 响应结构 ====================

type alistResp struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type alistLoginData struct {
	Token string `json:"token"`
}

type alistFileInfo struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	IsDir    bool   `json:"is_dir"`
	Modified string `json:"modified"`
	Sign     string `json:"sign"`
	Thumb    string `json:"thumb"`
	Type     int    `json:"type"`
	RawURL   string `json:"raw_url"` // 仅 /api/fs/get 返回
}

type alistListData struct {
	Content []alistFileInfo `json:"content"`
	Total   int             `json:"total"`
}

// ==================== AlistFS 实现 ====================

// AlistFS Alist 聚合网盘文件系统
type AlistFS struct {
	serverURL string
	basePath  string
	username  string
	password  string
	logger    *zap.SugaredLogger

	httpClient *http.Client

	// Token 管理
	tokenMu   sync.RWMutex
	token     string
	tokenFrom string // "config" | "login"

	// 元数据缓存
	cache *metadataCache

	// ReadAt 块缓存
	blockSize  int64
	blockCount int
}

// NewAlistFS 创建 Alist 文件系统实例
func NewAlistFS(serverURL, username, password, token, basePath string,
	timeoutSec, cacheTTLHours int, cacheEnabled bool,
	logger *zap.SugaredLogger) *AlistFS {
	if timeoutSec <= 0 {
		timeoutSec = 30
	}
	ttl := time.Duration(cacheTTLHours) * time.Hour
	if cacheTTLHours <= 0 {
		ttl = 0
		cacheEnabled = false
	}
	f := &AlistFS{
		serverURL: strings.TrimRight(serverURL, "/"),
		basePath:  normalizeAlistPath(basePath),
		username:  username,
		password:  password,
		logger:    logger,
		httpClient: &http.Client{
			Timeout: time.Duration(timeoutSec) * time.Second,
		},
		cache:      newMetadataCache(cacheEnabled, ttl),
		blockSize:  defaultWebDAVBlockSize,
		blockCount: defaultWebDAVBlockCount,
	}
	if token != "" {
		f.token = token
		f.tokenFrom = "config"
	}
	return f
}

// SetBlockCacheConfig 调整 ReadAt 块缓存参数
func (a *AlistFS) SetBlockCacheConfig(blockSize int64, blockCount int) {
	a.blockSize = blockSize
	a.blockCount = blockCount
}

// Type 返回类型标识
func (a *AlistFS) Type() string { return "alist" }

// ==================== 路径规范化 ====================

// normalizeAlistPath 规范化 Alist 路径（统一为 /aaa/bbb 形式）
func normalizeAlistPath(p string) string {
	if p == "" {
		return "/"
	}
	p = strings.ReplaceAll(p, "\\", "/")
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	p = path.Clean(p)
	return p
}

// buildFullPath 拼接 basePath 与请求路径
func (a *AlistFS) buildFullPath(p string) string {
	if a.basePath == "" || a.basePath == "/" {
		return normalizeAlistPath(p)
	}
	p = normalizeAlistPath(p)
	if p == "/" {
		return a.basePath
	}
	return normalizeAlistPath(a.basePath + p)
}

// ==================== Token 管理 ====================

func (a *AlistFS) getToken(ctx context.Context) (string, error) {
	a.tokenMu.RLock()
	tk := a.token
	a.tokenMu.RUnlock()
	if tk != "" {
		return tk, nil
	}

	if a.username == "" {
		return "", fmt.Errorf("Alist 未配置 Token 且未配置用户名，无法登录")
	}

	a.tokenMu.Lock()
	defer a.tokenMu.Unlock()
	// 双检
	if a.token != "" {
		return a.token, nil
	}

	body := map[string]string{
		"username": a.username,
		"password": a.password,
	}
	var data alistLoginData
	if err := a.callAPI(ctx, "/api/auth/login", body, &data, false); err != nil {
		return "", fmt.Errorf("Alist 登录失败: %w", err)
	}
	if data.Token == "" {
		return "", fmt.Errorf("Alist 登录返回空 Token")
	}
	a.token = data.Token
	a.tokenFrom = "login"
	a.logger.Infof("Alist 登录成功，已获取 Token (用户: %s)", a.username)
	return a.token, nil
}

// clearTokenOnAuthFail 清除 Token（遇到 401/403 时调用，下次重新登录）
func (a *AlistFS) clearTokenOnAuthFail() {
	a.tokenMu.Lock()
	defer a.tokenMu.Unlock()
	// 仅清除 login 获取的 Token，配置 Token 保留
	if a.tokenFrom == "login" {
		a.token = ""
	}
}

// ==================== HTTP API 调用 ====================

// callAPI 调用 Alist JSON API
func (a *AlistFS) callAPI(ctx context.Context, apiPath string, body interface{}, out interface{}, needAuth bool) error {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("序列化请求体失败: %w", err)
		}
		reqBody = bytes.NewReader(data)
	}

	fullURL := a.serverURL + apiPath
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fullURL, reqBody)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "v-cine/1.0")

	if needAuth {
		token, err := a.getToken(ctx)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", token)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP 请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		a.clearTokenOnAuthFail()
		return fmt.Errorf("Alist 认证失败 (状态码 %d)", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Alist API 状态码错误 %d: %s", resp.StatusCode, string(respBody))
	}

	var ar alistResp
	if err := json.NewDecoder(resp.Body).Decode(&ar); err != nil {
		return fmt.Errorf("解析响应失败: %w", err)
	}
	if ar.Code != 200 {
		// Alist 的 401 会以 Code=401 返回
		if ar.Code == 401 || ar.Code == 403 {
			a.clearTokenOnAuthFail()
		}
		return fmt.Errorf("Alist API 业务错误 (code=%d): %s", ar.Code, ar.Message)
	}
	if out != nil && len(ar.Data) > 0 {
		if err := json.Unmarshal(ar.Data, out); err != nil {
			return fmt.Errorf("解析 data 字段失败: %w", err)
		}
	}
	return nil
}

// ==================== 目录 / 文件信息 ====================

type alistDirEntry struct {
	info alistFileInfo
}

func (e *alistDirEntry) Name() string { return e.info.Name }
func (e *alistDirEntry) IsDir() bool  { return e.info.IsDir }
func (e *alistDirEntry) Type() fs.FileMode {
	if e.info.IsDir {
		return fs.ModeDir
	}
	return 0
}
func (e *alistDirEntry) Info() (fs.FileInfo, error) {
	return newAlistFileInfo(e.info), nil
}

// alistFileInfoImpl 实现 os.FileInfo
type alistFileInfoImpl struct {
	name    string
	size    int64
	isDir   bool
	modTime time.Time
}

func (f *alistFileInfoImpl) Name() string { return f.name }
func (f *alistFileInfoImpl) Size() int64  { return f.size }
func (f *alistFileInfoImpl) Mode() fs.FileMode {
	if f.isDir {
		return fs.ModeDir | 0555
	}
	return 0444
}
func (f *alistFileInfoImpl) ModTime() time.Time { return f.modTime }
func (f *alistFileInfoImpl) IsDir() bool        { return f.isDir }
func (f *alistFileInfoImpl) Sys() interface{}   { return nil }

func newAlistFileInfo(info alistFileInfo) os.FileInfo {
	t, _ := time.Parse(time.RFC3339, info.Modified)
	return &alistFileInfoImpl{
		name:    info.Name,
		size:    info.Size,
		isDir:   info.IsDir,
		modTime: t,
	}
}

// ==================== VFS 接口实现 ====================

// ReadDir 列出目录
func (a *AlistFS) ReadDir(p string) ([]fs.DirEntry, error) {
	p = normalizeAlistPath(p)

	// 缓存命中？
	if entries, ok := a.cache.getDir(p); ok {
		return entries, nil
	}

	content, err := a.fetchDir(p, 0, false)
	if err != nil {
		return nil, err
	}

	entries := make([]fs.DirEntry, 0, len(content))
	for _, f := range content {
		entries = append(entries, &alistDirEntry{info: f})
	}

	a.cache.setDir(p, entries)
	return entries, nil
}

// fetchDir 调用 Alist /api/fs/list，不读写本地缓存。
func (a *AlistFS) fetchDir(p string, perPage int, refresh bool) ([]alistFileInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), a.httpClient.Timeout)
	defer cancel()
	return a.fetchDirContext(ctx, p, perPage, refresh)
}

func (a *AlistFS) fetchDirContext(ctx context.Context, p string, perPage int, refresh bool) ([]alistFileInfo, error) {
	body := map[string]interface{}{
		"path":     a.buildFullPath(p),
		"password": "",
		"page":     1,
		"per_page": perPage,
		"refresh":  refresh,
	}
	var ld alistListData
	if err := a.callAPI(ctx, "/api/fs/list", body, &ld, true); err != nil {
		return nil, err
	}
	return ld.Content, nil
}

// Probe 绕过本地缓存做一次真实网络探测，用于状态检查。
func (a *AlistFS) Probe() error {
	return a.ProbeContext(context.Background())
}

// ProbeContext 支持上下文取消的连通性探测。
func (a *AlistFS) ProbeContext(ctx context.Context) error {
	_, err := a.fetchDirContext(ctx, "/", 1, true)
	return err
}

// Stat 获取文件信息
func (a *AlistFS) Stat(p string) (fs.FileInfo, error) {
	p = normalizeAlistPath(p)

	if info, ok := a.cache.getStat(p); ok {
		return info, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), a.httpClient.Timeout)
	defer cancel()

	body := map[string]interface{}{
		"path":     a.buildFullPath(p),
		"password": "",
	}
	var af alistFileInfo
	if err := a.callAPI(ctx, "/api/fs/get", body, &af, true); err != nil {
		return nil, err
	}
	info := newAlistFileInfo(af)

	a.cache.setStat(p, info)
	if af.RawURL != "" {
		a.cache.setString(p, af.RawURL, a.urlCacheTTL())
	}
	return info, nil
}

// getRawURL 获取文件直链（带缓存）
func (a *AlistFS) getRawURL(p string) (string, error) {
	p = normalizeAlistPath(p)

	if s, ok := a.cache.getString(p); ok {
		return s, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), a.httpClient.Timeout)
	defer cancel()

	body := map[string]interface{}{
		"path":     a.buildFullPath(p),
		"password": "",
	}
	var af alistFileInfo
	if err := a.callAPI(ctx, "/api/fs/get", body, &af, true); err != nil {
		return "", err
	}
	if af.RawURL == "" {
		return "", fmt.Errorf("Alist 未返回直链 (path=%s)", p)
	}

	a.cache.setString(p, af.RawURL, a.urlCacheTTL())
	return af.RawURL, nil
}

// urlCacheTTL 直链缓存 TTL（限最长 30 分钟，避免过期签名）
func (a *AlistFS) urlCacheTTL() time.Duration {
	if a.cache.ttl > 30*time.Minute {
		return 30 * time.Minute
	}
	return a.cache.ttl
}

// Open 打开文件（返回支持 ReadAt 的 VFSFile）
func (a *AlistFS) Open(p string) (VFSFile, error) {
	p = normalizeAlistPath(p)
	info, err := a.Stat(p)
	if err != nil {
		return nil, err
	}

	f := &alistFile{
		fs:         a,
		remotePath: p,
		stat:       info,
	}
	if !info.IsDir() && a.blockSize > 0 && a.blockCount > 0 {
		f.blockCache = newWebDAVBlockCache(a.blockSize, a.blockCount)
	}
	return f, nil
}

// Walk 递归遍历
func (a *AlistFS) Walk(root string, fn filepath.WalkFunc) error {
	return walkRemote(a, root, fn)
}

// GetHTTPURL 返回可供 FFmpeg 等外部工具使用的 HTTP 直链（V2.3）
func (a *AlistFS) GetHTTPURL(p string) (string, error) {
	return a.getRawURL(p)
}

// ==================== alistFile 文件实现 ====================

type alistFile struct {
	fs         *AlistFS
	remotePath string
	stat       fs.FileInfo

	mu     sync.Mutex
	reader io.ReadCloser
	offset int64

	blockCache *webdavBlockCache
}

func (f *alistFile) Stat() (fs.FileInfo, error) {
	return f.stat, nil
}

// Read 顺序读取
func (f *alistFile) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.reader == nil {
		rc, err := f.openRangeReader(0, -1)
		if err != nil {
			return 0, err
		}
		f.reader = rc
	}
	n, err := f.reader.Read(p)
	f.offset += int64(n)
	return n, err
}

// ReadAt 随机读取（优先走缓存）
func (f *alistFile) ReadAt(p []byte, off int64) (int, error) {
	fileSize := int64(-1)
	if f.stat != nil {
		fileSize = f.stat.Size()
	}
	return readAtCached(f.blockCache, fileSize, f.readAtDirect, p, off)
}

// readAtDirect 直连 Range 请求
func (f *alistFile) readAtDirect(p []byte, off int64) (int, error) {
	rc, err := f.openRangeReader(off, int64(len(p)))
	if err != nil {
		return 0, err
	}
	defer rc.Close()

	total := 0
	for total < len(p) {
		n, rerr := rc.Read(p[total:])
		total += n
		if errors.Is(rerr, io.EOF) {
			if total == 0 {
				return 0, io.EOF
			}
			return total, io.EOF
		}
		if rerr != nil {
			return total, rerr
		}
	}
	return total, nil
}

// openRangeReader 发起 Range HTTP 请求，返回 ReadCloser
// length < 0 表示读到文件末尾
func (f *alistFile) openRangeReader(off, length int64) (io.ReadCloser, error) {
	rawURL, err := f.fs.getRawURL(f.remotePath)
	if err != nil {
		return nil, err
	}
	// 使用 HEAD 一致的 HTTP client
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("解析直链失败: %w", err)
	}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if length > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", off, off+length-1))
	} else if off > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", off))
	}
	req.Header.Set("User-Agent", "v-cine/1.0")

	// 使用更长超时的 client 专用于流读取
	client := &http.Client{
		Timeout: 0, // 流式读取不设总超时
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求直链失败: %w", err)
	}
	if resp.StatusCode >= 400 {
		resp.Body.Close()
		// 403 可能是签名过期 → 清缓存并重试一次
		if resp.StatusCode == 403 {
			f.fs.cache.deleteString(f.remotePath)
		}
		return nil, fmt.Errorf("直链请求状态码 %d", resp.StatusCode)
	}
	return resp.Body, nil
}

// Close 关闭文件
func (f *alistFile) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.blockCache != nil {
		f.blockCache.clear()
		f.blockCache = nil
	}
	if f.reader != nil {
		err := f.reader.Close()
		f.reader = nil
		return err
	}
	return nil
}
