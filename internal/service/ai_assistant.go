package service

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
)

// ==================== AI 助手服务 ====================

// AIAssistantService AI助手服务
type AIAssistantService struct {
	ai          *AIService
	fileManager *FileManagerService
	scanner     *ScannerService
	mediaRepo   *repository.MediaRepo
	seriesRepo  *repository.SeriesRepo
	wsHub       *WSHub
	logger      *zap.SugaredLogger

	// 会话管理
	sessions   map[string]*ChatSession
	sessionsMu sync.RWMutex

	// 操作历史（用于撤销）
	opHistory   []AssistantOperation
	opHistoryMu sync.Mutex
}

// ChatSession 对话会话
type ChatSession struct {
	ID        string         `json:"id"`
	UserID    string         `json:"user_id"`
	Messages  []ChatMsg      `json:"messages"`
	Context   SessionContext `json:"context"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// ChatMsg 对话消息
type ChatMsg struct {
	Role      string    `json:"role"` // user / assistant / system
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
	// 助手消息附带的操作建议
	Actions []SuggestedAction `json:"actions,omitempty"`
	// 助手消息附带的预览数据
	Previews []OperationPreview `json:"previews,omitempty"`
}

// SessionContext 会话上下文
type SessionContext struct {
	SelectedMediaIDs []string `json:"selected_media_ids,omitempty"` // 当前选中的文件
	LibraryID        string   `json:"library_id,omitempty"`         // 当前媒体库
	LastIntent       *Intent  `json:"last_intent,omitempty"`        // 上一次解析的意图
}

// Intent AI解析的用户意图
type Intent struct {
	Action     string            `json:"action"`     // rename / scrape / delete / classify / tag / analyze / fix / move
	SubAction  string            `json:"sub_action"` // 子操作类型
	Targets    string            `json:"targets"`    // all / selected / filtered
	Params     map[string]string `json:"params"`     // 操作参数
	Confidence float64           `json:"confidence"` // 置信度 0-1
	Reasoning  string            `json:"reasoning"`  // AI推理过程
}

// UnmarshalJSON 兼容 LLM 输出的 params 值类型不稳定（字符串/布尔/数字/嵌套对象）：
// Params 声明为 map[string]string，此处把非字符串值转换为字符串，避免整体解析失败。
func (i *Intent) UnmarshalJSON(data []byte) error {
	type alias Intent
	var v struct {
		alias
		Params json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*i = Intent(v.alias)
	i.Params = map[string]string{}
	if len(v.Params) == 0 {
		return nil
	}
	var m map[string]interface{}
	if err := json.Unmarshal(v.Params, &m); err != nil {
		return nil
	}
	for k, v := range m {
		switch tv := v.(type) {
		case string:
			i.Params[k] = tv
		case bool:
			i.Params[k] = strconv.FormatBool(tv)
		case float64:
			i.Params[k] = strconv.FormatFloat(tv, 'f', -1, 64)
		default:
			b, _ := json.Marshal(v)
			i.Params[k] = string(b)
		}
	}
	return nil
}

// SuggestedAction 建议的操作
type SuggestedAction struct {
	ID          string `json:"id"`
	Label       string `json:"label"`       // 按钮文字
	Description string `json:"description"` // 操作描述
	Action      string `json:"action"`      // 操作类型
	Params      string `json:"params"`      // JSON参数
	Dangerous   bool   `json:"dangerous"`   // 是否危险操作
}

// UnmarshalJSON 兼容 LLM 输出的 params 为字符串或对象两种形态（输出不稳定），
// 避免对象形态无法解析进 string 字段导致整体 JSON 解析失败回退显示原始文本。
func (a *SuggestedAction) UnmarshalJSON(data []byte) error {
	type alias SuggestedAction
	var v struct {
		alias
		Params json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*a = SuggestedAction(v.alias)
	var s string
	if err := json.Unmarshal(v.Params, &s); err == nil {
		a.Params = s
	} else if raw := string(v.Params); raw != "null" && raw != "" {
		a.Params = raw // 对象形态：保留原始 JSON 文本
	}
	return nil
}

// OperationPreview 操作预览
type OperationPreview struct {
	MediaID    string `json:"media_id"`
	Title      string `json:"title"`
	OldValue   string `json:"old_value"`
	NewValue   string `json:"new_value"`
	ChangeType string `json:"change_type"` // rename / tag / metadata / move
}

// AssistantOperation 助手执行的操作（用于撤销）
type AssistantOperation struct {
	ID         string             `json:"id"`
	SessionID  string             `json:"session_id"`
	Action     string             `json:"action"`
	Previews   []OperationPreview `json:"previews"`
	ExecutedAt time.Time          `json:"executed_at"`
	UserID     string             `json:"user_id"`
	Undone     bool               `json:"undone"`
}

// ChatRequest 对话请求
type ChatRequest struct {
	SessionID string   `json:"session_id"` // 空则创建新会话
	Message   string   `json:"message"`
	MediaIDs  []string `json:"media_ids,omitempty"`  // 当前选中的文件
	LibraryID string   `json:"library_id,omitempty"` // 当前媒体库
}

// ChatResponse 对话响应
type ChatResponse struct {
	SessionID string  `json:"session_id"`
	Message   ChatMsg `json:"message"`
	Intent    *Intent `json:"intent,omitempty"`
}

// ExecuteRequest 执行操作请求
type ExecuteRequest struct {
	SessionID string `json:"session_id"`
	ActionID  string `json:"action_id"`
}

// ExecuteResponse 执行操作响应
type ExecuteResponse struct {
	Success bool               `json:"success"`
	Message string             `json:"message"`
	Results []OperationPreview `json:"results,omitempty"`
	Errors  []string           `json:"errors,omitempty"`
	OpID    string             `json:"op_id"` // 操作ID，用于撤销
}

// NewAIAssistantService 创建AI助手服务
func NewAIAssistantService(
	ai *AIService,
	fileManager *FileManagerService,
	scanner *ScannerService,
	mediaRepo *repository.MediaRepo,
	seriesRepo *repository.SeriesRepo,
	logger *zap.SugaredLogger,
) *AIAssistantService {
	return &AIAssistantService{
		ai:          ai,
		fileManager: fileManager,
		scanner:     scanner,
		mediaRepo:   mediaRepo,
		seriesRepo:  seriesRepo,
		logger:      logger,
		sessions:    make(map[string]*ChatSession),
	}
}

// SetWSHub 设置WebSocket Hub
func (s *AIAssistantService) SetWSHub(hub *WSHub) {
	s.wsHub = hub
}

// ==================== 对话管理 ====================

// Chat 处理用户对话
func (s *AIAssistantService) Chat(req ChatRequest, userID string) (*ChatResponse, error) {
	if s.ai == nil || !s.ai.IsEnabled() {
		return nil, fmt.Errorf("AI服务未启用，请先在系统管理中配置AI服务")
	}

	// 获取或创建会话
	session := s.getOrCreateSession(req.SessionID, userID)

	// 更新会话上下文
	if len(req.MediaIDs) > 0 {
		session.Context.SelectedMediaIDs = req.MediaIDs
	}
	if req.LibraryID != "" {
		session.Context.LibraryID = req.LibraryID
	}

	// 添加用户消息
	userMsg := ChatMsg{
		Role:      "user",
		Content:   req.Message,
		Timestamp: time.Now(),
	}
	session.Messages = append(session.Messages, userMsg)

	// 构建上下文信息
	contextInfo := s.buildContextInfo(session)

	// 调用AI解析意图并生成回复
	systemPrompt := s.buildSystemPrompt()
	userPrompt := s.buildUserPrompt(req.Message, contextInfo, session)

	response, err := s.ai.ChatCompletionJSON(systemPrompt, userPrompt, 0.3, 10000)
	if err != nil {
		return nil, fmt.Errorf("AI处理失败: %w", err)
	}

	// 解析AI响应
	assistantMsg, intent := s.parseAIResponse(response, session)

	// 保存意图到上下文
	if intent != nil {
		session.Context.LastIntent = intent
	}

	// 添加助手消息
	session.Messages = append(session.Messages, assistantMsg)
	session.UpdatedAt = time.Now()

	return &ChatResponse{
		SessionID: session.ID,
		Message:   assistantMsg,
		Intent:    intent,
	}, nil
}

// getOrCreateSession 获取或创建会话
func (s *AIAssistantService) getOrCreateSession(sessionID, userID string) *ChatSession {
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()

	if sessionID != "" {
		if session, ok := s.sessions[sessionID]; ok && session.UserID == userID {
			return session
		}
		// 属主不匹配的会话不复用，落入新建，避免读到他人会话
	}

	// 创建新会话
	session := &ChatSession{
		ID:        uuid.New().String(),
		UserID:    userID,
		Messages:  []ChatMsg{},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	s.sessions[session.ID] = session

	// 清理过期会话（保留最近50个）
	if len(s.sessions) > 50 {
		s.cleanOldSessions()
	}

	return session
}

// cleanOldSessions 清理过期会话
func (s *AIAssistantService) cleanOldSessions() {
	cutoff := time.Now().Add(-24 * time.Hour)
	for id, session := range s.sessions {
		if session.UpdatedAt.Before(cutoff) {
			delete(s.sessions, id)
		}
	}
}

// executableActions 可执行的意图 action（顺序即提示词中的展示顺序），
// 提示词的 action 白名单由此生成；分发出 ExecuteAction 的 switch 负责，新增时两处同步。
var executableActions = []string{
	"rename_template", "rename_ai", "scrape", "batch_tag", "tag", "analyze",
	"detect_duplicates", "analyze_misclassification", "reclassify",
	"reclassify_high_confidence", "reclassify_all",
}

// buildSystemPrompt 构建系统提示词
func (s *AIAssistantService) buildSystemPrompt() string {
	return `你是一个影视文件管理AI助手，专门帮助用户管理影视文件库。你的能力包括：

## 核心能力
1. **批量重命名**：根据用户指令智能重命名文件（支持电视剧、电影、纪录片等模式）
2. **批量刮削**：为文件获取元数据（从TMDb、Bangumi等数据源）
3. **文件分类**：按类型、年份、评分等属性自动分组整理
4. **元数据编辑**：批量修改标签、描述、评分等信息
5. **重复检测**：识别重复文件并提供处理建议
6. **智能纠错**：检测文件名不一致问题并修复
7. **文件分析**：分析文件库状态，提供优化建议
8. **误分类检测**：检测被错误标记为电影的剧集文件，基于文件名模式（S01E01、第X集等）、目录结构（季目录）、同目录文件数量等特征进行智能识别
9. **批量重分类**：将误分类的文件批量修正为正确的类型，并自动关联到剧集合集

## 响应格式
你必须严格按照以下JSON格式响应（不要输出其他内容）。注意：这是标准JSON，所有字符串必须使用双引号（"..."），禁止使用单引号（'...'）、Python字典风格或未转义的换行符：
{
  "message": "你的回复文本（使用Markdown格式，友好自然的语气）",
  "intent": {
    "action": "操作类型（` + strings.Join(executableActions, "/") + `，不要使用其他类型）",
    "sub_action": "子操作类型",
    "targets": "操作目标（all/selected/filtered）",
    "params": {"key": "value"},
    "confidence": 0.95,
    "reasoning": "推理过程"
  },
  "actions": [
    {
      "id": "唯一ID",
      "label": "按钮文字",
      "description": "操作描述",
      "action": "操作类型",
      "params": "JSON参数字符串",
      "dangerous": false
    }
  ],
  "previews": [
    {
      "media_id": "文件ID",
      "title": "文件标题",
      "old_value": "旧值",
      "new_value": "新值",
      "change_type": "变更类型"
    }
  ]
}

## 重要规则
- 对于危险操作（删除、批量修改），必须先展示预览并要求确认
- 如果用户的指令不够明确，主动询问细节
- 根据上下文推断用户意图，提供智能建议
- 如果没有选中文件但用户要求操作，提醒用户先选择文件
- previews数组最多展示10条预览，如果超过则在message中说明总数
- 如果无法确定操作意图，将action设为"suggest"并提供建议

## 意图识别规则（必须严格遵守）
- 用户要求"添加标签/分类/自动分类/打标签/整理分类/归类标签"时：
  - intent.action 必须为 "batch_tag"，不得使用其他类型
  - actions 数组必须包含一个可执行的 batch_tag 操作项（id、label 如"🏷️ 自动添加标签并分类"）
  - 该操作项的 params 必须为 {"genres":"标签1,标签2,..."}（逗号分隔），结合选中文件的当前分类与内容给出合适的标签，不得遗漏 genres 字段
  - 同时在 previews 数组中列出每个选中文件的 media_id/title 与建议的标签（old_value 为当前分类，new_value 为合并后的分类）
- 用户要求"重命名"时：intent.action 为 "rename_ai"（智能重命名）或 "rename_template"（模板重命名），actions 包含对应可执行操作
- 用户要求"智能纠错/修复命名问题"时：intent.action 必须为 "rename_ai"，不得使用 "fix" 等其他类型
- 用户要求"刮削/获取元数据"时：intent.action 为 "scrape"，actions 包含 scrape 操作
- 用户要求"分析文件库状态/统计"时：intent.action 为 "analyze"
- 用户要求"检测误分类/修正类型/改为剧集"时：intent.action 为 "analyze_misclassification" 或 "reclassify*"
- 用户要求"检测重复文件/查找重复/重复检测"时：intent.action 必须为 "detect_duplicates"，actions 数组必须包含一个可执行的 detect_duplicates 操作项（label 如"🔎 检测重复文件"）
- intent.action 与 actions 数组中的操作必须一致；可执行意图下 actions 不得为空数组`
}

// buildUserPrompt 构建用户提示词
func (s *AIAssistantService) buildUserPrompt(message, contextInfo string, session *ChatSession) string {
	// 构建对话历史（最近5轮）
	historyStr := ""
	startIdx := 0
	if len(session.Messages) > 10 {
		startIdx = len(session.Messages) - 10
	}
	for i := startIdx; i < len(session.Messages); i++ {
		msg := session.Messages[i]
		historyStr += fmt.Sprintf("[%s]: %s\n", msg.Role, msg.Content)
	}

	return fmt.Sprintf(`## 当前上下文
%s

## 对话历史
%s

## 用户当前指令
%s

请分析用户意图并按照指定JSON格式响应。`, contextInfo, historyStr, message)
}

// buildContextInfo 构建上下文信息
func (s *AIAssistantService) buildContextInfo(session *ChatSession) string {
	var parts []string

	// 选中的文件信息
	if len(session.Context.SelectedMediaIDs) > 0 {
		parts = append(parts, fmt.Sprintf("已选中 %d 个文件", len(session.Context.SelectedMediaIDs)))

		// 获取前5个文件的详细信息
		limit := min(5, len(session.Context.SelectedMediaIDs))
		var fileInfos []string
		for i := 0; i < limit; i++ {
			media, err := s.mediaRepo.FindByID(session.Context.SelectedMediaIDs[i])
			if err == nil {
				info := fmt.Sprintf("- ID:%s 标题:'%s' 原标题:'%s' 年份:%d 类型:%s 分辨率:%s 评分:%.1f",
					media.ID, media.Title, media.OrigTitle, media.Year, media.MediaType, media.Resolution, media.Rating)
				if media.SeriesID != "" {
					info += fmt.Sprintf(" 季:%d 集:%d", media.SeasonNum, media.EpisodeNum)
				}
				if media.Genres != "" {
					info += fmt.Sprintf(" 类型:%s", media.Genres)
				}
				fileInfos = append(fileInfos, info)
			}
		}
		if len(fileInfos) > 0 {
			parts = append(parts, "选中文件详情:\n"+strings.Join(fileInfos, "\n"))
		}
		if len(session.Context.SelectedMediaIDs) > limit {
			parts = append(parts, fmt.Sprintf("（还有 %d 个文件未展示）", len(session.Context.SelectedMediaIDs)-limit))
		}
	} else {
		parts = append(parts, "当前未选中任何文件")
	}

	// 媒体库信息
	if session.Context.LibraryID != "" {
		parts = append(parts, fmt.Sprintf("当前媒体库ID: %s", session.Context.LibraryID))
	}

	// 上一次意图
	if session.Context.LastIntent != nil {
		parts = append(parts, fmt.Sprintf("上一次操作意图: %s (%s)", session.Context.LastIntent.Action, session.Context.LastIntent.Reasoning))
	}

	return strings.Join(parts, "\n")
}

// parseAIResponse 解析AI响应
func (s *AIAssistantService) parseAIResponse(response string, session *ChatSession) (ChatMsg, *Intent) {
	// 尝试解析JSON
	var parsed struct {
		Message  string             `json:"message"`
		Intent   *Intent            `json:"intent"`
		Actions  []SuggestedAction  `json:"actions"`
		Previews []OperationPreview `json:"previews"`
	}

	// 清理可能的markdown代码块包裹
	cleanResponse := response
	cleanResponse = strings.TrimPrefix(cleanResponse, "```json")
	cleanResponse = strings.TrimPrefix(cleanResponse, "```")
	cleanResponse = strings.TrimSuffix(cleanResponse, "```")
	cleanResponse = strings.TrimSpace(cleanResponse)

	// 截取首尾花括号之间的 JSON 主体（LLM 可能在 JSON 前后输出说明文字或多余片段）
	if start := strings.Index(cleanResponse, "{"); start >= 0 {
		if end := strings.LastIndex(cleanResponse, "}"); end > start {
			cleanResponse = cleanResponse[start : end+1]
		}
	}

	msg := ChatMsg{
		Role:      "assistant",
		Timestamp: time.Now(),
	}

	if err := json.Unmarshal([]byte(cleanResponse), &parsed); err != nil {
		// 首次解析失败后修复伪 JSON 重试：即使发送 response_format=json_object，
		// 本地/自建服务端也可能忽略该参数，LLM 退化为自由输出 Python 风格单引号伪 JSON，
		// json.Unmarshal 必然失败导致整段原始 JSON 直接显示在聊天气泡中。
		repaired := repairJSON(cleanResponse)
		if err2 := json.Unmarshal([]byte(repaired), &parsed); err2 != nil {
			// 修复后仍失败，直接使用原始文本
			s.logger.Debugf("AI响应JSON解析失败（含修复重试），使用原始文本: %v / %v", err, err2)
			msg.Content = response
			return msg, nil
		}
	}

	msg.Content = parsed.Message
	msg.Actions = parsed.Actions
	msg.Previews = parsed.Previews

	// 如果AI没有生成预览但意图是重命名且有选中文件，自动生成预览
	if parsed.Intent != nil && (parsed.Intent.Action == "rename_ai" || parsed.Intent.Action == "rename_template") && len(msg.Previews) == 0 && len(session.Context.SelectedMediaIDs) > 0 {
		template := parsed.Intent.Params["template"]
		if template == "" {
			template = defaultRenameTemplate
		}
		records := s.generateRenameRecords(session, template)
		msg.Previews = records[:min(10, len(records))]
	}

	// 批量标签：LLM 常只给意图不给操作项，这里用 intent.params 里的标签兜底补一个可点击的操作项，
	// 保证"自动分类"始终可执行（逐文件的合并结果由执行后的 response.results 回显）
	if parsed.Intent != nil && parsed.Intent.Action == "batch_tag" {
		if tags := tagsFromParams(parsed.Intent.Params["genres"], parsed.Intent.Params["tags"]); tags != "" && len(msg.Actions) == 0 {
			msg.Actions = []SuggestedAction{{
				Label:       "🏷️ 自动添加标签并分类",
				Description: "为选中的文件追加标签：" + tags,
				Action:      "batch_tag",
				Params:      fmt.Sprintf(`{"genres":%q}`, tags),
			}}
		}
	}

	// 选中文件超过预览上限（10 条）时在消息中说明，避免用户误以为执行仅作用于预览部分
	if len(msg.Previews) > 0 && len(session.Context.SelectedMediaIDs) > 10 {
		msg.Content += fmt.Sprintf("\n\n> 💡 预览仅展示部分文件，执行将作用于全部 %d 个选中文件。", len(session.Context.SelectedMediaIDs))
	}

	// 如果意图是误分类检测，自动添加操作按钮
	if parsed.Intent != nil && parsed.Intent.Action == "analyze_misclassification" {
		if len(msg.Actions) == 0 {
			msg.Actions = []SuggestedAction{
				{
					Label:       "🔍 开始分析",
					Description: "扫描文件库，检测被误标记为电影的剧集文件",
					Action:      "analyze_misclassification",
					Dangerous:   false,
				},
			}
		}
	}

	// 如果意图是重分类，自动添加操作按钮
	if parsed.Intent != nil && parsed.Intent.Action == "reclassify" {
		if len(msg.Actions) == 0 {
			msg.Actions = []SuggestedAction{
				{
					Label:       "🔴 重分类高置信度文件",
					Description: "将置信度>80%的误分类文件重新分类为剧集",
					Action:      "reclassify_high_confidence",
					Dangerous:   false,
				},
				{
					Label:       "⚠️ 重分类所有疑似文件",
					Description: "将所有疑似误分类的文件重新分类为剧集（包含低置信度）",
					Action:      "reclassify_all",
					Dangerous:   true,
				},
			}
		}
	}

	// action ID 一律由服务端生成：LLM 给的 id 格式不定且可能跨轮重复，
	// 而 ExecuteAction 在会话历史中按 ID 查找首个匹配，重名会执行到旧消息的操作
	for i := range msg.Actions {
		msg.Actions[i].ID = fmt.Sprintf("act_%d_%d", time.Now().UnixMilli(), i)
	}

	return msg, parsed.Intent
}

