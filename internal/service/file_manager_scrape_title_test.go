package service

import (
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

// 验证文件列表刮削前的脏标题清洗（ensureCleanSearchTitle）。
func TestEnsureCleanSearchTitle(t *testing.T) {
	s := &FileManagerService{} // ai == nil：跳过 AI 清洗分支，专注验证规则路径

	t.Run("可信标题原样返回", func(t *testing.T) {
		media := &model.Media{Title: "肖申克的救赎", FilePath: "/data/肖申克的救赎 (1994).mkv"}
		if got := s.ensureCleanSearchTitle(media, media.Title); got != "肖申克的救赎" {
			t.Fatalf("期望原样返回，实际: %q", got)
		}
	})

	t.Run("已刮削状态原样返回", func(t *testing.T) {
		media := &model.Media{Title: "肖申克的救赎", ScrapeStatus: "scraped"}
		if got := s.ensureCleanSearchTitle(media, media.Title); got != "肖申克的救赎" {
			t.Fatalf("期望原样返回，实际: %q", got)
		}
	})

	t.Run("规则解析可剥脏内容时采用解析结果", func(t *testing.T) {
		media := &model.Media{
			Title:    "采花和尚 Satyr Monks 1994 480P", // 含噪声 token 480p → 不可信
			FilePath: "[yyh3d.com]采花和尚.Satyr Monks.1994.LD_D9.x264.AAC.480P.YYH3D.xt.mkv",
		}
		got := s.ensureCleanSearchTitle(media, media.Title)
		if got == media.Title {
			t.Fatalf("期望规则解析剥掉站点标签/噪声，实际原样返回: %q", got)
		}
		if got != "采花和尚" {
			t.Fatalf("期望解析出干净标题，实际: %q", got)
		}
	})

	t.Run("规则解析清不掉且无AI时原样返回保持旧行为", func(t *testing.T) {
		dirty := "素材--经典肖申克的救赎: 重获新生 哔哩哔哩"
		media := &model.Media{Title: dirty, FilePath: "/data/素材--经典肖申克的救赎: 重获新生 哔哩哔哩.mkv"}
		if got := s.ensureCleanSearchTitle(media, dirty); got != dirty {
			t.Fatalf("期望原样返回（无 AI 兜底），实际: %q", got)
		}
	})

	t.Run("空标题原样返回", func(t *testing.T) {
		media := &model.Media{FilePath: "/data/x.mkv"}
		if got := s.ensureCleanSearchTitle(media, ""); got != "" {
			t.Fatalf("期望空串，实际: %q", got)
		}
	})
}
