package service

import (
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

// 验证 AI 全量刮削的官方标题应用守卫：
// 脏标题（含 -- 中缀或噪声 token）→ 改写为 AI 官方标题；可信标题 / 有外部 ID → 保持不动。
func TestApplyAIMetadataTitleGuard(t *testing.T) {
	s := &AIService{} // applyAIMetadata 不使用 logger，零值安全

	t.Run("脏标题含中缀脏分隔时改写", func(t *testing.T) {
		m := &model.Media{Title: "素材--经典肖申克的救赎：重获新生 哔哩哔哩"}
		s.applyAIMetadata(m, &AIMetadataResult{Title: "肖申克的救赎"})
		if m.Title != "肖申克的救赎" {
			t.Fatalf("期望改写为官方标题，实际: %q", m.Title)
		}
	})

	t.Run("含噪声token的脏标题改写", func(t *testing.T) {
		m := &model.Media{Title: "采花和尚 Satyr Monks 1994 480P"}
		s.applyAIMetadata(m, &AIMetadataResult{Title: "采花和尚"})
		if m.Title != "采花和尚" {
			t.Fatalf("期望改写为官方标题，实际: %q", m.Title)
		}
	})

	t.Run("可信干净标题保持不动", func(t *testing.T) {
		m := &model.Media{Title: "从你的全世界路过"}
		s.applyAIMetadata(m, &AIMetadataResult{Title: "AI改写标题"})
		if m.Title != "从你的全世界路过" {
			t.Fatalf("可信标题不应被改写，实际: %q", m.Title)
		}
	})

	t.Run("有外部ID的标题保持不动", func(t *testing.T) {
		m := &model.Media{Title: "采花和尚 480P", TMDbID: 12345} // 噪声 token 但有 ID → 可信优先
		s.applyAIMetadata(m, &AIMetadataResult{Title: "AI改写标题"})
		if m.Title != "采花和尚 480P" {
			t.Fatalf("有外部 ID 的标题不应被改写，实际: %q", m.Title)
		}
	})

	t.Run("AI未给标题时不动", func(t *testing.T) {
		m := &model.Media{Title: "素材--脏标题"}
		s.applyAIMetadata(m, &AIMetadataResult{})
		if m.Title != "素材--脏标题" {
			t.Fatalf("AI 未输出标题时不应改动，实际: %q", m.Title)
		}
	})
}