// repairJSON 将 LLM 输出的伪 JSON 修复为合法 JSON（常见于忽略 response_format 的本地/自建推理服务与小模型）：
//  1. Python 风格单引号字符串 → 双引号（串内双引号转义为 \"，\' 还原为 '）
//  2. Python 字面量 None/True/False → null/true/false（仅字符串外的完整标识符）
//  3. 尾逗号：[1, 2, ] / {..., } 去掉逗号
//
// 引号内内容不做字面量替换，双引号串里的英文撇号（don't）不受影响；已是合法 JSON 的输入原样返回。
func repairJSON(src string) string {
	buf := make([]byte, 0, len(src)+16)
	inSingle, inDouble := false, false
	for i := 0; i < len(src); i++ {
		c := src[i]
		switch {
		case inSingle:
			switch c {
			case '\\':
				if i+1 < len(src) && src[i+1] == '\'' {
					buf = append(buf, '\'') // \' 还原为 '
					i++
				} else { // 其余转义原样保留（含 \\、\n）
					buf = append(buf, c)
					if i+1 < len(src) {
						buf = append(buf, src[i+1])
						i++
					}
				}
			case '\'':
				inSingle = false
				buf = append(buf, '"')
			case '"':
				buf = append(buf, "\\\""...) // 串内双引号是内容，需转义
			default:
				buf = append(buf, c)
			}
		case inDouble:
			buf = append(buf, c)
			switch {
			case c == '\\' && i+1 < len(src):
				i++
				buf = append(buf, src[i])
			case c == '"':
				inDouble = false
			}
		default: // 字符串外
			switch {
			case c == '\'':
				inSingle = true
				buf = append(buf, '"')
			case c == '"':
				inDouble = true
				buf = append(buf, c)
			case c == ',':
				// 尾逗号：逗号后（仅空白）紧跟 ] 或 } 时，连逗号带尾部空白一起去掉
				j := i + 1
				for j < len(src) && strings.ContainsRune(" \t\r\n", rune(src[j])) {
					j++
				}
				if j < len(src) && (src[j] == ']' || src[j] == '}') {
					buf = []byte(strings.TrimRight(string(buf), " \t\r\n"))
					i = j - 1
				} else {
					buf = append(buf, c)
				}
			default:
				if lit := pyLiteral(src[i:]); lit != "" {
					// None/null、True/true、False/false 长度相同，按字面量长度推进即可
					buf = append(buf, lit...)
					i += len(lit) - 1
				} else {
					buf = append(buf, c)
				}
			}
		}
	}
	return string(buf)
}

