package service

import (
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
