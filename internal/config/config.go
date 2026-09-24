package config

import (
	cryptoRand "crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	secretcrypto "github.com/nowen-video/nowen-video/internal/crypto"
	"github.com/spf13/viper"
)

// ==================== 子配置结构体 ====================

// DatabaseConfig 数据库连接参数
type DatabaseConfig struct {
	// 数据库主机地址
	Host string `mapstructure:"host"`
	// 数据库端口
	Port int `mapstructure:"port"`
	// 数据库用户名
	User string `mapstructure:"user"`
	// 数据库密码
	Password string `mapstructure:"password"`
	// 数据库名称
	DBName string `mapstructure:"dbname"`
	// SSL 模式: disable / require / verify-ca / verify-full
	SSLMode string `mapstructure:"sslmode"`
	// 时区
	TimeZone string `mapstructure:"timezone"`
	// 最大打开连接数
	MaxOpenConns int `mapstructure:"max_open_conns"`
	// 最大空闲连接数
	MaxIdleConns int `mapstructure:"max_idle_conns"`
	// 连接最大存活时间（秒）
	ConnMaxLifetime int `mapstructure:"conn_max_lifetime"`
	// 启动时连接重试次数（默认 5，重试耗尽则启动失败）
	ConnectRetries int `mapstructure:"connect_retries"`
	// 连接重试间隔（秒，默认 3）
	ConnectRetryInterval int `mapstructure:"connect_retry_interval"`
	// 启动时若库不存在则自动创建（连接用户需 CREATEDB 权限；默认 true）
	AutoCreate bool `mapstructure:"auto_create"`
}

// SecretsConfig 敏感信息/第三方服务 API 密钥
type SecretsConfig struct {
	// JWT 签名密钥（必须修改默认值）
	JWTSecret string `mapstructure:"jwt_secret"`
	// TMDb API Key，用于元数据刮削
	TMDbAPIKey string `mapstructure:"tmdb_api_key" enc:"true"`
	// TMDb API 反向代理 Base URL。程序会自动拼接 /3/...，不是 HTTP forward proxy。
	TMDbAPIProxy string `mapstructure:"tmdb_api_proxy"`
	// TMDb 图片反向代理 Base URL。程序会自动拼接 /t/p/...，不是 HTTP forward proxy。
	TMDbImageProxy string `mapstructure:"tmdb_image_proxy"`
	// TMDb 网络出口代理，支持 http/https/socks5/socks5h。
	TMDbNetworkProxy string `mapstructure:"tmdb_network_proxy"`
	// Bangumi Access Token（用于提高 API 请求速率限制，可选）
	// 获取地址: https://next.bgm.tv/demo/access-token
	// 留空也可使用（匿名请求，速率较低）
	BangumiAccessToken string `mapstructure:"bangumi_access_token" enc:"true"`
	// TheTVDB API Key（用于获取电视剧集的详细元数据）
	// 申请地址: https://thetvdb.com/api-information
	// 留空则跳过 TheTVDB 数据源
	TheTVDBAPIKey string `mapstructure:"thetvdb_api_key" enc:"true"`
	// Fanart.tv API Key（用于获取高质量图片资源：ClearLogo、背景图、光碟封面等）
	// 申请地址: https://fanart.tv/get-an-api-key/
	// 留空则跳过 Fanart.tv 图片增强
	FanartTVAPIKey string `mapstructure:"fanart_tv_api_key" enc:"true"`
	// 豆瓣登录 Cookie（可选，用于提升豆瓣刮削成功率和降低风控概率）
	// 从浏览器登录豆瓣后 F12 -> Network -> Request Headers 中复制完整 Cookie 字符串
	// 关键字段：bid / dbcl2 / ck。留空则以匿名方式访问豆瓣，仍可工作但成功率较低。
	// 注意：Cookie 有效期约 1 个月，失效时需重新获取。仅供个人使用，请勿分享。
	DoubanCookie string `mapstructure:"douban_cookie" enc:"true"`
	// 预留：其他第三方服务密钥可在此扩展
}

// AppConfig 应用运行环境配置
type AppConfig struct {
	// 服务器监听端口，默认 8080
	Port int `mapstructure:"port"`
	// 调试模式，默认 false
	Debug bool `mapstructure:"debug"`
	// 运行环境标识：development / production / testing
	Env string `mapstructure:"env"`
	// 数据目录，默认 ./data
	DataDir string `mapstructure:"data_dir"`
	// 前端静态文件目录，默认 ./web/dist
	WebDir string `mapstructure:"web_dir"`
	// 前端子路径前缀（VOS 等 iframe 挂载场景）。非空时后端在 http.Server 层
	// 剥离该前缀后再交给 gin，使 /app/<app-id>/api、/app/<app-id>/assets 等
	// 能命中真实路由；前端前缀由 VITE_BASE 在构建期写入。独立部署留空即根路径。
	WebBasePath string `mapstructure:"web_base_path"`
	// FFmpeg 可执行文件路径
	FFmpegPath string `mapstructure:"ffmpeg_path"`
	// FFprobe 可执行文件路径
	FFprobePath string `mapstructure:"ffprobe_path"`
	// VAAPI 设备路径，如 /dev/dri/renderD128
	// 保留该字段作为 Linux Intel 核显的逃生门，不在 UI 暴露。
	VAAPIDevice string `mapstructure:"vaapi_device"`
	// 允许的跨域来源列表
	CORSOrigins []string `mapstructure:"cors_origins"`
}

// LoggingConfig 日志记录设置
type LoggingConfig struct {
	// 日志级别: debug / info / warn / error
	Level string `mapstructure:"level"`
	// 日志输出格式: json / console
	Format string `mapstructure:"format"`
	// 日志输出文件路径，留空则输出到 stderr
	OutputPath string `mapstructure:"output_path"`
	// 错误日志独立文件路径，留空则跟随主输出
	ErrorOutputPath string `mapstructure:"error_output_path"`
	// 是否启用日志文件轮转
	EnableRotation bool `mapstructure:"enable_rotation"`
	// 单个日志文件最大大小（MB），默认 100
	MaxSizeMB int `mapstructure:"max_size_mb"`
	// 日志文件最大保留天数，默认 30
	MaxAgeDays int `mapstructure:"max_age_days"`
	// 日志文件最大保留个数，默认 10
	MaxBackups int `mapstructure:"max_backups"`
}

// CacheConfig 缓存配置参数
type CacheConfig struct {
	// 转码缓存目录，默认 ./cache
	CacheDir string `mapstructure:"cache_dir"`
	// 缓存最大占用磁盘空间（MB），0 为不限制
	MaxDiskUsageMB int `mapstructure:"max_disk_usage_mb"`
	// 缓存文件过期时间（小时），0 为不过期
	TTLHours int `mapstructure:"ttl_hours"`
	// 是否启用自动清理过期缓存
	AutoCleanup bool `mapstructure:"auto_cleanup"`
	// 自动清理间隔（分钟），默认 60
	CleanupIntervalMin int `mapstructure:"cleanup_interval_min"`
}

// VideoAnalysisConfig 场景检测和视频结构化服务配置。
type VideoAnalysisConfig struct {
	Enabled             bool   `mapstructure:"enabled" yaml:"enabled" json:"enabled"`
	SceneBaseURL        string `mapstructure:"scene_base_url" yaml:"scene_base_url" json:"scene_base_url"`
	StructureBaseURL    string `mapstructure:"structure_base_url" yaml:"structure_base_url" json:"structure_base_url"`
	MediaBaseURL        string `mapstructure:"media_base_url" yaml:"media_base_url" json:"media_base_url"`
	SourceToken         string `mapstructure:"source_token" yaml:"source_token" json:"source_token" enc:"true"`
	RemoteVideoEnabled  bool   `mapstructure:"remote_video_enabled" yaml:"remote_video_enabled" json:"remote_video_enabled"`
	AssetDir            string `mapstructure:"asset_dir" yaml:"asset_dir" json:"asset_dir"`
	MaxConcurrent       int    `mapstructure:"max_concurrent" yaml:"max_concurrent" json:"max_concurrent"`
	PollIntervalSeconds int    `mapstructure:"poll_interval_seconds" yaml:"poll_interval_seconds" json:"poll_interval_seconds"`
	JobTimeoutMinutes   int    `mapstructure:"job_timeout_minutes" yaml:"job_timeout_minutes" json:"job_timeout_minutes"`
	DescribeEnabled     bool   `mapstructure:"describe_enabled" yaml:"describe_enabled" json:"describe_enabled"`
}

// ==================== 主配置结构体 ====================

// AIModelEntry 供应商下的模型条目
type AIModelEntry struct {
	Name      string `json:"name" mapstructure:"name" yaml:"name"`
	IsVision  bool   `json:"is_vision" mapstructure:"is_vision" yaml:"is_vision"`
	IsDefault bool   `json:"is_default" mapstructure:"is_default" yaml:"is_default"`
}

// AIProviderEntry 供应商配置条目（用于多供应商管理）
//
// 设计说明：
//   - 列表（非 map），避免旧 Profiles map 的"重启后自动补全残留"问题
//   - 每个 provider 的 api_key 在持久化时加密（ENC: 前缀）
//   - Models 为该供应商下的模型列表，每个模型可标记是否支持视觉
type AIProviderEntry struct {
	ID      string         `json:"id" mapstructure:"id" yaml:"id"`
	Name    string         `json:"name" mapstructure:"name" yaml:"name"`
	APIBase string         `json:"api_base" mapstructure:"api_base" yaml:"api_base"`
	APIKey  string         `json:"api_key,omitempty" mapstructure:"api_key" yaml:"api_key,omitempty" enc:"true"`
	Models  []AIModelEntry `json:"models" mapstructure:"models" yaml:"models"`
	Enabled bool           `json:"enabled" mapstructure:"enabled" yaml:"enabled"`
}

// DefaultModel 返回默认模型名：优先 is_default 标记，其次第一个，无模型返回空。
func (p *AIProviderEntry) DefaultModel() string {
	for _, m := range p.Models {
		if m.IsDefault {
			return m.Name
		}
	}
	if len(p.Models) > 0 {
		return p.Models[0].Name
	}
	return ""
}