// pyLiteral 匹配 src 开头的 Python 字面量（要求是完整标识符），返回对应 JSON 字面量；不匹配返回 ""
func pyLiteral(src string) string {
	for _, l := range [...]struct{ py, js string }{{"None", "null"}, {"True", "true"}, {"False", "false"}} {
		if rest, ok := strings.CutPrefix(src, l.py); ok && (rest == "" || !isWordByte(rest[0])) {
			return l.js
		}
	}
	return ""
}

func isWordByte(c byte) bool {
	return c == '_' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
}

// defaultRenameTemplate 默认重命名模板
const defaultRenameTemplate = "{title} ({year}) [{resolution}]"

// tagsFromParams 读取 LLM 给的标签（genres 优先，兼容它用 tags key 的情况）
func tagsFromParams(genres, tags string) string {
	if g := strings.TrimSpace(genres); g != "" {
		return g
	}
	return strings.TrimSpace(tags)
}

// generateRenameRecords 按模板为选中文件生成完整 old→new 记录（不限条数，撤销依据）。
// 与 ExecuteRename 的重命名逻辑一致：模板生成结果与当前标题相同的文件跳过。
func (s *AIAssistantService) generateRenameRecords(session *ChatSession, template string) []OperationPreview {
	var records []OperationPreview
	for _, id := range session.Context.SelectedMediaIDs {
		media, err := s.mediaRepo.FindByID(id)
		if err != nil {
			continue
		}
		newTitle := s.fileManager.generateRenameTitle(media, template)
		if newTitle != media.Title {
			records = append(records, OperationPreview{
				MediaID:    media.ID,
				Title:      media.Title,
				OldValue:   media.Title,
				NewValue:   newTitle,
				ChangeType: "rename",
			})
		}
	}
	return records
}

