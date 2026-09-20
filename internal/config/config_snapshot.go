package config

// config_snapshot.go 是所有子配置的统一读取入口，与 config_store.go
// （统一写入入口 SaveSection）对称。
//
// 统一方式：一次加锁，返回整节值拷贝。调用方在单次请求/处理内持有
// 该副本使用，期间配置热更新不影响本次处理；同时避免逐字段读取
// 导致的多字段"拼接"状态与未加锁数据竞争。
//
// 写侧对应入口为 UpdateSecrets / UpdateStorage 等 Update* 方法：
// 读走 XxxSnapshot，写走 UpdateXxx。
//
// 覆盖范围说明：仅有运行期写入路径的节需要快照（Secrets/Storage/STRM/
// AdultScraper/VideoAnalysis/AI）。其余节（App/Cache/NSFW/Emby/Registration/
// VOSOIDC）仅在启动加载阶段写入、运行期只读，业务代码可直接字段访问；
// 若未来为这些节新增运行期写入，必须先补 Snapshot 再改造读取方。

// AISnapshot 返回 AI 配置的只读快照（加锁拷贝，避免与运行期写操作竞争）。
// 业务读取 AI 配置应一律通过本方法，保证读到最新状态且无数据竞争。
func (c *Config) AISnapshot() AIConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.AI
}

// SecretsSnapshot 返回 Secrets 配置的线程安全副本。
// 全部为 string 字段，值拷贝即可。
func (c *Config) SecretsSnapshot() SecretsConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Secrets
}

// StorageSnapshot 返回 Storage 配置的线程安全副本。
// 子配置均为纯值结构体（无 map/slice），值拷贝即可。
func (c *Config) StorageSnapshot() StorageConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Storage
}

// STRMSnapshot 返回 STRM 配置的线程安全副本。
// DomainUserAgents/DomainReferers 为 map，深拷贝避免共享底层。
func (c *Config) STRMSnapshot() STRMConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	s := c.STRM
	s.DomainUserAgents = copyStringMap(s.DomainUserAgents)
	s.DomainReferers = copyStringMap(s.DomainReferers)
	return s
}

// AdultScraperSnapshot 返回 AdultScraper 配置的线程安全副本。
// FieldPriority 为 map，深拷贝（复用 deepCopyAdultScraperConfig）。
func (c *Config) AdultScraperSnapshot() AdultScraperConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return deepCopyAdultScraperConfig(c.AdultScraper)
}

// VideoAnalysisSnapshot 返回视频分析配置的线程安全副本。
func (c *Config) VideoAnalysisSnapshot() VideoAnalysisConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.VideoAnalysis
}

// copyStringMap 拷贝 string map（nil 透传 nil）。
func copyStringMap(m map[string]string) map[string]string {
	if m == nil {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