// ViewMap 返回脱敏的 provider 视图（api_key 不暴露，仅标记是否已配置）。
// activeID 用于标记哪个 provider 处于激活状态。
func (p *AIProviderEntry) ViewMap(activeID string) map[string]interface{} {
	models := make([]map[string]interface{}, len(p.Models))
	for i, m := range p.Models {
		models[i] = map[string]interface{}{
			"name":       m.Name,
			"is_vision":  m.IsVision,
			"is_default": m.IsDefault,
		}
	}
	return map[string]interface{}{
		"id":                 p.ID,
		"name":               p.Name,
		"api_base":           p.APIBase,
		"models":             models,
		"enabled":            p.Enabled,
		"api_key_configured": p.APIKey != "",
		"is_gateway":         IsVRouterGateway(p.ID, p.APIBase),
		"active":             p.ID == activeID,
	}
}

// AIConfig AI 功能配置
// EmbeddingAIConfig 图片/文本 embedding 服务配置，计算 CLIP 图片/文本向量用于向量检索。
// 后端为 V-Router 网关：图片走 POST /v1/ml/predictions，文本走标准 POST /v1/embeddings。
// 启用语义：APIBase 非空即启用（地址即开关），不再有独立 enabled 开关。
type EmbeddingAIConfig struct {
	APIBase string `mapstructure:"api_base" yaml:"api_base"`
	Model   string `mapstructure:"model" yaml:"model"`
	// APIKey 仅 V-Router 模式使用（可选）：V-Router 开启 REQUIRE_KEY 且无 VOS 登录态时兜底；
	// 留空则走匿名内网调用或自动转发当前 VOS accessToken。
	APIKey string `mapstructure:"api_key" yaml:"api_key" enc:"true"`
}

// SceneDescribeAIConfig 场景描述视觉模型配置
// 从指定供应商的模型列表中选择视觉模型（is_vision=true 的模型），
// api_base/api_key 复用该供应商的连接信息。
type SceneDescribeAIConfig struct {
	ProviderID string `mapstructure:"provider_id" yaml:"provider_id"`
	Model      string `mapstructure:"model" yaml:"model"`
}

// DesensitizeConfig 数据脱敏服务配置
// 在 ChatCompletion 中对发给 LLM 的文本做敏感信息脱敏。
// 脱敏服务不可用时降级放行，不阻断业务。
const (
	DesensitizeImageScopeEmbedding   = "embedding"
	DesensitizeImageScopeAIAssistant = "ai_assistant"
)

type DesensitizeConfig struct {
	Enabled      bool     `mapstructure:"enabled" yaml:"enabled"`
	BaseURL      string   `mapstructure:"base_url" yaml:"base_url"` // http://desensitize-backend:5000
	Timeout      int      `mapstructure:"timeout" yaml:"timeout"`   // 秒，默认 3
	NER          bool     `mapstructure:"ner" yaml:"ner"`           // NER 语义识别（有并发限制）
	ImageEnabled bool     `mapstructure:"image_enabled" yaml:"image_enabled"`
	ImageTimeout int      `mapstructure:"image_timeout" yaml:"image_timeout"` // 秒，默认 30
	ImageScopes  []string `mapstructure:"image_scopes" yaml:"image_scopes"`   // 生效范围：embedding / ai_assistant
}

type AIConfig struct {
	// 是否启用 AI 功能（总开关）
	Enabled bool `mapstructure:"enabled"`
	// 🚀 全自动托管模式（AutoPilot）：开启后由系统自动串联
	// 「扫描入库 → AI 识别 → 归类 → 命名 → 元数据刮削 → AI 兜底」全流程，
	// 无需用户干预；同时强制启用所有 AI 子功能并提升识别阈值（强制每条都过 AI）。
	// 仅写入数据库，不动磁盘任何原始文件。
	AutoPilot bool `mapstructure:"auto_pilot"`
	// 是否禁止使用本地 AI（如 ollama），强制走云端 LLM 服务商
	// 默认 true：满足「禁用本地 AI 处理，全部调用服务商提供的 AI API」的产品要求
	BlockLocalAI bool `mapstructure:"block_local_ai"`
	// 当前激活的 provider ID（如 deepseek / openai / custom_vllm）
	// 运行时通过 ActiveProfile() 从 Providers 列表中查找 api_base / api_key / model
	ActiveProvider string `mapstructure:"active_provider"`
	// 当前激活的模型名称（覆盖 Providers 中的默认 model）
	ActiveModel string `mapstructure:"active_model"`
	// Providers 供应商列表（唯一数据源）
	// 运行时通过 ActiveProfile() / FindProvider() 从列表中查找 api_base / api_key / model。
	// ActiveProvider 仅记录激活了哪个 ID，实际连接配置全在 Providers 中。
	Providers []AIProviderEntry `mapstructure:"providers" yaml:"providers,omitempty"`
	// 请求超时（秒）
	Timeout int `mapstructure:"timeout"`
	// 功能开关
	EnableSmartSearch     bool `mapstructure:"enable_smart_search"`
	EnableRecommendReason bool `mapstructure:"enable_recommend_reason"`
	EnableMetadataEnhance bool `mapstructure:"enable_metadata_enhance"`
	// 高级设置
	MonthlyBudget     int `mapstructure:"monthly_budget"`
	CacheTTLHours     int `mapstructure:"cache_ttl_hours"`
	MaxConcurrent     int `mapstructure:"max_concurrent"`
	RequestIntervalMs int `mapstructure:"request_interval_ms"`

	// ==================== Token 用量预算（智能切换机制） ====================
	// MonthlyTokenBudget 月度 token 预算（prompt + completion 之和）。
	//   0 表示不限制；> 0 时，AIRouter 会在用量达到 WarningThresholdPct 时发出预警，
	//   达到 100% 时拒绝请求或触发故障转移到链路上的下一个 provider。
	MonthlyTokenBudget int64 `mapstructure:"monthly_token_budget" yaml:"monthly_token_budget,omitempty"`
	// WarningThresholdPct 用量预警阈值（百分比，0~100）。默认 80。
	WarningThresholdPct int `mapstructure:"warning_threshold_pct" yaml:"warning_threshold_pct,omitempty"`

	// ==================== Embedding 服务配置（V-Router → ML Server） ====================
	EmbeddingAI EmbeddingAIConfig `mapstructure:"embedding_ai" yaml:"embedding_ai"`

	// ==================== 场景描述视觉模型配置 ====================
	SceneDescribeAI SceneDescribeAIConfig `mapstructure:"scene_describe_ai" yaml:"scene_describe_ai"`

	// ==================== 数据脱敏配置 ====================
	// ChatCompletion 中对发给 LLM 的文本做敏感信息脱敏
	Desensitize DesensitizeConfig `mapstructure:"desensitize" yaml:"desensitize"`

	// ==================== ASR / Whisper 云端 API 独立配置 ====================
	// Whisper API 独立地址（留空则复用 APIBase）
	WhisperAPIBase string `mapstructure:"whisper_api_base"`
	// Whisper API 独立密钥（留空则复用 APIKey）
	WhisperAPIKey string `mapstructure:"whisper_api_key" enc:"true"`
	// Whisper 模型名称（留空则使用默认 whisper-1）
	WhisperModel string `mapstructure:"whisper_model"`
	// Whisper API 请求超时（秒，0 则使用默认 300）
	WhisperTimeout int `mapstructure:"whisper_timeout"`

	// ==================== ASR / 本地 whisper.cpp 配置 ====================
	// 本地 whisper.cpp 可执行文件路径（留空则仅使用云端 API）
	WhisperCppPath string `mapstructure:"whisper_cpp_path"`
	// 本地 Whisper 模型文件路径（如 ggml-large-v3.bin）
	WhisperModelPath string `mapstructure:"whisper_model_path"`
	// 本地 Whisper 线程数（默认 4）
	WhisperThreads int `mapstructure:"whisper_threads"`
	// 是否优先使用本地引擎（默认 false，优先云端）
	PreferLocalWhisper bool `mapstructure:"prefer_local_whisper"`

	// ==================== 字幕预处理配置 ====================
	// 是否在媒体库扫描后自动触发字幕预处理
	AutoSubtitlePreprocess bool `mapstructure:"auto_subtitle_preprocess"`
	// 自动预处理的目标翻译语言列表（逗号分隔，如 "zh,en"，留空则不翻译）
	SubtitleTargetLangs string `mapstructure:"subtitle_target_langs"`
	// 字幕预处理最大并发数（默认 1）
	SubtitlePreprocessWorkers int `mapstructure:"subtitle_preprocess_workers"`
	// 是否优先使用已有字幕（内嵌/外挂），而非重新 AI 生成（默认 true）
	PreferExistingSubtitle bool `mapstructure:"prefer_existing_subtitle"`

	// ==================== 图形字幕 OCR 配置 ====================
	// 是否启用图形字幕 OCR 识别（PGS/VobSub 等）
	OCREnabled bool `mapstructure:"ocr_enabled"`
	// Tesseract 可执行文件路径（留空则使用系统 PATH 中的 tesseract）
	TesseractPath string `mapstructure:"tesseract_path"`
	// Tesseract OCR 语言包（如 "chi_sim+eng"，默认 "eng"）
	TesseractLang string `mapstructure:"tesseract_lang"`
	// 图形字幕导出图片 DPI（默认 150）
	OCRDPI int `mapstructure:"ocr_dpi"`

	// ==================== 字幕清洗配置 ====================
	// 是否启用字幕内容清洗（在字幕提取/转换后、翻译前执行）
	SubCleanEnabled bool `mapstructure:"sub_clean_enabled"`
	// 去除 HTML 标签（<i>, <b>, <font> 等）
	SubCleanRemoveHTML bool `mapstructure:"sub_clean_remove_html"`
	// 去除 ASS 样式标签（{\an8}, {\pos()} 等）
	SubCleanRemoveASSStyle bool `mapstructure:"sub_clean_remove_ass_style"`
	// 统一标点符号（全角→半角，仅对非 CJK 文本生效）
	SubCleanNormalizePunct bool `mapstructure:"sub_clean_normalize_punct"`
	// 去除 SDH 标注（[音乐], (笑声), [门铃响] 等听障辅助描述）
	SubCleanRemoveSDH bool `mapstructure:"sub_clean_remove_sdh"`
	// 去除广告水印字幕（字幕组署名、网站地址等）
	SubCleanRemoveAds bool `mapstructure:"sub_clean_remove_ads"`
	// 合并过短的字幕条目（显示时长低于阈值时与相邻条目合并）
	SubCleanMergeShort bool `mapstructure:"sub_clean_merge_short"`
	// 拆分过长的字幕条目（超过最大字符数时按时间均分拆分）
	SubCleanSplitLong bool `mapstructure:"sub_clean_split_long"`
	// 处理前备份原始字幕文件（生成 .bak 文件）
	SubCleanBackup bool `mapstructure:"sub_clean_backup"`
	// 编码检测失败时的回退编码（如 "gbk"、"big5"、"shift_jis"）
	SubCleanFallbackEnc string `mapstructure:"sub_clean_fallback_enc"`
	// 全局时间轴偏移（毫秒，正数延后、负数提前）
	SubCleanTimeOffsetMs int64 `mapstructure:"sub_clean_time_offset_ms"`
	// 最小字幕显示时长（毫秒，低于此值的条目将被合并，默认 500）
	SubCleanMinDurationMs int64 `mapstructure:"sub_clean_min_duration_ms"`
	// 最大字幕显示时长（毫秒，超过此值的条目将被截断，默认 10000）
	SubCleanMaxDurationMs int64 `mapstructure:"sub_clean_max_duration_ms"`
	// 合并间隔阈值（毫秒，两条字幕间隔小于此值时可合并，默认 200）
	SubCleanMinGapMs int64 `mapstructure:"sub_clean_min_gap_ms"`
	// 每行最大字符数（用于拆分过长字幕，默认 42）
	SubCleanMaxCharsPerLine int `mapstructure:"sub_clean_max_chars_per_line"`
	// 每条字幕最大行数（默认 2）
	SubCleanMaxLinesPerCue int `mapstructure:"sub_clean_max_lines_per_cue"`
}