// ==================== 操作执行 ====================

// ExecuteAction 执行AI建议的操作
func (s *AIAssistantService) ExecuteAction(req ExecuteRequest, userID string) (*ExecuteResponse, error) {
	s.sessionsMu.RLock()
	session, ok := s.sessions[req.SessionID]
	s.sessionsMu.RUnlock()
	if !ok || session.UserID != userID {
		return nil, fmt.Errorf("会话不存在或已过期")
	}

	// 查找对应的操作
	var targetAction *SuggestedAction
	for _, msg := range session.Messages {
		for i := range msg.Actions {
			if msg.Actions[i].ID == req.ActionID {
				targetAction = &msg.Actions[i]
				break
			}
		}
	}
	if targetAction == nil {
		return nil, fmt.Errorf("操作不存在")
	}

	// 根据操作类型执行
	switch targetAction.Action {
	case "rename_template":
		return s.executeRenameTemplate(session, targetAction, userID)
	case "rename_ai":
		return s.executeRenameAI(session, targetAction, userID)
	case "scrape":
		return s.executeScrape(session, targetAction, userID)
	case "batch_tag", "tag":
		return s.executeBatchTag(session, targetAction, userID)
	case "detect_duplicates":
		return s.executeDetectDuplicates(session, targetAction, userID)
	case "analyze":
		return s.executeAnalyze(session, userID)
	case "analyze_misclassification":
		return s.executeAnalyzeMisclassification(session, userID)
	case "reclassify":
		return s.executeReclassify(session, targetAction, userID)
	case "reclassify_high_confidence":
		return s.executeReclassifyByConfidence(session, 0.8, userID)
	case "reclassify_all":
		return s.executeReclassifyByConfidence(session, 0.3, userID)
	default:
		return nil, fmt.Errorf("不支持的操作类型: %s", targetAction.Action)
	}
}

