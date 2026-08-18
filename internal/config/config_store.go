package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

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
//   - sectionName:  viper 命名空间前缀（如 "ai" / "adult_scraper" / "strm"），同时用作 yaml 顶层 key
//   - fileName:     分片文件名（如 "ai.yaml"）
//   - encryptPaths: 需要加密的字段路径列表（如 ["api_key", "scene_describe_ai.api_key"]），为空则不加密
//   - snapshot:     返回当前子配置副本的闭包（调用方应在调用前确保已持有必要的锁）
//
// 写入策略：
//  1. yaml.Marshal 序列化整个子配置（结构体 → yaml bytes，1:1 映射，无需逐字段 Set）
//  2. 若指定了 encryptPaths，对序列化后的 yaml 字节中的指定字段做加密（幂等：ENC: 前缀的跳过）
//  3. 若目标文件已存在，读取已有内容做合并：保留本 section 之外的其他顶层 key（避免丢 whisper_*/ocr_* 等）
//  4. 写入文件（权限 0600）
//
// 加密规则：
//   - 使用 internal/crypto.Encrypt 加密，结果带 "ENC:" 前缀
//   - 已加密（ENC: 前缀）的值不重复加密
//   - 加密失败不阻断流程，退而存明文以保证配置不丢失
func SaveSection[T any](c *Config, sectionName, fileName string, encryptPaths []string, snapshot func() T) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	section := snapshot()

	// 1. 序列化子配置为 yaml 字节
	data, err := yaml.Marshal(section)
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

	// 4. 合并：读取已有文件内容，保留本 section 之外的其他顶层 key
	merged := mergeSectionYAML(targetFile, sectionName, data)

	// 5. 写入文件
	if err := os.MkdirAll(filepath.Dir(targetFile), 0o755); err != nil {
		return fmt.Errorf("创建配置目录 %q 失败: %w", filepath.Dir(targetFile), err)
	}
	if err := os.WriteFile(targetFile, merged, 0o600); err != nil {
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

// mergeSectionYAML 将序列化好的 section data 合并到现有 yaml 文件中。
//
// 策略：
//   - 读取现有文件内容（不存在则视为空 map）
//   - 反序列化现有内容为 map[string]interface{}
//   - 反序列化新 section data 为 map[string]interface{}
//   - 将新 section data 放入 existing[sectionName] 位置（覆盖整个 section）
//   - 重新 Marshal 为 yaml 字节返回
//
// 这样保留了同文件中其他 section 的数据（例如 ai.yaml 中可能同时有 ai.* 和其他顶层 key）。
func mergeSectionYAML(targetFile, sectionName string, sectionData []byte) []byte {
	// 读取已有文件
	existingBytes, err := os.ReadFile(targetFile)
	if err != nil {
		// 文件不存在，直接包装 section data
		existingBytes = nil
	}

	var existing map[string]interface{}
	if len(existingBytes) > 0 {
		if err := yaml.Unmarshal(existingBytes, &existing); err != nil {
			// 解析失败，用空 map 重新开始
			existing = map[string]interface{}{}
		}
	}
	if existing == nil {
		existing = map[string]interface{}{}
	}

	// 反序列化 section data
	// sectionData 是单个 section 的 yaml（如 AIConfig 的序列化结果），
	// 反序列化后是 map[string]interface{}，key 是字段名。
	var newSection map[string]interface{}
	if err := yaml.Unmarshal(sectionData, &newSection); err != nil {
		// 解析失败，直接用原始 data
		return sectionData
	}

	// 合并：用新 section 覆盖旧 section，保留其他顶层 key
	existing[sectionName] = newSection

	merged, err := yaml.Marshal(existing)
	if err != nil {
		return sectionData
	}
	return merged
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