// RegistrationConfig 注册控制配置
type RegistrationConfig struct {
	// 是否允许公开注册，默认 false（仅管理员可创建用户）
	Enabled bool `mapstructure:"enabled"`
	// 邀请码（设置后注册时需提供正确的邀请码）
	InviteCode string `mapstructure:"invite_code"`
}

// VOSOIDCConfig configures VOS OIDC Fastpath authentication for the embedded app.
type VOSOIDCConfig struct {
	Enabled  bool   `mapstructure:"enabled"`
	JWKSURL  string `mapstructure:"jwks_url"`
	Issuer   string `mapstructure:"issuer"`
	ClientID string `mapstructure:"client_id"`
}

// EmbyConfig Emby/Jellyfin 兼容层配置（供移动端/桌面 Emby/Infuse/Jellyfin 客户端登录与播放）
type EmbyConfig struct {
	// 服务器对外显示名称（留空则使用主机名或 "V-Cine"）
	ServerName string `mapstructure:"server_name"`
	// 是否启用 UDP 7359 局域网服务器自动发现（Emby / Jellyfin 标准协议）
	// 开启后同网段的客户端会在"添加服务器"时自动发现本机
	EnableAutoDiscovery bool `mapstructure:"enable_auto_discovery"`
	// UDP 自动发现监听端口，默认 7359（Emby/Jellyfin 标准）
	AutoDiscoveryPort int `mapstructure:"auto_discovery_port"`
	// 是否在 /Users/Public 暴露用户列表（登录页展示用户头像点击登录）
	// 默认 false 以保护用户名隐私；开启更适合家庭共享场景
	PublicUserListEnabled bool `mapstructure:"public_user_list_enabled"`
	// 是否启用 WebSocket（/embywebsocket），消除客户端连接失败告警
	EnableWebSocket bool `mapstructure:"enable_websocket"`
	// 登录品牌自定义文案（Jellyfin 客户端 /Branding/Configuration 使用）
	// 登录页顶部欢迎语
	LoginDisclaimer string `mapstructure:"login_disclaimer"`
	// 自定义 CSS（Jellyfin Web 客户端 /Branding/Css）
	CustomCss string `mapstructure:"custom_css"`
	// 是否允许 query 参数登录（默认关闭，更安全）
	// 某些旧版客户端（如 EmbyCon）可能需要 query 登录
	AllowQueryLogin bool `mapstructure:"allow_query_login"`
}

// AdultScraperConfig 番号刮削配置（混合架构：Go 原生爬虫 + Python 微服务）
type AdultScraperConfig struct {
	// 是否启用番号刮削功能（总开关）
	Enabled bool `mapstructure:"enabled"`
	// 是否启用 JavBus 数据源（Go 原生爬虫）
	EnableJavBus bool `mapstructure:"enable_javbus"`
	// JavBus 镜像地址（留空使用默认 https://www.javbus.com）
	JavBusURL string `mapstructure:"javbus_url"`
	// 是否启用 JavDB 数据源（Go 原生爬虫）
	EnableJavDB bool `mapstructure:"enable_javdb"`
	// JavDB 镜像地址（留空使用默认 https://javdb.com）
	JavDBURL string `mapstructure:"javdb_url"`

	// ==================== P1 扩展：更多数据源 ====================
	// 是否启用 Freejavbt 数据源（Go 原生爬虫，中文元数据优秀）
	EnableFreejavbt bool `mapstructure:"enable_freejavbt"`
	// Freejavbt 镜像地址（留空使用默认 https://freejavbt.com）
	FreejavbtURL string `mapstructure:"freejavbt_url"`
	// 是否启用 JAV321 数据源（Go 原生爬虫，中文简介丰富）
	EnableJav321 bool `mapstructure:"enable_jav321"`
	// JAV321 镜像地址（留空使用默认 https://www.jav321.com）
	Jav321URL string `mapstructure:"jav321_url"`

	// ==================== P2 扩展：更多数据源 ====================
	// 是否启用 Fanza (DMM) 官方数据源（数据最权威，封面最清晰）
	EnableFanza bool `mapstructure:"enable_fanza"`
	// Fanza 站点地址（留空使用默认 https://www.dmm.co.jp）
	FanzaURL string `mapstructure:"fanza_url"`
	// 是否启用 MGStage 数据源（MGS 系列和 200GANA 等素人番号专用）
	EnableMGStage bool `mapstructure:"enable_mgstage"`
	// MGStage 站点地址（留空使用默认 https://www.mgstage.com）
	MGStageURL string `mapstructure:"mgstage_url"`
	// 是否启用 FC2Hub 数据源（FC2-PPV 无码作品专用）
	EnableFC2Hub bool `mapstructure:"enable_fc2hub"`
	// FC2Hub 站点地址（留空使用默认 https://fc2hub.com）
	FC2HubURL string `mapstructure:"fc2hub_url"`

	// ==================== P2 扩展：聚合模式 + 封面处理 ====================
	// 聚合刮削模式：并发调用所有启用的数据源，按字段优先级合并最完整结果
	// 开启后耗时变长但数据最完整，适合精刮场景
	EnableAggregatedMode bool `mapstructure:"enable_aggregated_mode"`
	// 封面裁剪：把横版大图裁剪成 2:3 竖版 poster（Emby 媒体墙更美观）
	EnablePosterCrop bool `mapstructure:"enable_poster_crop"`
	// 聚合刮削字段优先级（key=字段名, value=数据源顺序）。为空时使用内置默认值。
	FieldPriority map[string][]string `mapstructure:"field_priority"`

	// ==================== P1 扩展：多媒体资源下载 ====================
	// 是否下载剧照（ExtraFanart，供 Emby/Jellyfin 显示多张剧照）
	DownloadExtraFanart bool `mapstructure:"download_extra_fanart"`
	// 最多下载多少张剧照（0 = 全部，默认 10）
	MaxExtraFanart int `mapstructure:"max_extra_fanart"`
	// 是否下载演员头像（写入 .actors/ 目录供 Emby 使用）
	DownloadActorPhoto bool `mapstructure:"download_actor_photo"`
	// 是否抓取 Trailer 预告片 URL（写入 NFO）
	FetchTrailer bool `mapstructure:"fetch_trailer"`

	// ==================== P1 扩展：翻译配置 ====================
	// 是否启用标题/简介翻译（日文 -> 中文）
	EnableTranslate bool `mapstructure:"enable_translate"`
	// 翻译服务提供商：google / baidu / youdao / deeplx / disabled
	TranslateProvider string `mapstructure:"translate_provider"`
	// 翻译服务接口地址（自建 deeplx 时必填，格式 http://host:port/translate）
	TranslateEndpoint string `mapstructure:"translate_endpoint"`
	// 翻译服务 API Key（百度/有道等商业服务需要）
	TranslateAPIKey string `mapstructure:"translate_api_key" enc:"true"`
	// 翻译服务 API Secret（百度/有道需要）
	TranslateAPISecret string `mapstructure:"translate_api_secret" enc:"true"`
	// 翻译目标语言（默认 zh-CN）
	TranslateTargetLang string `mapstructure:"translate_target_lang"`

	// Python 刮削微服务地址（用于 Cloudflare 等强反爬场景的 fallback）
	// 留空则不使用 Python 微服务
	// 示例: http://localhost:5000
	PythonServiceURL string `mapstructure:"python_service_url"`
	// Python 微服务 API Key（可选，用于认证）
	PythonServiceAPIKey string `mapstructure:"python_service_api_key" enc:"true"`
	// 是否在 Go 后端启动时自动拉起 Python 微服务子进程
	// 为 true 时，Go 进程会 fork 出一个 python app.py 子进程，并在主服务关闭时一并回收
	AutoStartPython bool `mapstructure:"auto_start_python"`
	// Python 可执行文件路径（留空自动探测 python3/python/py）
	PythonExecutable string `mapstructure:"python_executable"`
	// Python 微服务脚本目录（留空使用默认 scripts/adult-scraper）
	PythonServiceDir string `mapstructure:"python_service_dir"`
	// 请求间隔最小值（毫秒，默认 1500，防止被封 IP）
	MinRequestInterval int `mapstructure:"min_request_interval"`
	// 请求间隔最大值（毫秒，默认 3000）
	MaxRequestInterval int `mapstructure:"max_request_interval"`

	// ==================== Cookie 登录配置（参考 mdcx）====================
	// 某些站点（尤其 JavDB）非登录态内容受限，通过设置登录后的 Cookie 头
	// 可解锁：高清封面、完整演员信息、评分、预告片等
	// 格式：浏览器复制的完整 Cookie 字符串，如 "locale=zh; _jdb_session=abc..."
	//
	// 获取方法：登录网站 → F12 → Network → 任一请求 → 复制 Cookie 头
	CookieJavBus    string `mapstructure:"cookie_javbus" enc:"true"`
	CookieJavDB     string `mapstructure:"cookie_javdb" enc:"true"`
	CookieFreejavbt string `mapstructure:"cookie_freejavbt" enc:"true"`
	CookieJav321    string `mapstructure:"cookie_jav321" enc:"true"`
	CookieFanza     string `mapstructure:"cookie_fanza" enc:"true"`
	CookieMGStage   string `mapstructure:"cookie_mgstage" enc:"true"`
	CookieFC2Hub    string `mapstructure:"cookie_fc2hub" enc:"true"`
}