// executeRenameTemplate 执行模板重命名
func (s *AIAssistantService) executeRenameTemplate(session *ChatSession, action *SuggestedAction, userID string) (*ExecuteResponse, error) {
	if len(session.Context.SelectedMediaIDs) == 0 {
		return &ExecuteResponse{Success: false, Message: "没有选中的文件"}, nil
	}

	// 解析参数
	var params struct {
		Template string `json:"template"`
	}
	if action.Params != "" {
		json.Unmarshal([]byte(action.Params), &params)
	}
	if params.Template == "" {
		params.Template = defaultRenameTemplate
	}

	// 执行前生成完整 old→new 记录：展示预览截断到 10 条，撤销记录保留全部（与实际重命名范围一致）
	records := s.generateRenameRecords(session, params.Template)
	previews := records[:min(10, len(records))]

	// 执行重命名
	renamed, errors := s.fileManager.ExecuteRename(session.Context.SelectedMediaIDs, params.Template, userID)

	// 记录操作历史
	op := AssistantOperation{
		ID:         uuid.New().String(),
		SessionID:  session.ID,
		Action:     "rename_template",
		Previews:   records,
		ExecutedAt: time.Now(),
		UserID:     userID,
	}
	s.addOperation(op)

	resp := &ExecuteResponse{
		Success: true,
		Message: fmt.Sprintf("成功重命名 %d 个文件", renamed),
		Results: previews,
		OpID:    op.ID,
	}
	if len(errors) > 0 {
		resp.Errors = errors
		resp.Message += fmt.Sprintf("，%d 个失败", len(errors))
	}

	return resp, nil
}

// executeRenameAI 执行AI智能重命名
func (s *AIAssistantService) executeRenameAI(session *ChatSession, action *SuggestedAction, userID string) (*ExecuteResponse, error) {
	if len(session.Context.SelectedMediaIDs) == 0 {
		return &ExecuteResponse{Success: false, Message: "没有选中的文件"}, nil
	}

	// 解析参数
	var params struct {
		TargetLang string `json:"target_lang"`
	}
	if action.Params != "" {
		json.Unmarshal([]byte(action.Params), &params)
	}

	// 先生成预览
	previews, err := s.fileManager.AIGenerateRenames(session.Context.SelectedMediaIDs, params.TargetLang)
	if err != nil {
		return &ExecuteResponse{Success: false, Message: err.Error()}, nil
	}

	// 执行重命名（使用AI生成的标题）
	successCount := 0
	var errors []string
	var opPreviews []OperationPreview

	for _, p := range previews {
		// 通过更新文件信息来重命名
		updates := map[string]interface{}{"title": p.NewTitle}
		_, err := s.fileManager.UpdateFileInfo(p.MediaID, updates, userID)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", p.OldTitle, err))
		} else {
			successCount++
			opPreviews = append(opPreviews, OperationPreview{
				MediaID:    p.MediaID,
				Title:      p.OldTitle,
				OldValue:   p.OldTitle,
				NewValue:   p.NewTitle,
				ChangeType: "rename",
			})
		}
	}

	// 记录操作
	op := AssistantOperation{
		ID:         uuid.New().String(),
		SessionID:  session.ID,
		Action:     "rename_ai",
		Previews:   opPreviews,
		ExecutedAt: time.Now(),
		UserID:     userID,
	}
	s.addOperation(op)

	resp := &ExecuteResponse{
		Success: true,
		Message: fmt.Sprintf("AI智能重命名完成，成功 %d 个", successCount),
		Results: opPreviews,
		OpID:    op.ID,
	}
	if len(errors) > 0 {
		resp.Errors = errors
	}

	return resp, nil
}

// executeScrape 执行批量刮削
func (s *AIAssistantService) executeScrape(session *ChatSession, action *SuggestedAction, userID string) (*ExecuteResponse, error) {
	if len(session.Context.SelectedMediaIDs) == 0 {
		return &ExecuteResponse{Success: false, Message: "没有选中的文件"}, nil
	}

	var params struct {
		Source string `json:"source"`
	}
	if action.Params != "" {
		json.Unmarshal([]byte(action.Params), &params)
	}

	started, errors := s.fileManager.BatchScrapeFiles(session.Context.SelectedMediaIDs, params.Source, userID)

	op := AssistantOperation{
		ID:         uuid.New().String(),
		SessionID:  session.ID,
		Action:     "scrape",
		ExecutedAt: time.Now(),
		UserID:     userID,
	}
	s.addOperation(op)

	resp := &ExecuteResponse{
		Success: true,
		Message: fmt.Sprintf("已启动 %d 个文件的刮削任务", started),
		OpID:    op.ID,
	}
	if len(errors) > 0 {
		resp.Errors = errors
	}

	return resp, nil
}

