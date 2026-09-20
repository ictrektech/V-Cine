package service

import (
	"fmt"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"go.uber.org/zap"
)

// ==================== 远程存储统一服务（V2.3）====================
//
// RemoteStorageService 统一管理 Alist 与 S3 的初始化、连接测试、状态查询，
// 与已有的 WebDAVService 形成并列关系：
//
//   WebDAVService    -> webdav://
//   RemoteStorageService.alist -> alist://
//   RemoteStorageService.s3    -> s3://
//
// 所有实例通过 VFSManager.SetGlobalXxxFS 注入到全局 VFS 路由表。

// storageTestTimeoutSec 是“测试连接”时使用的最大等待秒数。
// 测试连接没必要等用户配置的 30s，统一封顶，让前端按钮尽快返回。
const storageTestTimeoutSec = 8

type RemoteStorageService struct {
	config *config.Config
	logger *zap.SugaredLogger
	vfsMgr *VFSManager

	mu      sync.RWMutex
	alistFS *AlistFS
	s3FS    *S3FS
}

// NewRemoteStorageService 创建统一远程存储服务
func NewRemoteStorageService(cfg *config.Config, logger *zap.SugaredLogger, vfsMgr *VFSManager) *RemoteStorageService {
	return &RemoteStorageService{
		config: cfg,
		logger: logger,
		vfsMgr: vfsMgr,
	}
}

// Initialize 初始化所有已启用的远程存储
func (s *RemoteStorageService) Initialize() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 清理旧注入
	s.vfsMgr.SetGlobalAlistFS(nil)
	s.vfsMgr.SetGlobalS3FS(nil)

	// ---- Alist ----
	if s.config.StorageSnapshot().Alist.Enabled {
		// 启动时不测试连接，避免慢/不可达阻塞启动
		if err := s.initAlistLocked(false); err != nil {
			s.logger.Warnf("Alist 初始化失败: %v", err)
		}
	} else {
		s.logger.Info("Alist 存储未启用")
	}

	// ---- S3 ----
	if s.config.StorageSnapshot().S3.Enabled {
		// 启动时不测试连接，避免慢/不可达阻塞启动
		if err := s.initS3Locked(false); err != nil {
			s.logger.Warnf("S3 初始化失败: %v", err)
		}
	} else {
		s.logger.Info("S3 存储未启用")
	}

	return nil
}

// initAlistLocked 必须持有 s.mu。testConn 为 true 时（配置保存）同步验证连接。
func (s *RemoteStorageService) initAlistLocked(testConn bool) error {
	cfg := s.config.StorageSnapshot().Alist
	if cfg.ServerURL == "" {
		return fmt.Errorf("Alist 服务器地址不能为空")
	}

	fs := NewAlistFS(
		cfg.ServerURL, cfg.Username, cfg.Password, cfg.Token,
		cfg.BasePath, cfg.Timeout, cfg.CacheTTLHours, cfg.EnableCache,
		s.logger,
	)
	blockSize := int64(cfg.ReadBlockSizeMB) * 1024 * 1024
	fs.SetBlockCacheConfig(blockSize, cfg.ReadBlockCount)

	if testConn {
		if err := probeVFS(fs, time.Duration(storageTestTimeoutSec)*time.Second); err != nil {
			return fmt.Errorf("Alist 连接测试失败: %w", err)
		}
	}

	s.alistFS = fs
	s.vfsMgr.SetGlobalAlistFS(fs)
	s.logger.Infof("Alist 服务初始化成功: %s (BasePath=%s)", cfg.ServerURL, cfg.BasePath)
	return nil
}

// initS3Locked 必须持有 s.mu。testConn 为 true 时（配置保存）同步验证连接。
func (s *RemoteStorageService) initS3Locked(testConn bool) error {
	cfg := s.config.StorageSnapshot().S3
	if cfg.Endpoint == "" {
		return fmt.Errorf("S3 Endpoint 不能为空")
	}
	if cfg.Bucket == "" {
		return fmt.Errorf("S3 Bucket 不能为空")
	}
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return fmt.Errorf("S3 AccessKey / SecretKey 不能为空")
	}

	fs := NewS3FS(
		cfg.Endpoint, cfg.Region, cfg.AccessKey, cfg.SecretKey,
		cfg.Bucket, cfg.BasePath, cfg.PathStyle,
		cfg.Timeout, cfg.CacheTTLHours, cfg.EnableCache,
		s.logger,
	)
	blockSize := int64(cfg.ReadBlockSizeMB) * 1024 * 1024
	fs.SetBlockCacheConfig(blockSize, cfg.ReadBlockCount)

	if testConn {
		if err := probeVFS(fs, time.Duration(storageTestTimeoutSec)*time.Second); err != nil {
			return fmt.Errorf("S3 连接测试失败: %w", err)
		}
	}

	s.s3FS = fs
	s.vfsMgr.SetGlobalS3FS(fs)
	s.logger.Infof("S3 服务初始化成功: %s/%s", cfg.Endpoint, cfg.Bucket)
	return nil
}