// StorageConfig 存储配置（支持本地、WebDAV、网盘等多种存储后端）
type StorageConfig struct {
	// ==================== WebDAV 存储配置 ====================
	WebDAV WebDAVConfig `mapstructure:"webdav"`

	// ==================== V2.3: Alist 聚合网盘配置 ====================
	// 通过 Alist HTTP API 对接阿里云盘 / 115 / 夸克 / 百度网盘 / OneDrive 等 20+ 网盘
	Alist AlistConfig `mapstructure:"alist"`

	// ==================== V2.3: S3 兼容对象存储配置 ====================
	// 对接 AWS S3 / MinIO / Cloudflare R2 / 阿里云 OSS / 腾讯云 COS 等
	S3 S3Config `mapstructure:"s3"`

	// ==================== 预留：未来扩展 ====================
	// OneDrive    OneDriveConfig    `mapstructure:"onedrive"`
}

// AlistConfig Alist 聚合网盘配置（V2.3）
//
// Alist 官网: https://alist.nn.ci/
// 认证模式：
//  1. Token 模式（推荐）：预先获取长期 Token，直接填入 Token 字段
//  2. 用户名密码模式：首次请求时调用 /api/auth/login 换取 Token
type AlistConfig struct {
	// 是否启用 Alist 存储
	Enabled bool `mapstructure:"enabled"`
	// Alist 服务器地址（如 https://alist.example.com）
	ServerURL string `mapstructure:"server_url"`
	// 用户名（Token 模式可不填）
	Username string `mapstructure:"username"`
	// 密码（Token 模式可不填）
	Password string `mapstructure:"password" enc:"true"`
	// 长期 Token（优先于用户名密码）
	Token string `mapstructure:"token" enc:"true"`
	// 基础路径（Alist 内的根目录，如 /aliyun/movies）
	BasePath string `mapstructure:"base_path"`
	// 连接超时（秒，默认 30）
	Timeout int `mapstructure:"timeout"`
	// 是否启用元数据缓存
	EnableCache bool `mapstructure:"enable_cache"`
	// 元数据缓存 TTL（小时，默认 12）
	CacheTTLHours int `mapstructure:"cache_ttl_hours"`
	// ReadAt 块缓存大小（MiB，默认 8，<=0 禁用）
	ReadBlockSizeMB int `mapstructure:"read_block_size_mb"`
	// ReadAt 块缓存最大块数（每文件，默认 4，<=0 禁用）
	ReadBlockCount int `mapstructure:"read_block_count"`
}

// S3Config S3 兼容对象存储配置（V2.3）
type S3Config struct {
	// 是否启用 S3 存储
	Enabled bool `mapstructure:"enabled"`
	// S3 Endpoint（如 https://s3.amazonaws.com、https://minio.example.com:9000）
	Endpoint string `mapstructure:"endpoint"`
	// 区域（AWS 必填，MinIO 可留空或 us-east-1）
	Region string `mapstructure:"region"`
	// Access Key
	AccessKey string `mapstructure:"access_key"`
	// Secret Key
	SecretKey string `mapstructure:"secret_key" enc:"true"`
	// Bucket 名称
	Bucket string `mapstructure:"bucket"`
	// 基础路径前缀（Object Key 前缀，如 media/）
	BasePath string `mapstructure:"base_path"`
	// 是否使用 Path-Style 寻址（MinIO 必开，AWS 默认 Virtual-Host-Style）
	PathStyle bool `mapstructure:"path_style"`
	// 连接超时（秒，默认 30）
	Timeout int `mapstructure:"timeout"`
	// 是否启用元数据缓存
	EnableCache bool `mapstructure:"enable_cache"`
	// 元数据缓存 TTL（小时，默认 24）
	CacheTTLHours int `mapstructure:"cache_ttl_hours"`
	// ReadAt 块缓存大小（MiB，默认 8，<=0 禁用）
	ReadBlockSizeMB int `mapstructure:"read_block_size_mb"`
	// ReadAt 块缓存最大块数（每文件，默认 4，<=0 禁用）
	ReadBlockCount int `mapstructure:"read_block_count"`
}

// WebDAVConfig WebDAV 远程存储配置
type WebDAVConfig struct {
	// 是否启用 WebDAV 存储
	Enabled bool `mapstructure:"enabled"`
	// WebDAV 服务器地址（如 https://dav.example.com）
	ServerURL string `mapstructure:"server_url"`
	// 用户名
	Username string `mapstructure:"username"`
	// 密码
	Password string `mapstructure:"password" enc:"true"`
	// 基础路径（服务器上的根目录，如 /media）
	BasePath string `mapstructure:"base_path"`
	// 连接超时（秒，默认 30）
	Timeout int `mapstructure:"timeout"`
	// 是否启用连接池
	EnablePool bool `mapstructure:"enable_pool"`
	// 连接池大小（默认 5）
	PoolSize int `mapstructure:"pool_size"`
	// 是否启用缓存（本地缓存远程文件元数据）
	EnableCache bool `mapstructure:"enable_cache"`
	// 缓存过期时间（小时，默认 24）
	CacheTTLHours int `mapstructure:"cache_ttl_hours"`
	// 最大重试次数（默认 3）
	MaxRetries int `mapstructure:"max_retries"`
	// 重试间隔（秒，默认 2）
	RetryInterval int `mapstructure:"retry_interval"`
	// V2.1: ReadAt 块缓存大小（MiB，默认 8，<=0 禁用）
	ReadBlockSizeMB int `mapstructure:"read_block_size_mb"`
	// V2.1: ReadAt 块缓存最大块数（每文件，默认 4，<=0 禁用）
	ReadBlockCount int `mapstructure:"read_block_count"`
}

// STRMConfig .strm 远程流全局配置
type STRMConfig struct {
	// 默认 User-Agent（Media 自身无 UA 时使用），留空则使用内置值
	DefaultUserAgent string `mapstructure:"default_user_agent"`
	// 默认 Referer（留空=不发送）
	DefaultReferer string `mapstructure:"default_referer"`
	// 代理远程流时的连接超时（秒，默认 30，仅影响首包握手；读取阶段不超时）
	ConnectTimeout int `mapstructure:"connect_timeout"`
	// 对 HLS (.m3u8) 子清单做 URL 重写，让分片继续走后端代理（解决跨域/鉴权透传）
	RewriteHLS bool `mapstructure:"rewrite_hls"`
	// 扫描时是否对直链 mp4/mkv 启动远程 FFprobe 拉元数据（慢但能得到真实时长/分辨率）
	RemoteProbe bool `mapstructure:"remote_probe"`
	// 远程 FFprobe 超时秒数（默认 8）
	RemoteProbeTimeout int `mapstructure:"remote_probe_timeout"`
	// 按域名白名单追加 UA，例如：{"115.com":"Mozilla/5.0 ..."}
	DomainUserAgents map[string]string `mapstructure:"domain_user_agents"`
	// 按域名白名单追加 Referer，例如：{"115.com":"https://115.com/"}
	DomainReferers map[string]string `mapstructure:"domain_referers"`
}

// NSFWConfig 全局 NSFW/成人内容开关（默认关闭，只能通过配置文件开启）
type NSFWConfig struct {
	// 是否启用 NSFW/成人内容相关能力
	Enabled bool `mapstructure:"enabled"`
}

// ObservabilityConfig 内部可观测性配置（/metrics + /debug/pprof 独立端口）
type ObservabilityConfig struct {
	// 内部可观测性服务器监听地址（默认仅绑定 localhost；容器内抓取需覆盖为 0.0.0.0:9090 并加端口映射）
	MetricsAddr string `mapstructure:"metrics_addr"`
	// pprof 启动默认值（默认 true）；运行期可用 admin 端点不重启切换
	PprofEnabled bool `mapstructure:"pprof_enabled"`
}