// mergeTags 合并原有分类与新标签：原有分类在前，新标签追加在后，去重。
// 兼容 LLM 不稳定的分隔符（中英文逗号/分号都会出现），按多种分隔符切分。
// 返回合并后的字符串；若与原有分类一致则返回原值（无变化）。
func mergeTags(existing, newTags string) string {
	seen := map[string]bool{}
	var result []string
	for _, t := range strings.FieldsFunc(existing+","+newTags, func(r rune) bool {
		return r == ',' || r == '，' || r == ';' || r == '；'
	}) {
		if t = strings.TrimSpace(t); t == "" || seen[t] {
			continue
		}
		seen[t] = true
		result = append(result, t)
	}
	return strings.Join(result, ",")
}

// executeBatchTag 执行批量标签（合并模式：保留文件原有分类，仅追加新标签并去重，
// 避免 LLM 给出的标签整体覆盖导致原有分类丢失，或 params 缺失时分类被清空）
func (s *AIAssistantService) executeBatchTag(session *ChatSession, action *SuggestedAction, userID string) (*ExecuteResponse, error) {
	if len(session.Context.SelectedMediaIDs) == 0 {
		return &ExecuteResponse{Success: false, Message: "没有选中的文件"}, nil
	}

	var params struct {
		Genres string `json:"genres"`
		Tags   string `json:"tags"`
	}
	if action.Params != "" {
		json.Unmarshal([]byte(action.Params), &params)
	}
	newTags := tagsFromParams(params.Genres, params.Tags)
	if newTags == "" {
		return &ExecuteResponse{Success: false, Message: "AI 未给出要添加的标签，已跳过，原有分类保持不变"}, nil
	}

	successCount := 0
	unchangedCount := 0
	var errors []string
	var opPreviews []OperationPreview // 撤销依据：只记真正写入的变更
	var results []OperationPreview    // 前端回显：包含无需更新的文件

	for _, id := range session.Context.SelectedMediaIDs {
		media, err := s.mediaRepo.FindByID(id)
		if err != nil {
			continue
		}
		merged := mergeTags(media.Genres, newTags)
		change := OperationPreview{
			MediaID:    id,
			Title:      media.Title,
			OldValue:   media.Genres,
			NewValue:   merged,
			ChangeType: "tag",
		}
		if merged == media.Genres {
			// 标签已存在，无需更新（跳过 DB 写入）：只回显，不计入撤销记录
			unchangedCount++
			results = append(results, change)
			continue
		}
		updates := map[string]interface{}{"genres": merged}
		if _, err = s.fileManager.UpdateFileInfo(id, updates, userID); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", media.Title, err))
			continue
		}
		successCount++
		opPreviews = append(opPreviews, change)
		results = append(results, change)
	}

	op := AssistantOperation{
		ID:         uuid.New().String(),
		SessionID:  session.ID,
		Action:     "batch_tag",
		Previews:   opPreviews,
		ExecutedAt: time.Now(),
		UserID:     userID,
	}
	s.addOperation(op)

	message := fmt.Sprintf("批量标签更新完成，成功 %d 个", successCount)
	if unchangedCount > 0 {
		message += fmt.Sprintf("，%d 个已含相同标签无需更新", unchangedCount)
	}

	return &ExecuteResponse{
		Success: true,
		Message: message,
		Results: results,
		Errors:  errors,
		OpID:    op.ID,
	}, nil
}

// executeDetectDuplicates 执行重复文件检测：复用扫描器的重复检测（标题+年份 / TMDb ID 分组，含推荐保留版本），
// 有选中文件时只保留涉及选中文件的重复组。文件库暂无删除类处理能力，故只报告不自动处理。
func (s *AIAssistantService) executeDetectDuplicates(session *ChatSession, action *SuggestedAction, userID string) (*ExecuteResponse, error) {
	groups, err := s.scanner.DetectDuplicates(session.Context.LibraryID)
	if err != nil {
		s.logger.Errorf("检测重复文件失败（library=%s）: %v", session.Context.LibraryID, err)
		return &ExecuteResponse{Success: false, Message: "检测重复文件失败"}, nil
	}

	if sel := session.Context.SelectedMediaIDs; len(sel) > 0 {
		picked := make(map[string]bool, len(sel))
		for _, id := range sel {
			picked[id] = true
		}
		var filtered []DuplicateGroup
		for _, g := range groups {
			for _, item := range g.Media {
				if picked[item.ID] {
					filtered = append(filtered, g)
					break
				}
			}
		}
		groups = filtered
	}

	if len(groups) == 0 {
		return &ExecuteResponse{Success: true, Message: "未检测到重复文件（检测范围：电影）"}, nil
	}

	var report strings.Builder
	fmt.Fprintf(&report, "## 🔎 重复文件检测报告（检测范围：电影）\n\n发现 **%d 组重复**：\n", len(groups))
	for i, g := range groups {
		fmt.Fprintf(&report, "\n### %d. %s（%d 年，共 %d 个文件）\n", i+1, g.Title, g.Year, g.MediaCount)
		for _, m := range g.Media {
			mark := ""
			if m.IsPrimary {
				mark = " ✅ 建议保留"
			}
			fmt.Fprintf(&report, "- %s（%s，%.1f GB）%s\n", m.Title, m.Resolution, float64(m.FileSize)/1024/1024/1024, mark)
		}
		if g.Suggestion != "" {
			fmt.Fprintf(&report, "\n💡 %s\n", g.Suggestion)
		}
	}

	return &ExecuteResponse{Success: true, Message: report.String()}, nil
}

