package config

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/mitchellh/mapstructure"
	secretcrypto "github.com/nowen-video/nowen-video/internal/crypto"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// sectionDirs 查找配置分片文件所在目录的优先顺序。
// 与 Load() 中的 mergeConfigDir 保持一致。
var sectionDirs = []string{"./config", "./data/config", "/etc/nowen-video/config"}

// SaveSection 将某个子配置序列化写入对应的 yaml 分片文件。
//
// 这是所有"运行时可改"子配置的统一持久化入口，替代原有
// saveAIConfig / saveAdultScraperConfig / saveSTRMConfig 中各自手写的
// viper.Set × N 行样板代码。
//
// 敏感字段加密由结构体 tag `enc:"true"` 声明（单一事实源），
// 加载侧由 decryptEncValues 统一解密所有 ENC: 前缀值，读写自动对称。
//
// 参数：
//   - sectionName: viper 命名空间前缀（如 "ai" / "adult_scraper" / "strm"）
//   - fileName:    分片文件名（如 "ai.yaml"）
//   - snapshot:    返回当前子配置副本的闭包（调用方应在调用前确保已持有必要的锁）
//
// 文件格式：分片文件直接存储扁平字段（不加 sectionName 顶层 key），
// 因为 mergeConfigDir 加载时会自动加 prefix（如 "ai." + key）。
// 例如 ai.yaml 内容为：
//   enabled: true
//   active_provider: deepseek
// 而非：
//   ai:
//     enabled: true
//     active_provider: deepseek
func SaveSection[T any](c *Config, sectionName, fileName string, snapshot func() T) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	section := snapshot()

	// 加密带 enc:"true" tag 的敏感字段（对副本操作，不污染内存中的明文）
	encryptStruct(&section)

	// 结构体 → map：用 mapstructure tag 作为 key，保证字段名与 viper 读取时一致
	var m map[string]interface{}
	if err := mapstructure.Decode(section, &m); err != nil {
		return fmt.Errorf("转换配置 %q 失败: %w", sectionName, err)
	}

	// 序列化为 yaml（扁平字段，不加 sectionName 包裹）
	data, err := yaml.Marshal(m)
	if err != nil {
		return fmt.Errorf("序列化配置 %q 失败: %w", sectionName, err)
	}

	// 2. 找到目标分片文件路径（优先保证可写，找不到则用默认 ./config/fileName）
	targetFile := c.sectionFileTarget(fileName)

	// 3. 写入文件（直接写扁平字段，不包裹 sectionName）
	if err := os.MkdirAll(filepath.Dir(targetFile), 0o755); err != nil {
		return fmt.Errorf("创建配置目录 %q 失败: %w", filepath.Dir(targetFile), err)
	}
	if err := os.WriteFile(targetFile, data, 0o600); err != nil {
		return fmt.Errorf("写入配置文件 %q 失败: %w", targetFile, err)
	}

	return nil
}

// secretsShard secrets.yaml 分片快照结构。
// 排除 jwt_secret：由 data/.jwt_secret 单独管理，不落入 yaml。
// 代理地址（tmdb_api_proxy 等）非敏感，仅随分片持久化，不加密。
type secretsShard struct {
	TMDbAPIKey         string `mapstructure:"tmdb_api_key" enc:"true"`
	TMDbAPIProxy       string `mapstructure:"tmdb_api_proxy"`
	TMDbImageProxy     string `mapstructure:"tmdb_image_proxy"`
	TMDbNetworkProxy   string `mapstructure:"tmdb_network_proxy"`
	BangumiAccessToken string `mapstructure:"bangumi_access_token" enc:"true"`
	TheTVDBAPIKey      string `mapstructure:"thetvdb_api_key" enc:"true"`
	FanartTVAPIKey     string `mapstructure:"fanart_tv_api_key" enc:"true"`
	DoubanCookie       string `mapstructure:"douban_cookie" enc:"true"`
}

// saveSecretsShard 将 Secrets 子配置持久化到 secrets.yaml 分片文件。
// SaveSection 的 secrets 特化（私有薄封装）：写入/加密/路径选择全在 SaveSection，
// 这里只构造分片快照。用 secretsShard 结构排除 jwt_secret
// （由 data/.jwt_secret 单独管理，不落入 yaml）。
func saveSecretsShard(c *Config) error {
	return SaveSection(c, "secrets", "secrets.yaml", func() secretsShard {
		return secretsShard{
			TMDbAPIKey:         c.Secrets.TMDbAPIKey,
			TMDbAPIProxy:       c.Secrets.TMDbAPIProxy,
			TMDbImageProxy:     c.Secrets.TMDbImageProxy,
			TMDbNetworkProxy:   c.Secrets.TMDbNetworkProxy,
			BangumiAccessToken: c.Secrets.BangumiAccessToken,
			TheTVDBAPIKey:      c.Secrets.TheTVDBAPIKey,
			FanartTVAPIKey:     c.Secrets.FanartTVAPIKey,
			DoubanCookie:       c.Secrets.DoubanCookie,
		}
	})
}