// Config 应用主配置（聚合所有子模块）
type Config struct {
	mu sync.RWMutex `mapstructure:"-"`

	// 子模块配置
	Database      DatabaseConfig      `mapstructure:"database"`
	Secrets       SecretsConfig       `mapstructure:"secrets"`
	App           AppConfig           `mapstructure:"app"`
	Logging       LoggingConfig       `mapstructure:"logging"`
	Cache         CacheConfig         `mapstructure:"cache"`
	VideoAnalysis VideoAnalysisConfig `mapstructure:"video_analysis"`
	AI            AIConfig            `mapstructure:"ai"`
	Registration  RegistrationConfig  `mapstructure:"registration"`
	VOSOIDC       VOSOIDCConfig       `mapstructure:"vos_oidc"`
	Storage       StorageConfig       `mapstructure:"storage"`
	Emby          EmbyConfig          `mapstructure:"emby"`
	AdultScraper  AdultScraperConfig  `mapstructure:"adult_scraper"`
	NSFW          NSFWConfig          `mapstructure:"nsfw"`
	STRM          STRMConfig          `mapstructure:"strm"`
	Observability ObservabilityConfig `mapstructure:"observability"`

	// ==================== 兼容性字段（向后兼容旧的扁平配置） ====================
	// 以下字段用于兼容旧版 config.yaml 中的扁平 key，
	// 加载后会自动合并到对应的子模块中。

	// 旧版兼容 - 密钥
	JWTSecret  string `mapstructure:"jwt_secret"`
	TMDbAPIKey string `mapstructure:"tmdb_api_key"`
	// 旧版兼容 - 应用
	Port        int      `mapstructure:"port"`
	Debug       bool     `mapstructure:"debug"`
	DataDir     string   `mapstructure:"data_dir"`
	WebDir      string   `mapstructure:"web_dir"`
	CacheDir    string   `mapstructure:"cache_dir"`
	FFmpegPath  string   `mapstructure:"ffmpeg_path"`
	FFprobePath string   `mapstructure:"ffprobe_path"`
	VAAPIDevice string   `mapstructure:"vaapi_device"`
	CORSOrigins []string `mapstructure:"cors_origins"`
}

// ==================== 加载逻辑 ====================

// decryptSecretValue 解密带 ENC: 前缀的敏感字段，兼容老明文和双重加密残留。
func decryptSecretValue(s string) string {
	if dec, err := secretcrypto.Decrypt(s); err == nil {
		return dec
	}
	return s
}

// Load 加载配置，支持以下方式（优先级从低到高）：
//  1. 内置默认值
//  2. 主配置文件 config.yaml（兼容旧版扁平格式）
//  3. config/ 目录下的分片配置文件（database.yaml, secrets.yaml 等）
//  4. 环境变量（VCINE_ 前缀）
func Load() (*Config, error) {
	// 设置默认值
	setDefaults()

	// 配置文件搜索路径
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./data")
	viper.AddConfigPath("/etc/nowen-video")

	// 环境变量
	viper.SetEnvPrefix("VCINE")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	// 1. 读取主配置文件（不存在也不报错）
	_ = viper.ReadInConfig()

	// 2. 合并 config/ 目录下的分片配置文件
	if err := mergeConfigDir(); err != nil {
		return nil, fmt.Errorf("加载分片配置文件失败: %w", err)
	}

	// 3. 反序列化
	cfg := &Config{}
	if err := viper.Unmarshal(cfg); err != nil {
		return nil, fmt.Errorf("解析配置失败: %w", err)
	}

	// 4. 向后兼容：将旧版扁平字段合并到子模块
	cfg.migrateFromFlatConfig()

	// 4.5 全新安装时种子 vrouter 条目（默认 provider，空 key 即可调用）
	cfg.ensureDefaultProvider()

	// 5. 确保目录存在
	for _, dir := range []string{cfg.App.DataDir, cfg.Cache.CacheDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("创建目录 %s 失败: %w", dir, err)
		}
	}

	// 7. 自动生成 JWT Secret（如果仍为默认值）
	//    为避免容器/进程每次重启导致已签发 token 全部失效（用户被踢回登录页），
	//    这里将自动生成的 secret 持久化到 data 目录，后续启动优先读取该文件。
	if cfg.Secrets.JWTSecret == "v-cine-secret-change-me" {
		cfg.Secrets.JWTSecret = loadOrCreatePersistedSecret(cfg.App.DataDir)
	}

	// 8. 解密所有 ENC: 前缀敏感字段（加密侧由 enc tag 声明，读取侧零声明，
	//    兼容老明文与双重加密残留）
	decryptEncValues(cfg)

	// 9. AI 用量预算默认值兜底
	if cfg.AI.WarningThresholdPct <= 0 || cfg.AI.WarningThresholdPct > 100 {
		cfg.AI.WarningThresholdPct = 80
	}

	// 10. 视频分析配置采用安全的保守兜底。URL 和路径的严格校验在创建
	// 外部客户端/路径映射器时执行，使功能关闭时不会阻断现有服务启动。
	cfg.VideoAnalysis.SceneBaseURL = strings.TrimRight(strings.TrimSpace(cfg.VideoAnalysis.SceneBaseURL), "/")
	cfg.VideoAnalysis.StructureBaseURL = strings.TrimRight(strings.TrimSpace(cfg.VideoAnalysis.StructureBaseURL), "/")
	// 结构化产物默认跟随 cache 目录，便于 Docker 挂载与全局统一管理
	assetDir := strings.TrimSpace(cfg.VideoAnalysis.AssetDir)
	if assetDir == "" {
		assetDir = filepath.Join(cfg.Cache.CacheDir, "structure")
	}
	cfg.VideoAnalysis.AssetDir = filepath.Clean(assetDir)
	if cfg.VideoAnalysis.MaxConcurrent <= 0 {
		cfg.VideoAnalysis.MaxConcurrent = 2
	}
	if cfg.VideoAnalysis.PollIntervalSeconds <= 0 {
		cfg.VideoAnalysis.PollIntervalSeconds = 2
	}
	if cfg.VideoAnalysis.JobTimeoutMinutes <= 0 {
		cfg.VideoAnalysis.JobTimeoutMinutes = 120
	}

	// 11. V9/V10 迁移已完成，旧的 custom_providers / 顶层字段不再需要迁移。
	// writeAIYaml 已显式清除这些废弃 key，确保它们不会残留在 yaml 中。

	return cfg, nil
}

// loadOrCreatePersistedSecret 读取/生成持久化的 JWT Secret。
// 优先从 <dataDir>/.jwt_secret 读取；若不存在或内容为空，则生成 32 字节随机值并写盘。
// 写盘失败时回退到仅内存持有（打印告警但不终止进程）。
func loadOrCreatePersistedSecret(dataDir string) string {
	secretFile := filepath.Join(dataDir, ".jwt_secret")
	if b, err := os.ReadFile(secretFile); err == nil {
		s := strings.TrimSpace(string(b))
		if len(s) >= 16 {
			return s
		}
	}
	secret := generateRandomSecret(32)
	// 确保目录存在（loadConfig 已经 MkdirAll，但这里再兜底一次）
	_ = os.MkdirAll(dataDir, 0755)
	if err := os.WriteFile(secretFile, []byte(secret), 0600); err != nil {
		fmt.Fprintf(os.Stderr, "⚠️  JWT Secret 持久化失败（%v），本次使用内存随机值，下次重启将重新生成并导致所有登录态失效！\n", err)
	}
	return secret
}