// executeAnalyze 执行文件分析
func (s *AIAssistantService) executeAnalyze(session *ChatSession, userID string) (*ExecuteResponse, error) {
	stats, err := s.fileManager.GetStats("", "")
	if err != nil {
		return &ExecuteResponse{Success: false, Message: "获取统计信息失败"}, nil
	}

	// 构建分析报告
	report := fmt.Sprintf("## 📊 文件库分析报告\n\n"+
		"| 指标 | 数值 |\n|------|------|\n"+
		"| 总文件数 | %d |\n"+
		"| 电影数量 | %d |\n"+
		"| 剧集数量 | %d |\n"+
		"| 已刮削 | %d |\n"+
		"| 未刮削 | %d |\n"+
		"| 总大小 | %.2f GB |\n"+
		"| 近7天导入 | %d |\n",
		stats.TotalFiles, stats.MovieCount, stats.EpisodeCount,
		stats.ScrapedCount, stats.UnscrapedCount,
		float64(stats.TotalSizeBytes)/(1024*1024*1024),
		stats.RecentImports,
	)

	// 添加建议
	var suggestions []string
	if stats.UnscrapedCount > 0 {
		suggestions = append(suggestions, fmt.Sprintf("- 🔍 有 %d 个文件尚未刮削元数据，建议执行批量刮削", stats.UnscrapedCount))
	}
	if stats.TotalFiles > 0 && float64(stats.ScrapedCount)/float64(stats.TotalFiles) < 0.5 {
		suggestions = append(suggestions, "- ⚠️ 刮削覆盖率不足50%，建议优先处理未刮削文件")
	}
	if len(suggestions) > 0 {
		report += "\n### 💡 优化建议\n" + strings.Join(suggestions, "\n")
	}

	return &ExecuteResponse{
		Success: true,
		Message: report,
	}, nil
}

// ==================== 误分类检测与重分类 ====================

// executeAnalyzeMisclassification 执行误分类分析
func (s *AIAssistantService) executeAnalyzeMisclassification(session *ChatSession, userID string) (*ExecuteResponse, error) {
	report, err := s.fileManager.AnalyzeMisclassification()
	if err != nil {
		return &ExecuteResponse{Success: false, Message: fmt.Sprintf("分析失败: %v", err)}, nil
	}

	// 构建分析报告
	var sb strings.Builder
	sb.WriteString("## 🔍 剧集误分类分析报告\n\n")
	sb.WriteString("| 指标 | 数值 |\n|------|------|\n")
	sb.WriteString(fmt.Sprintf("| 当前电影总数 | %d |\n", report.TotalMovies))
	sb.WriteString(fmt.Sprintf("| 疑似剧集数量 | %d |\n", report.SuspectedEpisodes))
	sb.WriteString(fmt.Sprintf("| 🔴 高置信度 (>80%%) | %d |\n", report.HighConfidence))
	sb.WriteString(fmt.Sprintf("| 🟡 中置信度 (50%%-80%%) | %d |\n", report.MediumConfidence))
	sb.WriteString(fmt.Sprintf("| 🟢 低置信度 (<50%%) | %d |\n", report.LowConfidence))

	// 常见模式
	if len(report.CommonPatterns) > 0 {
		sb.WriteString("\n### 📋 常见误分类模式\n")
		for _, p := range report.CommonPatterns {
			sb.WriteString(fmt.Sprintf("- %s\n", p))
		}
	}

	// 详细列表（最多展示15条）
	if len(report.Items) > 0 {
		sb.WriteString("\n### 📄 疑似误分类文件详情\n")
		limit := 15
		if len(report.Items) < limit {
			limit = len(report.Items)
		}
		for i := 0; i < limit; i++ {
			item := report.Items[i]
			sb.WriteString(fmt.Sprintf("\n**%d. %s** (置信度: %.0f%%)\n", i+1, item.Title, item.Confidence*100))
			sb.WriteString(fmt.Sprintf("- 文件: `%s`\n", filepath.Base(item.FilePath)))
			sb.WriteString(fmt.Sprintf("- 目录: `%s`\n", filepath.Base(item.DirPath)))
			sb.WriteString(fmt.Sprintf("- 同目录文件数: %d\n", item.SiblingCount))
			for _, r := range item.Reasons {
				sb.WriteString(fmt.Sprintf("  - ✓ %s\n", r))
			}
		}
		if len(report.Items) > limit {
			sb.WriteString(fmt.Sprintf("\n*（还有 %d 个文件未展示）*\n", len(report.Items)-limit))
		}
	}

	// 建议
	if len(report.Suggestions) > 0 {
		sb.WriteString("\n### 💡 优化建议\n")
		for _, s := range report.Suggestions {
			sb.WriteString(fmt.Sprintf("- %s\n", s))
		}
	}

	// 将报告数据缓存到会话上下文中，供后续重分类使用
	session.Context.LastIntent = &Intent{
		Action:     "analyze_misclassification",
		Targets:    "all",
		Confidence: 1.0,
		Reasoning:  fmt.Sprintf("分析完成，发现 %d 个疑似误分类文件", report.SuspectedEpisodes),
	}

	// 构建预览数据
	var previews []OperationPreview
	previewLimit := 10
	if len(report.Items) < previewLimit {
		previewLimit = len(report.Items)
	}
	for i := 0; i < previewLimit; i++ {
		item := report.Items[i]
		previews = append(previews, OperationPreview{
			MediaID:    item.MediaID,
			Title:      item.Title,
			OldValue:   item.CurrentType,
			NewValue:   item.SuggestedType,
			ChangeType: "reclassify",
		})
	}

	resp := &ExecuteResponse{
		Success: true,
		Message: sb.String(),
		Results: previews,
	}

	return resp, nil
}

// executeReclassify 执行指定文件的重分类
func (s *AIAssistantService) executeReclassify(session *ChatSession, action *SuggestedAction, userID string) (*ExecuteResponse, error) {
	var params struct {
		MediaIDs       []string `json:"media_ids"`
		AutoLinkSeries bool     `json:"auto_link_series"`
	}
	if action.Params != "" {
		json.Unmarshal([]byte(action.Params), &params)
	}

	if len(params.MediaIDs) == 0 {
		return &ExecuteResponse{Success: false, Message: "未指定要重分类的文件"}, nil
	}

	req := ReclassifyRequest{
		MediaIDs:       params.MediaIDs,
		NewType:        "episode",
		AutoLinkSeries: params.AutoLinkSeries,
	}

	result, err := s.fileManager.ReclassifyFiles(req, userID)
	if err != nil {
		return &ExecuteResponse{Success: false, Message: err.Error()}, nil
	}

	// 记录操作
	var opPreviews []OperationPreview
	for _, id := range params.MediaIDs {
		opPreviews = append(opPreviews, OperationPreview{
			MediaID:    id,
			OldValue:   "movie",
			NewValue:   "episode",
			ChangeType: "reclassify",
		})
	}

	op := AssistantOperation{
		ID:         uuid.New().String(),
		SessionID:  session.ID,
		Action:     "reclassify",
		Previews:   opPreviews,
		ExecutedAt: time.Now(),
		UserID:     userID,
	}
	s.addOperation(op)

	msg := fmt.Sprintf("重分类完成！成功 %d 个", result.Success)
	if result.LinkedSeries > 0 {
		msg += fmt.Sprintf("，其中 %d 个已自动关联到剧集合集", result.LinkedSeries)
	}
	if result.Failed > 0 {
		msg += fmt.Sprintf("，失败 %d 个", result.Failed)
	}

	resp := &ExecuteResponse{
		Success: true,
		Message: msg,
		Errors:  result.Errors,
		OpID:    op.ID,
	}

	return resp, nil
}

