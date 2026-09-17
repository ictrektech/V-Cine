package service

import (
	"encoding/json"
	"strings"
	"testing"
)

// 用户实际遇到的响应：Intent.Params 为布尔值、SuggestedAction.Params 混用字符串与对象
const tolerantTestResponse = `{
  "message": "已检测到选中文件存在多处命名不规范和信息缺失问题。\n\n**主要发现：**\n1. **命名不规范**：部分文件标题包含多余字符。",
  "intent": {
    "action": "analyze",
    "sub_action": "check_naming_and_metadata",
    "targets": "selected",
    "params": {
      "check_naming": true,
      "check_metadata": true,
      "check_duplicates": true
    },
    "confidence": 0.98,
    "reasoning": "用户指令明确要求检查命名不规范和信息缺失问题。"
  },
  "actions": [
    {
      "id": "fix_naming",
      "label": "智能纠错并补全信息",
      "description": "自动去除文件名中的冗余字符。",
      "action": "fix",
      "params": "{\"mode\": \"auto_correction\", \"sources\": [\"tmdb\", \"bangumi\"]}",
      "dangerous": false
    },
    {
      "id": "check_duplicates",
      "label": "检测重复文件",
      "description": "识别同名但年份不同的文件。",
      "action": "analyze",
      "params": {
        "duplicate_mode": "by_name_and_year"
      },
      "dangerous": false
    }
  ],
  "previews": []
}`

func TestParseAIResponseToleratesObjectParams(t *testing.T) {
	s := &AIAssistantService{}
	// 传零值 session 而非 nil：parseAIResponse 在 rename 意图下会解引用 session，
	// 避免测试依赖 fixture 的 action 恰好非 rename 的短路行为
	msg, intent := s.parseAIResponse(tolerantTestResponse, &ChatSession{})

	if !strings.HasPrefix(msg.Content, "已检测到选中文件存在多处命名不规范和信息缺失问题。") {
		t.Fatalf("content 应为解析后的 markdown，实际: %.80s", msg.Content)
	}
	if strings.Contains(msg.Content, "\"intent\"") {
		t.Fatalf("content 不应再包含原始 JSON，实际: %.120s", msg.Content)
	}
	if intent == nil {
		t.Fatal("intent 不应为 nil")
	}
	if intent.Params["check_naming"] != "true" {
		t.Fatalf("布尔参数应转为字符串，实际: %v", intent.Params)
	}
	if len(msg.Actions) != 2 {
		t.Fatalf("应有 2 个 actions，实际: %d", len(msg.Actions))
	}
	if !strings.Contains(msg.Actions[0].Params, "auto_correction") {
		t.Fatalf("字符串 params 应原样保留，实际: %.40s", msg.Actions[0].Params)
	}
	if !strings.HasPrefix(msg.Actions[1].Params, "{") || !strings.Contains(msg.Actions[1].Params, "duplicate_mode") {
		t.Fatalf("对象 params 应保留为 JSON 文本，实际: %.40s", msg.Actions[1].Params)
	}
}

// TestMergeTags 验证批量标签的合并行为：保留原有分类、追加去重、空输入不清空
func TestMergeTags(t *testing.T) {
	cases := []struct {
		name     string
		existing string
		newTags  string
		want     string
	}{
		{"保留原有分类并追加新标签", "动作,科幻", "剧情", "动作,科幻,剧情"},
		{"新标签去重", "动作,科幻", "科幻,冒险", "动作,科幻,冒险"},
		{"原有分类为空时直接使用新标签", "", "剧情", "剧情"},
		{"新标签为空时保持原有分类", "动作,科幻", "", "动作,科幻"},
		{"两者都为空", "", "", ""},
		{"容忍空格与空片段", "动作, , 科幻", " 科幻 , 冒险 ", "动作,科幻,冒险"},
		{"已有相同标签时无变化", "动作,科幻", "动作,科幻", "动作,科幻"},
		{"兼容分号分隔符", "动作,科幻", "科幻；冒险", "动作,科幻,冒险"},
	}
	for _, c := range cases {
		if got := mergeTags(c.existing, c.newTags); got != c.want {
			t.Errorf("%s: mergeTags(%q, %q) = %q, want %q", c.name, c.existing, c.newTags, got, c.want)
		}
	}
}

