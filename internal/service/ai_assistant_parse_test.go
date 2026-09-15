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

// 用户实际遇到的响应：忽略 response_format 的本地模型输出 Python 风格单引号伪 JSON，
// 且 message 内容包含未转义的双引号、含 None 字面量与尾逗号
const singleQuotedTestResponse = `{'message': '🎬 关于"同一部剧但年份不同"的处理建议：\n\n1. **重制版**：原片年份是 2016 年。\n2. 年份标注错误。', 'intent': {'action': 'suggest', 'targets': 'selected', 'params': {'years': '2016,2018'}, 'confidence': None, 'reasoning': '两个文件年份不同，可能是同一部剧的不同版本'}, 'actions': [], }`

func TestParseAIResponseRepairsSingleQuotedJSON(t *testing.T) {
	s := &AIAssistantService{}
	msg, intent := s.parseAIResponse(singleQuotedTestResponse, &ChatSession{})

	if !strings.HasPrefix(msg.Content, "🎬 关于") {
		t.Fatalf("content 应为修复解析后的 markdown，实际: %.60s", msg.Content)
	}
	if strings.Contains(msg.Content, "'intent'") {
		t.Fatalf("content 不应再包含原始伪 JSON，实际: %.120s", msg.Content)
	}
	if !strings.Contains(msg.Content, `关于"同一部剧但年份不同"的处理建议`) {
		t.Fatalf("串内双引号应原样保留在内容中，实际: %.80s", msg.Content)
	}
	if intent == nil {
		t.Fatal("intent 不应为 nil")
	}
	if intent.Action != "suggest" {
		t.Fatalf("action 应为 suggest，实际: %q", intent.Action)
	}
	if intent.Params["years"] != "2016,2018" {
		t.Fatalf("years 参数应为 2016,2018，实际: %v", intent.Params)
	}
	if intent.Confidence != 0 {
		t.Fatalf("None 字面量应解析为零值 Confidence，实际: %v", intent.Confidence)
	}
}

func TestRepairJSON(t *testing.T) {
	cases := []struct {
		name string
		src  string
		want string
	}{
		{"单引号字符串转双引号", `{'a': 'b'}`, `{"a": "b"}`},
		{"串内双引号转义", `{'a': '说"引号"了'}`, `{"a": "说\"引号\"了"}`},
		{"串内转义的单引号还原", `{'a': 'It\'s ok'}`, `{"a": "It's ok"}`},
		{"串内转义序列原样保留", `{'a': 'line\nbreak'}`, `{"a": "line\nbreak"}`},
		{"None/True/False 转换", `{"a": None, "b": True, "c": False}`, `{"a": null, "b": true, "c": false}`},
		{"尾逗号去除", `{"a": [1, 2, ], "b": "x", }`, `{"a": [1, 2], "b": "x"}`},
		{"双引号串内的单引号不受影响", `{"a": "don't stop"}`, `{"a": "don't stop"}`},
		{"合法 JSON 原样返回", `{"a": "b", "n": 0.95}`, `{"a": "b", "n": 0.95}`},
	}
	for _, c := range cases {
		if got := repairJSON(c.src); got != c.want {
			t.Errorf("%s: repairJSON(%q) = %q, want %q", c.name, c.src, got, c.want)
		}
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