// executeReclassifyByConfidence 按置信度阈值批量重分类
func (s *AIAssistantService) executeReclassifyByConfidence(session *ChatSession, minConfidence float64, userID string) (*ExecuteResponse, error) {
	// 先执行分析
	report, err := s.fileManager.AnalyzeMisclassification()
	if err != nil {
		return &ExecuteResponse{Success: false, Message: fmt.Sprintf("分析失败: %v", err)}, nil
	}

	// 筛选符合置信度的文件
	var mediaIDs []string
	for _, item := range report.Items {
		if item.Confidence >= minConfidence {
			mediaIDs = append(mediaIDs, item.MediaID)
		}
	}

	if len(mediaIDs) == 0 {
		confLabel := "高"
		if minConfidence < 0.5 {
			confLabel = "任意"
		}
		return &ExecuteResponse{
			Success: true,
			Message: fmt.Sprintf("没有找到%s置信度（≥%.0f%%）的误分类文件", confLabel, minConfidence*100),
		}, nil
	}

	req := ReclassifyRequest{
		MediaIDs:       mediaIDs,
		NewType:        "episode",
		AutoLinkSeries: true,
	}

	result, err := s.fileManager.ReclassifyFiles(req, userID)
	if err != nil {
		return &ExecuteResponse{Success: false, Message: err.Error()}, nil
	}

	// 记录操作
	var opPreviews []OperationPreview
	for _, id := range mediaIDs {
		opPreviews = append(opPreviews, OperationPreview{
			MediaID:    id,
			OldValue:   "movie",
			NewValue:   "episode",
			ChangeType: "reclassify",
		})
	}

	op := AssistantOperation{
		ID:         uuid.New().String(),
		SessionID:  session.ID,
		Action:     "reclassify",
		Previews:   opPreviews,
		ExecutedAt: time.Now(),
		UserID:     userID,
	}
	s.addOperation(op)

	msg := fmt.Sprintf("批量重分类完成！\n- 处理文件: %d 个（置信度≥%.0f%%）\n- 成功: %d 个",
		result.Total, minConfidence*100, result.Success)
	if result.LinkedSeries > 0 {
		msg += fmt.Sprintf("\n- 自动关联剧集合集: %d 个", result.LinkedSeries)
	}
	if result.Failed > 0 {
		msg += fmt.Sprintf("\n- 失败: %d 个", result.Failed)
	}
	msg += "\n\n💡 建议对重分类的文件重新执行刮削，以获取正确的剧集元数据。"

	resp := &ExecuteResponse{
		Success: true,
		Message: msg,
		Results: opPreviews,
		Errors:  result.Errors,
		OpID:    op.ID,
	}

	return resp, nil
}

// ==================== 撤销操作 ====================

// UndoOperation 撤销操作
func (s *AIAssistantService) UndoOperation(opID, userID string) (*ExecuteResponse, error) {
	s.opHistoryMu.Lock()
	defer s.opHistoryMu.Unlock()

	var targetOp *AssistantOperation
	for i := range s.opHistory {
		if s.opHistory[i].ID == opID && !s.opHistory[i].Undone && s.opHistory[i].UserID == userID {
			targetOp = &s.opHistory[i]
			break
		}
	}

	if targetOp == nil {
		return nil, fmt.Errorf("操作不存在或已撤销")
	}

	// 根据操作类型执行撤销
	successCount := 0
	var errors []string

	for _, preview := range targetOp.Previews {
		switch preview.ChangeType {
		case "rename":
			updates := map[string]interface{}{"title": preview.OldValue}
			_, err := s.fileManager.UpdateFileInfo(preview.MediaID, updates, userID)
			if err != nil {
				errors = append(errors, err.Error())
			} else {
				successCount++
			}
		case "tag":
			updates := map[string]interface{}{"genres": preview.OldValue}
			_, err := s.fileManager.UpdateFileInfo(preview.MediaID, updates, userID)
			if err != nil {
				errors = append(errors, err.Error())
			} else {
				successCount++
			}
		case "reclassify":
			updates := map[string]interface{}{"media_type": preview.OldValue}
			_, err := s.fileManager.UpdateFileInfo(preview.MediaID, updates, userID)
			if err != nil {
				errors = append(errors, err.Error())
			} else {
				successCount++
			}
		}
	}

	targetOp.Undone = true

	resp := &ExecuteResponse{
		Success: true,
		Message: fmt.Sprintf("撤销完成，恢复了 %d 个文件", successCount),
	}
	if len(errors) > 0 {
		resp.Errors = errors
	}

	return resp, nil
}

// addOperation 添加操作记录
func (s *AIAssistantService) addOperation(op AssistantOperation) {
	s.opHistoryMu.Lock()
	defer s.opHistoryMu.Unlock()

	s.opHistory = append([]AssistantOperation{op}, s.opHistory...)
	// 保留最近100条
	if len(s.opHistory) > 100 {
		s.opHistory = s.opHistory[:100]
	}
}

// GetOperationHistory 获取操作历史
func (s *AIAssistantService) GetOperationHistory(userID string, limit int) []AssistantOperation {
	s.opHistoryMu.Lock()
	defer s.opHistoryMu.Unlock()

	var result []AssistantOperation
	for _, op := range s.opHistory {
		if op.UserID == userID {
			result = append(result, op)
			if len(result) >= limit {
				break
			}
		}
	}
	return result
}

// GetSession 获取会话信息
func (s *AIAssistantService) GetSession(sessionID string) (*ChatSession, error) {
	s.sessionsMu.RLock()
	defer s.sessionsMu.RUnlock()

	session, ok := s.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("会话不存在")
	}
	return session, nil
}

// DeleteSession 删除会话
func (s *AIAssistantService) DeleteSession(sessionID string) {
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()
	delete(s.sessions, sessionID)
}

// AnalyzeMisclassification 分析误分类（代理到FileManagerService）
func (s *AIAssistantService) AnalyzeMisclassification() (*MisclassificationReport, error) {
	return s.fileManager.AnalyzeMisclassification()
}

// ReclassifyFiles 批量重分类（代理到FileManagerService）
func (s *AIAssistantService) ReclassifyFiles(req ReclassifyRequest, userID string) (*ReclassifyResult, error) {
	return s.fileManager.ReclassifyFiles(req, userID)
}