// 模型可能输出非标准 params 键（如 remove_fields/add_fields），
// 后端 executeBatchTag 只认 {"genres":"..."}；previews 里给出了逐文件建议
const batchTagDriftResponse = `{
  "message": "当前已选中 2 个文件，以下是分类优化的建议。",
  "intent": {
    "action": "batch_tag",
    "sub_action": "update_categories",
    "params": {"file_ids": ["id-1", "id-2"]},
    "confidence": 0.9
  },
  "actions": [
    {
      "id": "tag_update_001",
      "label": "批量更新标签",
      "description": "为选中文件移除冗余标签",
      "action": "batch_tag",
      "params": "{\"remove_fields\":[\"rating\",\"director\"],\"add_fields\":{\"from_file_1\":[\"爱情\",\"剧情\"]}}",
      "dangerous": false
    },
    {
      "id": "tag_update_002",
      "label": "补充评分",
      "description": "批量刮取真实评分数据",
      "action": "scrape",
      "params": "{\"source\":\"files\"}",
      "dangerous": false
    }
  ],
  "previews": [
    {"media_id": "id-1", "title": "从你的全世界路过 (2016)", "old_value": "爱情,剧情,rating", "new_value": "爱情,剧情,动作", "change_type": "标签移除+替换"},
    {"media_id": "id-2", "title": "肖申克的救赎 (1994)", "old_value": "剧情,犯罪,悬疑,rating", "new_value": "剧情,犯罪,悬疑", "change_type": "标签移除+替换"}
  ]
}`

func TestParseAIResponseNormalizesBatchTagParams(t *testing.T) {
	s := &AIAssistantService{}
	msg, intent := s.parseAIResponse(batchTagDriftResponse, &ChatSession{})

	if intent == nil || intent.Action != "batch_tag" {
		t.Fatal("intent.Action 应为 batch_tag")
	}

	var batchTagActions []SuggestedAction
	for _, a := range msg.Actions {
		if a.Action == "batch_tag" {
			batchTagActions = append(batchTagActions, a)
		}
	}
	if len(batchTagActions) != 1 {
		t.Fatalf("应有 1 个 batch_tag 操作项，实际 %d 个", len(batchTagActions))
	}

	// params 缺 genres/tags 时应从 previews 的 new_value 合并重写（去重、保序）
	want := `{"genres":"爱情,剧情,动作,犯罪,悬疑"}`
	if batchTagActions[0].Params != want {
		t.Errorf("params 应规范化为 %s，实际: %s", want, batchTagActions[0].Params)
	}

	// 非 batch_tag 的操作项 params 不应被改写
	for _, a := range msg.Actions {
		if a.Action == "scrape" && a.Params != `{"source":"files"}` {
			t.Errorf("scrape 操作项 params 不应被改写，实际: %s", a.Params)
		}
	}
}

// TestAssistantResponseSchemaCoversExecuteActions 双向守护 schema 的 intent.action
// enum 与 ExecuteAction switch 的同步：任一侧漂移（漏 case 或拼写错误）即失败。
func TestAssistantResponseSchemaCoversExecuteActions(t *testing.T) {
	// ExecuteAction switch 支持的操作类型（新增 case 时更新此表与 schema enum）
	handled := map[string]bool{
		"batch_tag": true, "tag": true, "detect_duplicates": true, "analyze": true,
		"analyze_misclassification": true, "reclassify": true, "reclassify_high_confidence": true,
		"reclassify_all": true, "rename_template": true, "rename_ai": true, "scrape": true,
	}

	var parsed struct {
		Schema struct {
			Properties struct {
				Intent struct {
					Properties struct {
						Action struct {
							Enum []string `json:"enum"`
						} `json:"action"`
					} `json:"properties"`
				} `json:"intent"`
			} `json:"properties"`
		} `json:"schema"`
	}
	if err := json.Unmarshal([]byte(assistantResponseSchema), &parsed); err != nil {
		t.Fatalf("assistantResponseSchema 应为合法 JSON: %v", err)
	}
	enum := parsed.Schema.Properties.Intent.Properties.Action.Enum
	if len(enum) == 0 {
		t.Fatal("schema 的 intent.action 应有非空 enum")
	}

	for _, a := range enum {
		if a == "none" { // none 表示无操作，不经 ExecuteAction
			continue
		}
		if !handled[a] {
			t.Errorf("schema enum 中的 %q 未被 ExecuteAction 支持（拼写漂移或缺少 case）", a)
		}
	}
	for a := range handled {
		found := false
		for _, e := range enum {
			if e == a {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("ExecuteAction 支持的 %q 不在 schema enum 中，意图解析将永远无法触发该操作", a)
		}
	}
}

// 模型输出 schema 之外的 JSON（解析成功但内容全空）：应回退为友好提示，
// 避免前端空气泡与垃圾内容进入会话历史
const emptyResultResponse = `{"name":"Qwen 3.5","version":"3.5","description":"An AI assistant.","identity":"I am a model."}`

func TestParseAIResponseEmptyResultFallsBack(t *testing.T) {
	s := &AIAssistantService{logger: testLogger()}
	msg, intent := s.parseAIResponse(emptyResultResponse, &ChatSession{})

	if intent != nil {
		t.Fatal("intent 应为 nil")
	}
	if !strings.Contains(msg.Content, "无法解析") {
		t.Errorf("content 应为友好提示，实际: %.80s", msg.Content)
	}
}
