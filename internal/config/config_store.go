package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/mitchellh/mapstructure"
	secretcrypto "github.com/nowen-video/nowen-video/internal/crypto"
	"gopkg.in/yaml.v3"
)

// sectionDirs 查找配置分片文件所在目录的优先顺序。
// 与 Load() 中的 mergeConfigDir 保持一致。
var sectionDirs = []string{"./config", "./data/config", "/etc/nowen-video/config"}

// SaveSection 将某个子配置序列化写入对应的 yaml 分片文件。
//
// 这是所有"运行时可改"子配置的统一持久化入口，替代原有
// SaveAIConfig / SaveAdultScraperConfig / SaveSTRMConfig 中各自手写的
// viper.Set × N 行样板代码。
//
// 参数：
//   - sectionName:  viper 命名空间前缀（如 "ai" / "adult_scraper" / "strm"），用于清除旧残留
//   - fileName:     分片文件名（如 "ai.yaml"）
//   - encryptPaths: 需要加密的字段路径列表（如 ["api_key", "scene_describe_ai.api_key"]），为空则不加密
//   - snapshot:     返回当前子配置副本的闭包（调用方应在调用前确保已持有必要的锁）
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
func SaveSection[T any](c *Config, sectionName, fileName string, encryptPaths []string, snapshot func() T) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return saveSectionLocked(c, sectionName, fileName, encryptPaths, snapshot)
}

// saveSectionLocked 是 SaveSection 的锁内实现，调用方必须已持有 c.mu。
func saveSectionLocked[T any](c *Config, sectionName, fileName string, encryptPaths []string, snapshot func() T) error {
	section := snapshot()

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

	// 2. 加密敏感字段（对副本操作，不污染内存中的明文）
	if len(encryptPaths) > 0 {
		data, err = encryptFieldsInYAML(data, encryptPaths)
		if err != nil {
			return fmt.Errorf("加密配置 %q 字段失败: %w", sectionName, err)
		}
	}

	// 3. 找到目标分片文件路径（找不到则用默认 ./config/fileName）
	targetFile := findSectionFile(fileName)

	// 4. 写入文件（直接写扁平字段，不包裹 sectionName）
	if err := os.MkdirAll(filepath.Dir(targetFile), 0o755); err != nil {
		return fmt.Errorf("创建配置目录 %q 失败: %w", filepath.Dir(targetFile), err)
	}
	if err := os.WriteFile(targetFile, data, 0o600); err != nil {
		return fmt.Errorf("写入配置文件 %q 失败: %w", targetFile, err)
	}

	return nil
}

// findSectionFile 按优先顺序查找现有的配置分片文件。
// 找到第一个存在的就返回；都不存在则返回默认路径 ./config/fileName。
func findSectionFile(fileName string) string {
	for _, dir := range sectionDirs {
		p := filepath.Join(dir, fileName)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	// 默认路径（文件可能尚不存在，调用方会创建）
	return filepath.Join("./config", fileName)
}

// encryptFieldsInYAML 在序列化后的 YAML 字节中加密指定路径的字段。
//
// paths 格式如 "api_key" 或 "scene_describe_ai.api_key"（点分隔的嵌套路径）。
// 已加密（ENC: 前缀）的值跳过，不重复加密。
// 加密失败的字段保留原值，不阻断流程。
func encryptFieldsInYAML(data []byte, paths []string) ([]byte, error) {
	var root interface{}
	if err := yaml.Unmarshal(data, &root); err != nil {
		return data, err
	}

	for _, p := range paths {
		parts := strings.Split(p, ".")
		encryptAtPath(root, parts)
	}

	return yaml.Marshal(root)
}

// encryptAtPath 沿 path 路径下钻到叶子节点，对字符串值做加密。
// 已加密（ENC: 前缀）的跳过；非字符串值跳过。
func encryptAtPath(root interface{}, path []string) {
	if len(path) == 0 {
		return
	}

	m, ok := root.(map[string]interface{})
	if !ok {
		return
	}

	key := path[0]

	if len(path) == 1 {
		// 叶子节点
		val, exists := m[key]
		if !exists {
			return
		}
		str, ok := val.(string)
		if !ok {
			return
		}
		// 已加密的跳过
		if strings.HasPrefix(str, "ENC:") {
			return
		}
		// 空值跳过
		if str == "" {
			return
		}
		// 加密
		if enc, err := secretcrypto.Encrypt(str); err == nil {
			m[key] = "ENC:" + enc
		}
		// 加密失败保留原值
		return
	}

	// 继续下钻
	child, exists := m[key]
	if !exists {
		return
	}
	encryptAtPath(child, path[1:])
}