// findWritableSectionFile 查找适合写入分片文件的路径，优先保证可写：
//  1. 已存在且可写的分片文件 → 沿用（保持与旧数据同位置）
//  2. 第一个可写的分片目录 → 在其中创建新文件
//  3. 兜底返回默认路径 ./config/fileName（保持旧行为，由调用方报出原始错误）
//
// 权限位不可靠（跨挂载 uid 漂移时 owner 位无意义），故以实际打开探测为准。
// sectionFileTarget 返回分片文件的落盘路径：saveDir 非空时用它，否则按 sectionDirs 探测。
// 调用方必须已持有 c.mu（SaveSection 在锁内调用），因此这里不加锁。
func (c *Config) sectionFileTarget(fileName string) string {
	if dir := strings.TrimSpace(c.saveDir); dir != "" {
		return filepath.Join(dir, fileName)
	}
	return findWritableSectionFile(fileName)
}

// SetSaveDir 设置分片配置文件落盘目录；传入空串恢复 sectionDirs 探测。
func (c *Config) SetSaveDir(dir string) {
	c.mu.Lock()
	c.saveDir = strings.TrimSpace(dir)
	c.mu.Unlock()
}

func findWritableSectionFile(fileName string) string {
	for _, dir := range sectionDirs {
		p := filepath.Join(dir, fileName)
		if _, err := os.Stat(p); err == nil {
			if writablePath(p) {
				return p
			}
			continue
		}
	}
	for _, dir := range sectionDirs {
		if err := os.MkdirAll(dir, 0o755); err == nil && dirWritable(dir) {
			return filepath.Join(dir, fileName)
		}
	}
	return filepath.Join("./config", fileName)
}

// writablePath 探测现有文件是否可写。
func writablePath(path string) bool {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}

// dirWritable 通过创建/删除探测文件判断目录是否可写。
func dirWritable(dir string) bool {
	probe := filepath.Join(dir, ".write_probe")
	f, err := os.OpenFile(probe, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return false
	}
	_ = f.Close()
	_ = os.Remove(probe)
	return true
}

// walkEncFields 递归遍历 rv（Ptr/Struct/Slice/Array 下钻），对每个 string 字段调用 fn。
// tagged 标识该字段是否带 enc:"true" tag（切片元素为 false）。
func walkEncFields(rv reflect.Value, fn func(fv reflect.Value, tagged bool)) {
	switch rv.Kind() {
	case reflect.Ptr:
		if !rv.IsNil() {
			walkEncFields(rv.Elem(), fn)
		}
	case reflect.Struct:
		rt := rv.Type()
		for i := 0; i < rt.NumField(); i++ {
			fv := rv.Field(i)
			if fv.Kind() == reflect.String {
				fn(fv, rt.Field(i).Tag.Get("enc") == "true")
			} else {
				walkEncFields(fv, fn)
			}
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < rv.Len(); i++ {
			walkEncFields(rv.Index(i), fn)
		}
	}
}

// encryptStruct 对带 `enc:"true"` tag 的 string 字段做加密。
// 支持嵌套 struct 与 []struct 切片下钻；空值与已加密（ENC: 前缀）跳过。
// v 必须传可寻址的 struct（如 &section），否则无法原地修改。
func encryptStruct(v any) {
	walkEncFields(reflect.ValueOf(v), func(fv reflect.Value, tagged bool) {
		if !tagged {
			return
		}
		s := fv.String()
		if s == "" || strings.HasPrefix(s, "ENC:") {
			return
		}
		if enc, err := secretcrypto.Encrypt(s); err != nil {
			// 加密失败保留明文落盘，但必须可见（通常是主密钥异常）
			// 通过 zap 全局 logger 输出（cmd/server 启动时 ReplaceGlobals 接线；
			// cmd 工具需自行接线，否则为 nop）
			zap.S().Warn("配置敏感字段加密失败，明文将写入分片文件", "error", err)
		} else if fv.CanSet() {
			fv.SetString(enc)
		}
	})
}

// decryptEncValues 解密所有 ENC: 前缀的 string 字段。
// ENC: 前缀仅由本包加密写入产生，因此"解密所有 ENC:"无需字段声明，
// 与加密侧（encryptStruct 的 enc tag）天然对称。
// 解不开的密文透传原值；明文与非 string 字段不动。
func decryptEncValues(v any) {
	walkEncFields(reflect.ValueOf(v), func(fv reflect.Value, _ bool) {
		if s := fv.String(); strings.HasPrefix(s, "ENC:") && fv.CanSet() {
			if _, err := secretcrypto.Decrypt(s); err != nil {
				// 解密失败必须可见：密文透传后会被当作凭证发送（如 Bearer ENC:xxx）。
				zap.S().Warn("配置敏感字段解密失败（常见于主密钥变化），密文原样保留；请重新保存对应密钥", "error", err)
			}
			fv.SetString(decryptSecretValue(s))
		}
	})
}