// TestAlist 测试 Alist 连接（不修改全局状态）
func (s *RemoteStorageService) TestAlist(cfg config.AlistConfig) error {
	if cfg.ServerURL == "" {
		return fmt.Errorf("Alist 服务器地址不能为空")
	}
	cfg.Timeout = storageTestTimeoutSec
	fs := NewAlistFS(
		cfg.ServerURL, cfg.Username, cfg.Password, cfg.Token,
		cfg.BasePath, cfg.Timeout, 0, false, // 测试时不启用缓存
		s.logger,
	)
	if err := fs.Probe(); err != nil {
		return fmt.Errorf("Alist 连接测试失败: %w", err)
	}
	return nil
}

// TestS3 测试 S3 连接
func (s *RemoteStorageService) TestS3(cfg config.S3Config) error {
	if cfg.Endpoint == "" {
		return fmt.Errorf("S3 Endpoint 不能为空")
	}
	cfg.Timeout = storageTestTimeoutSec
	fs := NewS3FS(
		cfg.Endpoint, cfg.Region, cfg.AccessKey, cfg.SecretKey,
		cfg.Bucket, cfg.BasePath, cfg.PathStyle,
		cfg.Timeout, 0, false,
		s.logger,
	)
	if err := fs.Probe(); err != nil {
		return fmt.Errorf("S3 连接测试失败: %w", err)
	}
	return nil
}

// UpdateAlistConfig 更新 Alist 配置并重初始化
func (s *RemoteStorageService) UpdateAlistConfig(cfg config.AlistConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.config.UpdateStorageInMemory(func(st *config.StorageConfig) { st.Alist = cfg })
	s.alistFS = nil
	s.vfsMgr.SetGlobalAlistFS(nil)
	if cfg.Enabled {
		// 保存配置时同步验证连接
		return s.initAlistLocked(true)
	}
	return nil
}

// UpdateS3Config 更新 S3 配置并重初始化
func (s *RemoteStorageService) UpdateS3Config(cfg config.S3Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.config.UpdateStorageInMemory(func(st *config.StorageConfig) { st.S3 = cfg })
	s.s3FS = nil
	s.vfsMgr.SetGlobalS3FS(nil)
	if cfg.Enabled {
		// 保存配置时同步验证连接
		return s.initS3Locked(true)
	}
	return nil
}

// applyStorageProbeStatus 对远程存储做有界探测并写入状态 map。
func applyStorageProbeStatus(p Prober, status map[string]interface{}) {
	// 有界探测：远端不可达时最多等 2s，避免状态接口长时间阻塞
	if err := probeVFS(p, 2*time.Second); err == nil {
		status["connected"] = true
	} else {
		status["connected"] = false
		status["error"] = err.Error()
	}
}

// GetAlistStatus 获取 Alist 单存储状态（独立探测，互不阻塞）。
func (s *RemoteStorageService) GetAlistStatus() map[string]interface{} {
	s.mu.RLock()
	cfg := s.config.StorageSnapshot().Alist
	fs := s.alistFS
	s.mu.RUnlock()

	status := map[string]interface{}{
		"enabled":    cfg.Enabled,
		"server_url": cfg.ServerURL,
		"base_path":  cfg.BasePath,
		"connected":  false,
	}
	if fs != nil {
		applyStorageProbeStatus(fs, status)
	}
	return status
}

// GetS3Status 获取 S3 单存储状态（独立探测，互不阻塞）。
func (s *RemoteStorageService) GetS3Status() map[string]interface{} {
	s.mu.RLock()
	cfg := s.config.StorageSnapshot().S3
	fs := s.s3FS
	s.mu.RUnlock()

	status := map[string]interface{}{
		"enabled":    cfg.Enabled,
		"endpoint":   cfg.Endpoint,
		"bucket":     cfg.Bucket,
		"region":     cfg.Region,
		"path_style": cfg.PathStyle,
		"connected":  false,
	}
	if fs != nil {
		applyStorageProbeStatus(fs, status)
	}
	return status
}

// GetAlistFS 获取已初始化的 AlistFS（可能为 nil）
func (s *RemoteStorageService) GetAlistFS() *AlistFS {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.alistFS
}

// GetS3FS 获取已初始化的 S3FS（可能为 nil）
func (s *RemoteStorageService) GetS3FS() *S3FS {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.s3FS
}

// Close 关闭并清理所有远程存储
func (s *RemoteStorageService) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.vfsMgr.SetGlobalAlistFS(nil)
	s.vfsMgr.SetGlobalS3FS(nil)
	s.alistFS = nil
	s.s3FS = nil
	s.logger.Info("远程存储服务已关闭")
	return nil
}