// setDefaults 设置所有默认值
func setDefaults() {
	// ---- 数据库 ----
	viper.SetDefault("database.host", "127.0.0.1")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "")
	viper.SetDefault("database.dbname", "nowen_video")
	viper.SetDefault("database.auto_create", true)
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("database.timezone", "Asia/Shanghai")
	viper.SetDefault("database.max_open_conns", 25)
	viper.SetDefault("database.max_idle_conns", 10)
	viper.SetDefault("database.conn_max_lifetime", 1800)
	viper.SetDefault("database.connect_retries", 5)
	viper.SetDefault("database.connect_retry_interval", 3)

	// ---- 密钥 ----
	viper.SetDefault("secrets.jwt_secret", "v-cine-secret-change-me")
	viper.SetDefault("secrets.tmdb_api_key", "")
	viper.SetDefault("secrets.tmdb_api_proxy", "")
	viper.SetDefault("secrets.tmdb_image_proxy", "")
	viper.SetDefault("secrets.tmdb_network_proxy", "")
	viper.SetDefault("secrets.bangumi_access_token", "")
	viper.SetDefault("secrets.thetvdb_api_key", "")
	viper.SetDefault("secrets.fanart_tv_api_key", "")
	viper.SetDefault("secrets.douban_cookie", "")

	// ---- 应用 ----
	viper.SetDefault("app.port", 8080)
	viper.SetDefault("app.debug", false)
	viper.SetDefault("app.env", "production")
	viper.SetDefault("app.data_dir", "./data")
	viper.SetDefault("app.web_dir", "./web/dist")
	viper.SetDefault("app.web_base_path", "")
	viper.SetDefault("app.ffmpeg_path", "ffmpeg")
	viper.SetDefault("app.ffprobe_path", "ffprobe")
	viper.SetDefault("app.vaapi_device", "/dev/dri/renderD128")
	viper.SetDefault("app.cors_origins", []string{})

	// ---- 日志 ----
	viper.SetDefault("logging.level", "info")
	viper.SetDefault("logging.format", "json")
	viper.SetDefault("logging.output_path", "")
	viper.SetDefault("logging.error_output_path", "")
	viper.SetDefault("logging.enable_rotation", false)
	viper.SetDefault("logging.max_size_mb", 100)
	viper.SetDefault("logging.max_age_days", 30)
	viper.SetDefault("logging.max_backups", 10)

	// ---- 视频分析（默认关闭，避免升级后自动消耗计算资源） ----
	viper.SetDefault("video_analysis.enabled", false)
	viper.SetDefault("video_analysis.scene_base_url", "http://scene-detection:8910")
	viper.SetDefault("video_analysis.structure_base_url", "http://structure:8911")
	viper.SetDefault("video_analysis.media_base_url", "")
	viper.SetDefault("video_analysis.source_token", "")
	viper.SetDefault("video_analysis.remote_video_enabled", false)
	viper.SetDefault("video_analysis.asset_dir", "")
	viper.SetDefault("video_analysis.max_concurrent", 2)
	viper.SetDefault("video_analysis.poll_interval_seconds", 2)
	viper.SetDefault("video_analysis.job_timeout_minutes", 120)
	viper.SetDefault("video_analysis.describe_enabled", false)

	// ---- AI ----
	viper.SetDefault("ai.enabled", false)
	// AutoPilot 默认关闭：保留老用户行为不变；新用户在 UI 一键开启即可
	viper.SetDefault("ai.auto_pilot", false)
	// 默认允许本地 AI（ollama 等），由用户自行选择；需要强制云端时再设置 block_local_ai: true
	viper.SetDefault("ai.block_local_ai", false)
	viper.SetDefault("ai.timeout", 30)
	viper.SetDefault("ai.enable_smart_search", true)
	viper.SetDefault("ai.enable_recommend_reason", true)
	viper.SetDefault("ai.enable_metadata_enhance", true)
	viper.SetDefault("ai.monthly_budget", 0)
	viper.SetDefault("ai.cache_ttl_hours", 168)
	// 默认偏保守：单并发 + 1.1s 间隔，对齐主流云端 LLM 服务（OpenAI/阿里云百炼/DeepSeek）
	// 免费档 60 QPM 上限，避免 429。用户可在前端 AI 高级设置里手动调高。
	viper.SetDefault("ai.max_concurrent", 1)
	viper.SetDefault("ai.request_interval_ms", 1100)
	// embedding 地址即开关：默认连 V-Router 网关（容器网络内 http://v-router:8080/v1），
	// VOS 留空才禁用，改地址即改连接目标。
	viper.SetDefault("ai.embedding_ai.api_base", "http://v-router:8080/v1")
	viper.SetDefault("ai.embedding_ai.model", "ml-server/ViT-B-16-SigLIP2__webli")
	viper.SetDefault("ai.scene_describe_ai.provider_id", "")
	viper.SetDefault("ai.scene_describe_ai.model", "")
	viper.SetDefault("ai.desensitize.enabled", false)
	viper.SetDefault("ai.desensitize.base_url", "")
	viper.SetDefault("ai.desensitize.timeout", 3)
	viper.SetDefault("ai.desensitize.ner", false)
	viper.SetDefault("ai.desensitize.image_enabled", false)
	viper.SetDefault("ai.desensitize.image_timeout", 30)
	viper.SetDefault("ai.desensitize.image_scopes", []string{DesensitizeImageScopeEmbedding})

	// ---- 字幕预处理（ASR/OCR/清洗）默认值 ----
	viper.SetDefault("ai.subtitle_preprocess_workers", 1)
	viper.SetDefault("ai.ocr_enabled", false)
	viper.SetDefault("ai.tesseract_path", "tesseract")
	viper.SetDefault("ai.tesseract_lang", "chi_sim+eng")

	// 字幕清洗：默认行为偏保守，开启后也不会误杀
	viper.SetDefault("ai.sub_clean_enabled", false)
	viper.SetDefault("ai.sub_clean_remove_html", true)
	viper.SetDefault("ai.sub_clean_remove_ass_style", true)
	viper.SetDefault("ai.sub_clean_normalize_punct", false)
	viper.SetDefault("ai.sub_clean_remove_sdh", true)
	viper.SetDefault("ai.sub_clean_remove_ads", true)
	viper.SetDefault("ai.sub_clean_merge_short", true)
	viper.SetDefault("ai.sub_clean_split_long", true)
	viper.SetDefault("ai.sub_clean_backup", true)
	viper.SetDefault("ai.sub_clean_fallback_enc", "gbk")
	viper.SetDefault("ai.sub_clean_time_offset_ms", 0)
	viper.SetDefault("ai.sub_clean_min_duration_ms", 500)
	viper.SetDefault("ai.sub_clean_max_duration_ms", 10000)
	viper.SetDefault("ai.sub_clean_min_gap_ms", 200)
	viper.SetDefault("ai.sub_clean_max_chars_per_line", 42)
	viper.SetDefault("ai.sub_clean_max_lines_per_cue", 2)

	// ---- 缓存 ----
	viper.SetDefault("cache.cache_dir", "./cache")
	viper.SetDefault("cache.max_disk_usage_mb", 0)
	viper.SetDefault("cache.ttl_hours", 0)
	viper.SetDefault("cache.auto_cleanup", false)
	viper.SetDefault("cache.cleanup_interval_min", 60)

	// ---- 注册控制 ----
	viper.SetDefault("registration.enabled", false)
	viper.SetDefault("registration.invite_code", "")
	viper.SetDefault("vos_oidc.enabled", false)
	viper.SetDefault("vos_oidc.jwks_url", "http://172.17.0.1:8105/v1000/oauth2/jwks")
	viper.SetDefault("vos_oidc.issuer", "/v1000/oauth2")
	viper.SetDefault("vos_oidc.client_id", "com.ictrek.v-cine")

	// ---- Emby 兼容层 ----
	viper.SetDefault("emby.server_name", "")
	viper.SetDefault("emby.enable_auto_discovery", true)
	viper.SetDefault("emby.auto_discovery_port", 7359)
	viper.SetDefault("emby.public_user_list_enabled", false)
	viper.SetDefault("emby.enable_websocket", true)
	viper.SetDefault("emby.login_disclaimer", "")
	viper.SetDefault("emby.custom_css", "")
	viper.SetDefault("emby.allow_query_login", false)

	// ---- 存储配置 ----
	// WebDAV 存储配置
	viper.SetDefault("storage.webdav.enabled", false)
	viper.SetDefault("storage.webdav.server_url", "")
	viper.SetDefault("storage.webdav.username", "")
	viper.SetDefault("storage.webdav.password", "")
	viper.SetDefault("storage.webdav.base_path", "")
	viper.SetDefault("storage.webdav.timeout", 30)
	viper.SetDefault("storage.webdav.enable_pool", true)
	viper.SetDefault("storage.webdav.pool_size", 5)
	viper.SetDefault("storage.webdav.enable_cache", true)
	viper.SetDefault("storage.webdav.cache_ttl_hours", 24)
	viper.SetDefault("storage.webdav.max_retries", 3)
	viper.SetDefault("storage.webdav.retry_interval", 2)
	// V2.1: ReadAt 块缓存（播放器 seek 加速）
	viper.SetDefault("storage.webdav.read_block_size_mb", 8)
	viper.SetDefault("storage.webdav.read_block_count", 4)

	// V2.3: Alist 聚合网盘默认值
	viper.SetDefault("storage.alist.enabled", false)
	viper.SetDefault("storage.alist.server_url", "")
	viper.SetDefault("storage.alist.base_path", "/")
	viper.SetDefault("storage.alist.timeout", 30)
	viper.SetDefault("storage.alist.enable_cache", true)
	viper.SetDefault("storage.alist.cache_ttl_hours", 12)
	viper.SetDefault("storage.alist.read_block_size_mb", 8)
	viper.SetDefault("storage.alist.read_block_count", 4)

	// V2.3: S3 兼容对象存储默认值
	viper.SetDefault("storage.s3.enabled", false)
	viper.SetDefault("storage.s3.endpoint", "")
	viper.SetDefault("storage.s3.region", "us-east-1")
	viper.SetDefault("storage.s3.bucket", "")
	viper.SetDefault("storage.s3.base_path", "")
	viper.SetDefault("storage.s3.path_style", true)
	viper.SetDefault("storage.s3.timeout", 30)
	viper.SetDefault("storage.s3.enable_cache", true)
	viper.SetDefault("storage.s3.cache_ttl_hours", 24)
	viper.SetDefault("storage.s3.read_block_size_mb", 8)
	viper.SetDefault("storage.s3.read_block_count", 4)

	// ---- STRM 远程流 ----
	viper.SetDefault("strm.default_user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	viper.SetDefault("strm.default_referer", "")
	viper.SetDefault("strm.connect_timeout", 30)
	viper.SetDefault("strm.rewrite_hls", true)
	viper.SetDefault("strm.remote_probe", true)
	viper.SetDefault("strm.remote_probe_timeout", 8)

	// ---- 内部可观测性 ----
	// env 覆盖：VCINE_OBSERVABILITY_METRICS_ADDR / VCINE_OBSERVABILITY_PPROF_ENABLED
	//（VCINE_ 前缀 + . → _ replacer）
	viper.SetDefault("observability.metrics_addr", "127.0.0.1:9090")
	viper.SetDefault("observability.pprof_enabled", true)

	// ---- 番号刮削 ----
	viper.SetDefault("nsfw.enabled", false)
	viper.SetDefault("adult_scraper.enabled", false)
	viper.SetDefault("adult_scraper.enable_javbus", true)
	viper.SetDefault("adult_scraper.javbus_url", "")
	viper.SetDefault("adult_scraper.enable_javdb", true)
	viper.SetDefault("adult_scraper.javdb_url", "")
	viper.SetDefault("adult_scraper.python_service_url", "")
	viper.SetDefault("adult_scraper.python_service_api_key", "")
	viper.SetDefault("adult_scraper.auto_start_python", true)
	viper.SetDefault("adult_scraper.python_executable", "")
	viper.SetDefault("adult_scraper.python_service_dir", "scripts/adult-scraper")
	viper.SetDefault("adult_scraper.min_request_interval", 1500)
	viper.SetDefault("adult_scraper.max_request_interval", 3000)
	viper.SetDefault("adult_scraper.field_priority", map[string][]string{})

	// ---- 旧版兼容默认值（当使用扁平 key 时） ----
	viper.SetDefault("port", 8080)
	viper.SetDefault("debug", false)
	viper.SetDefault("data_dir", "./data")
	viper.SetDefault("cache_dir", "./cache")
	viper.SetDefault("web_dir", "./web/dist")
	viper.SetDefault("jwt_secret", "v-cine-secret-change-me")
	viper.SetDefault("ffmpeg_path", "ffmpeg")
	viper.SetDefault("ffprobe_path", "ffprobe")
	viper.SetDefault("vaapi_device", "/dev/dri/renderD128")
	viper.SetDefault("tmdb_api_key", "")
}

// mergeConfigDir 合并 config/ 目录下的分片配置文件
func mergeConfigDir() error {
	// 搜索配置目录
	configDirs := []string{"./config", "./data/config", "/etc/nowen-video/config"}

	for _, dir := range configDirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}

		// 按照固定顺序加载分片文件，确保优先级可预测
		configFiles := []struct {
			name   string // 文件名（不含扩展名）
			prefix string // 在 viper 中的 key 前缀
		}{
			{name: "database", prefix: "database"},
			{name: "secrets", prefix: "secrets"},
			{name: "app", prefix: "app"},
			{name: "logging", prefix: "logging"},
			{name: "cache", prefix: "cache"},
			{name: "video_analysis", prefix: "video_analysis"},
			{name: "ai", prefix: "ai"},
			{name: "storage", prefix: "storage"},
			{name: "strm", prefix: "strm"},
			{name: "adult_scraper", prefix: "adult_scraper"},
		}

		for _, cf := range configFiles {
			filePath := filepath.Join(dir, cf.name+".yaml")
			if _, err := os.Stat(filePath); os.IsNotExist(err) {
				continue
			}

			subViper := viper.New()
			subViper.SetConfigFile(filePath)
			if err := subViper.ReadInConfig(); err != nil {
				return fmt.Errorf("读取 %s 失败: %w", filePath, err)
			}

			// 将分片配置写入主 viper 的对应前缀下
			// 注意：分片配置中的空值不应覆盖主配置文件中已存在的非空值，
			// 避免 config/secrets.yaml 中的空 tmdb_api_key 覆盖 config.yaml 中用户已保存的值
			for _, key := range subViper.AllKeys() {
				fullKey := cf.prefix + "." + key
				// 环境变量优先：若 VCINE_<FULL_KEY 大写> 已设置且非空，则跳过 Set，
				// 避免分片文件的 viper.Set 覆盖掉 env（viper.Set 优先级高于 env）。
				// 空 env 不算覆盖——compose 的 ${VAR:-} 空占位会注入空字符串，不应误伤分片值。
				if envVarSet(fullKey) {
					continue
				}
				newVal := subViper.Get(key)
				existingVal := viper.Get(fullKey)
				// 仅当分片配置的值非空，或主配置中尚无该值时，才进行覆盖
				if !isEmptyValue(newVal) || existingVal == nil || isEmptyValue(existingVal) {
					viper.Set(fullKey, newVal)
				}
			}
		}
	}

	return nil
}

// envVarSet 判断某个配置 key 是否已有对应的环境变量（VCINE_ 前缀）且值非空。
// 用于 mergeConfigDir：分片文件的值不应覆盖显式设置的环境变量，
// 因为 viper.Set 的优先级高于 env，直接 Set 会吞掉 env 的覆盖能力。
// 注意空字符串不算"已设置"：compose 的 ${VAR:-} 空占位会注入空字符串，
// 若把空 env 视为覆盖，会误伤 database.yaml / ai.yaml 等分片的真实值。
func envVarSet(fullKey string) bool {
	envKey := "VCINE_" + strings.ToUpper(strings.NewReplacer(".", "_").Replace(fullKey))
	v, ok := os.LookupEnv(envKey)
	return ok && v != ""
}

// isEmptyValue 判断配置值是否为"空"（空字符串、nil、空切片等）
// 用于 mergeConfigDir 中避免分片配置的空值覆盖主配置中已有的非空值
func isEmptyValue(v interface{}) bool {
	if v == nil {
		return true
	}
	switch val := v.(type) {
	case string:
		return val == ""
	case []interface{}:
		return len(val) == 0
	default:
		return false
	}
}

// ensureDefaultProvider 保证内置 vrouter 条目存在并作为默认 provider
// （缺失时自动补齐；仅内存生效，幂等）。
func (c *Config) ensureDefaultProvider() {
	hasVRouter := slices.ContainsFunc(c.AI.Providers, func(p AIProviderEntry) bool { return p.ID == "vrouter" })
	if !hasVRouter {
		c.AI.Providers = append(c.AI.Providers, AIProviderEntry{
			ID:      "vrouter",
			Name:    "V-Router · VOS 账户模型",
			APIBase: "http://v-router:8080/v1",
			Enabled: true,
		})
	}
	// 默认选中：ActiveProvider 为空（从未选择）时回退内置 vrouter。
	// ActiveProvider 指向不存在的条目（如用户配置了旧版 ai.provider: deepseek 但
	// Providers 迁移后无此条目）时，尊重用户已写下的意图，不强制切到 vrouter。
	if c.AI.ActiveProvider == "" {
		c.AI.ActiveProvider = "vrouter"
	}
}

// migrateFromFlatConfig 将旧版扁平字段值合并到子模块配置中
// 规则：如果旧版字段有值且子模块字段为默认值，则使用旧版字段的值
func (c *Config) migrateFromFlatConfig() {
	// 密钥
	if c.JWTSecret != "" && c.JWTSecret != "v-cine-secret-change-me" {
		c.Secrets.JWTSecret = c.JWTSecret
	}
	if c.Secrets.JWTSecret == "" {
		c.Secrets.JWTSecret = "v-cine-secret-change-me"
	}
	if c.TMDbAPIKey != "" {
		c.Secrets.TMDbAPIKey = c.TMDbAPIKey
	}

	// 应用
	// 注意：扁平字段仅在嵌套字段为零值/默认值时才生效（向后兼容）
	// 如果嵌套字段已有非默认值（说明用户通过新版格式或 API 设置过），则以嵌套字段为准
	if c.App.Port == 0 {
		if c.Port != 0 {
			c.App.Port = c.Port
		} else {
			c.App.Port = 8080
		}
	}
	if c.Debug && !c.App.Debug {
		c.App.Debug = true
	}
	if c.App.DataDir == "" {
		if c.DataDir != "" && c.DataDir != "./data" {
			c.App.DataDir = c.DataDir
		} else {
			c.App.DataDir = "./data"
		}
	}
	if c.App.WebDir == "" {
		if c.WebDir != "" && c.WebDir != "./web/dist" {
			c.App.WebDir = c.WebDir
		} else {
			c.App.WebDir = "./web/dist"
		}
	}
	// 规范化 web_base_path：剥掉尾斜杠；"/" 视为空（根路径部署）。
	if c.App.WebBasePath != "" {
		c.App.WebBasePath = strings.TrimSuffix(c.App.WebBasePath, "/")
		if c.App.WebBasePath == "/" {
			c.App.WebBasePath = ""
		}
	}
	if c.App.FFmpegPath == "" {
		if c.FFmpegPath != "" && c.FFmpegPath != "ffmpeg" {
			c.App.FFmpegPath = c.FFmpegPath
		} else {
			c.App.FFmpegPath = "ffmpeg"
		}
	}
	if c.App.FFprobePath == "" {
		if c.FFprobePath != "" && c.FFprobePath != "ffprobe" {
			c.App.FFprobePath = c.FFprobePath
		} else {
			c.App.FFprobePath = "ffprobe"
		}
	}
	if c.App.VAAPIDevice == "" {
		if c.VAAPIDevice != "" {
			c.App.VAAPIDevice = c.VAAPIDevice
		} else {
			c.App.VAAPIDevice = "/dev/dri/renderD128"
		}
	}

	// 缓存
	if c.CacheDir != "" && c.CacheDir != "./cache" {
		c.Cache.CacheDir = c.CacheDir
	}
	if c.Cache.CacheDir == "" {
		c.Cache.CacheDir = "./cache"
	}
}

// ActiveProfile 根据 ActiveProvider 从 Providers 列表中查找并返回激活的供应商配置。
// 返回 nil 表示未找到或未配置。
func (c *AIConfig) ActiveProfile() *AIProviderEntry {
	return c.FindProvider(c.ActiveProvider)
}

// FindProvider 按 ID 从 Providers 列表中查找供应商，找不到返回 nil。
func (c *AIConfig) FindProvider(id string) *AIProviderEntry {
	if id == "" {
		return nil
	}
	for i := range c.Providers {
		if c.Providers[i].ID == id {
			return &c.Providers[i]
		}
	}
	return nil
}

// ActiveModelName 返回当前激活的模型名（优先 ActiveModel，其次 provider 的 DefaultModel）。
func (c *AIConfig) ActiveModelName() string {
	if c.ActiveModel != "" {
		return c.ActiveModel
	}
	if ap := c.ActiveProfile(); ap != nil {
		return ap.DefaultModel()
	}
	return ""
}

// ==================== 便捷访问方法（保持已有 API 兼容） ====================

// IsDefaultJWTSecret 检查是否使用自动生成的 JWT Secret（未在配置文件中显式设置）
// 注意：由于 Load() 中会自动替换默认值，此方法现在检查是否为用户显式配置
func (c *Config) IsDefaultJWTSecret() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	// 如果 viper 中原始值仍为默认值，说明用户未显式配置
	return viper.GetString("secrets.jwt_secret") == "v-cine-secret-change-me"
}

// GetTMDbAPIKey 获取 TMDb API Key（线程安全）
func (c *Config) GetTMDbAPIKey() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Secrets.TMDbAPIKey
}

// GetTMDbAPIKeyMasked 获取掩码后的 TMDb API Key（用于前端展示）
func (c *Config) GetTMDbAPIKeyMasked() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	key := c.Secrets.TMDbAPIKey
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return strings.Repeat("*", len(key))
	}
	return key[:4] + strings.Repeat("*", len(key)-8) + key[len(key)-4:]
}

// SetTMDbAPIKey 设置 TMDb API Key 并持久化到 secrets.yaml 分片。
// 不再回写主 config.yaml：主配置文件可能位于只读/属主不匹配的挂载上
// （如 VOS 共享存储），回写会报 permission denied 且导致整个保存失败。
func (c *Config) SetTMDbAPIKey(key string) error {
	return c.UpdateSecrets(func(s *SecretsConfig) { s.TMDbAPIKey = key })
}

// ClearTMDbAPIKey 清除 TMDb API Key 并持久化
func (c *Config) ClearTMDbAPIKey() error {
	return c.SetTMDbAPIKey("")
}

// GetTMDbAPIProxy 获取 TMDb API 代理地址（线程安全）
func (c *Config) GetTMDbAPIProxy() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Secrets.TMDbAPIProxy
}

// SetTMDbAPIProxy 设置 TMDb API 代理地址并持久化到 secrets.yaml 分片
// （与 SetTMDbAPIKey 相同的原因：不依赖回写主 config.yaml）。
func (c *Config) SetTMDbAPIProxy(proxy string) error {
	return c.UpdateSecrets(func(s *SecretsConfig) { s.TMDbAPIProxy = proxy })
}

// GetTMDbImageProxy 获取 TMDb 图片代理地址（线程安全）
func (c *Config) GetTMDbImageProxy() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Secrets.TMDbImageProxy
}

// SetTMDbImageProxy 设置 TMDb 图片代理地址并持久化到 secrets.yaml 分片。
func (c *Config) SetTMDbImageProxy(proxy string) error {
	return c.UpdateSecrets(func(s *SecretsConfig) { s.TMDbImageProxy = proxy })
}

// GetTMDbNetworkProxy 获取 TMDb HTTP/SOCKS 网络出口代理。
func (c *Config) GetTMDbNetworkProxy() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Secrets.TMDbNetworkProxy
}

// SetTMDbNetworkProxy 设置网络出口代理并持久化到 secrets.yaml 分片。
func (c *Config) SetTMDbNetworkProxy(proxy string) error {
	return c.UpdateSecrets(func(s *SecretsConfig) { s.TMDbNetworkProxy = proxy })
}

// ==================== 豆瓣 Cookie 管理 ====================

// GetDoubanCookie 获取豆瓣登录 Cookie（线程安全）
func (c *Config) GetDoubanCookie() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Secrets.DoubanCookie
}

// GetDoubanCookieMasked 获取掩码后的豆瓣 Cookie（用于前端展示）
// 仅展示总长度和首尾几位，中间以 * 号遮蔽
func (c *Config) GetDoubanCookieMasked() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	cookie := c.Secrets.DoubanCookie
	if cookie == "" {
		return ""
	}
	if len(cookie) <= 16 {
		return strings.Repeat("*", len(cookie))
	}
	return cookie[:8] + strings.Repeat("*", 12) + cookie[len(cookie)-8:]
}

// SetDoubanCookie 设置豆瓣 Cookie 并持久化到 secrets.yaml 分片
// （与 SetTMDbAPIKey 相同的原因：不依赖回写主 config.yaml）。
func (c *Config) SetDoubanCookie(cookie string) error {
	return c.UpdateSecrets(func(s *SecretsConfig) { s.DoubanCookie = cookie })
}

// ClearDoubanCookie 清除豆瓣 Cookie 并持久化
func (c *Config) ClearDoubanCookie() error {
	return c.SetDoubanCookie("")
}

// SetBangumiAccessToken 设置 Bangumi Access Token 并持久化到 secrets.yaml 分片
// （与 SetTMDbAPIKey 相同的原因：不依赖回写主 config.yaml）。
func (c *Config) SetBangumiAccessToken(token string) error {
	return c.UpdateSecrets(func(s *SecretsConfig) { s.BangumiAccessToken = token })
}

// ClearBangumiAccessToken 清除 Bangumi Access Token 并持久化
func (c *Config) ClearBangumiAccessToken() error {
	return c.SetBangumiAccessToken("")
}

// UpdateStorageInMemory 在锁内仅更新内存中的 Storage 配置，不落盘。
// 供 WebDAV/远程存储服务在自身重初始化流程中同步内存状态；
// 持久化由调用方随后通过 UpdateStorage 完成。
func (c *Config) UpdateStorageInMemory(update func(*StorageConfig)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	update(&c.Storage)
}

// UpdateStorage 在锁内更新并持久化 Storage 配置；落盘失败时回滚内存变更。
func (c *Config) UpdateStorage(update func(*StorageConfig)) error {
	c.mu.Lock()
	old := c.Storage
	update(&c.Storage)
	c.mu.Unlock()

	if err := c.saveStorageConfig(); err != nil {
		c.mu.Lock()
		c.Storage = old
		c.mu.Unlock()
		return err
	}
	return nil
}

// saveStorageConfig 将存储配置持久化到 config/storage.yaml 分片文件。
func (c *Config) saveStorageConfig() error {
	return SaveSection(c, "storage", "storage.yaml", func() StorageConfig {
		return c.Storage
	})
}

// UpdateSecrets 在锁内更新并持久化 Secrets 配置；落盘失败时回滚内存变更。
func (c *Config) UpdateSecrets(update func(*SecretsConfig)) error {
	c.mu.Lock()
	old := c.Secrets
	update(&c.Secrets)
	c.mu.Unlock()

	if err := saveSecretsShard(c); err != nil {
		c.mu.Lock()
		c.Secrets = old
		c.mu.Unlock()
		return err
	}
	return nil
}

// UpdateSTRM 在锁内更新并持久化 STRM 配置；落盘失败时回滚内存变更。
func (c *Config) UpdateSTRM(update func(*STRMConfig)) error {
	c.mu.Lock()
	old := c.STRM
	update(&c.STRM)
	c.mu.Unlock()

	if err := c.saveSTRMConfig(); err != nil {
		c.mu.Lock()
		c.STRM = old
		c.mu.Unlock()
		return err
	}
	return nil
}

// saveSTRMConfig 将 STRM 配置持久化到 config/strm.yaml 分片文件。
func (c *Config) saveSTRMConfig() error {
	return SaveSection(c, "strm", "strm.yaml", func() STRMConfig {
		return c.STRM
	})
}

// UpdateAdultScraperConfig 在锁内更新并持久化番号刮削配置；落盘失败时回滚内存变更。
func (c *Config) UpdateAdultScraperConfig(update func(*AdultScraperConfig)) error {
	c.mu.Lock()
	old := deepCopyAdultScraperConfig(c.AdultScraper)
	update(&c.AdultScraper)
	c.mu.Unlock()

	if err := c.saveAdultScraperConfig(); err != nil {
		c.mu.Lock()
		c.AdultScraper = old
		c.mu.Unlock()
		return err
	}
	return nil
}

// deepCopyAdultScraperConfig 拷贝 AdultScraper 配置（含 FieldPriority map，
// 避免共享底层 map 导致回滚不彻底）。
func deepCopyAdultScraperConfig(a AdultScraperConfig) AdultScraperConfig {
	out := a
	if a.FieldPriority != nil {
		out.FieldPriority = make(map[string][]string, len(a.FieldPriority))
		for k, v := range a.FieldPriority {
			out.FieldPriority[k] = append([]string(nil), v...)
		}
	}
	return out
}

// saveAdultScraperConfig 将番号刮削配置持久化到 config/adult_scraper.yaml 分片文件。
func (c *Config) saveAdultScraperConfig() error {
	return SaveSection(c, "adult_scraper", "adult_scraper.yaml", func() AdultScraperConfig {
		return c.AdultScraper
	})
}

// UpdateVideoAnalysisConfig 在锁内更新并持久化视频分析配置；
// 落盘失败时回滚内存中的变更。
func (c *Config) UpdateVideoAnalysisConfig(update func(*VideoAnalysisConfig)) error {
	c.mu.Lock()
	old := c.VideoAnalysis
	update(&c.VideoAnalysis)
	c.mu.Unlock()

	if err := c.saveVideoAnalysisConfig(); err != nil {
		c.mu.Lock()
		c.VideoAnalysis = old
		c.mu.Unlock()
		return err
	}
	return nil
}

// saveVideoAnalysisConfig 将视频分析配置持久化到 config/video_analysis.yaml 分片文件。
func (c *Config) saveVideoAnalysisConfig() error {
	return SaveSection(c, "video_analysis", "video_analysis.yaml", func() VideoAnalysisConfig {
		return c.VideoAnalysis
	})
}

// SetVideoAnalysisDescribeEnabled 仅更新内存中的 describe_enabled（热更新，不落盘）。
func (c *Config) SetVideoAnalysisDescribeEnabled(enabled bool) {
	c.mu.Lock()
	c.VideoAnalysis.DescribeEnabled = enabled
	c.mu.Unlock()
}

// saveAIConfig 将当前 AI 配置持久化到 config/ai.yaml 分片文件。
// 调用前应先在内存中更新 c.AI 字段，本方法只负责落盘。
// 敏感字段（providers[].api_key / whisper_api_key）由 enc tag 声明加密。
// snapshot 必须返回深拷贝：SaveSection 的 encryptStruct 通过反射原地改写
// enc 字段，浅拷贝时 Providers 切片与 c.AI.Providers 共享底层数组，会把
// 内存中的明文 key 原地加密成 ENC:xxx（之后所有调用发送 Bearer ENC:xxx 必然 401）。
func (c *Config) saveAIConfig() error {
	return SaveSection(c, "ai", "ai.yaml", func() AIConfig { return deepCopyAIConfig(c.AI) })
}

// UpdateAIConfig 在锁内更新 AI 配置并持久化到 config/ai.yaml 分片文件
// （与 saveAIConfig 相同的 api_key 加密处理）。
// 持久化失败时用拷贝回滚内存状态（避免共享切片底层数组导致回滚不彻底）；
// 落盘在 c.mu 之外执行，避免文件 I/O 阻塞并发的 AI 配置读取。
func (c *Config) UpdateAIConfig(update func(*AIConfig)) error {
	c.mu.Lock()
	old := deepCopyAIConfig(c.AI)
	update(&c.AI)
	c.mu.Unlock()

	if err := c.saveAIConfig(); err != nil {
		c.mu.Lock()
		c.AI = old
		c.mu.Unlock()
		return err
	}
	return nil
}

// deepCopyAIConfig 拷贝 AI 配置（拷贝 Providers 切片），用于回滚时避免共享切片底层数组。
// update 回调只修改 Providers 与顶层标量字段；若未来出现原地修改嵌套切片的回调，再加深拷贝。
func deepCopyAIConfig(c AIConfig) AIConfig {
	out := c
	out.Providers = append([]AIProviderEntry(nil), c.Providers...)
	return out
}

// generateRandomSecret 生成随机密钥字符串
func generateRandomSecret(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
	b := make([]byte, length)
	// 使用 crypto/rand 生成安全随机数
	if _, err := cryptoRand.Read(b); err != nil {
		// 降级使用时间戳（极端情况）
		for i := range b {
			b[i] = charset[i%len(charset)]
		}
		return string(b)
	}
	for i := range b {
		b[i] = charset[int(b[i])%len(charset)]
	}
	return string(b)
}
