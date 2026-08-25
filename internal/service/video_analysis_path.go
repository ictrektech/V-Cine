package service

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/nowen-video/nowen-video/internal/config"
)

// VideoPathMapper maps paths recorded by Nowen to paths visible to both
// external video-analysis services. Rules use the longest source prefix first.
type VideoPathMapper struct {
	mappings []config.VideoAnalysisPathMapping
}

func NewVideoPathMapper(mappings []config.VideoAnalysisPathMapping) (*VideoPathMapper, error) {
	validated := make([]config.VideoAnalysisPathMapping, 0, len(mappings))
	for i, mapping := range mappings {
		source := filepath.Clean(strings.TrimSpace(mapping.Source))
		target := filepath.Clean(strings.TrimSpace(mapping.Target))
		if mapping.Source == "" || mapping.Target == "" || !filepath.IsAbs(source) || !filepath.IsAbs(target) {
			return nil, fmt.Errorf("video analysis path mapping %d must contain absolute source and target paths", i)
		}
		validated = append(validated, config.VideoAnalysisPathMapping{Source: source, Target: target})
	}

	sort.SliceStable(validated, func(i, j int) bool {
		return len(validated[i].Source) > len(validated[j].Source)
	})
	return &VideoPathMapper{mappings: validated}, nil
}

func (m *VideoPathMapper) Map(videoPath string) (string, error) {
	if m == nil {
		return "", fmt.Errorf("video analysis path mapper is not configured")
	}
	cleanPath := filepath.Clean(strings.TrimSpace(videoPath))
	if videoPath == "" || !filepath.IsAbs(cleanPath) {
		return "", fmt.Errorf("video path must be absolute")
	}

	// 无映射规则时按原路径透传：Nowen 与外部分析服务看到相同路径，
	// 这是最常见部署，path_mappings 可省略。
	if len(m.mappings) == 0 {
		return cleanPath, nil
	}

	for _, mapping := range m.mappings {
		rel, err := filepath.Rel(mapping.Source, cleanPath)
		if err != nil || escapesRoot(rel) {
			continue
		}
		mapped := filepath.Join(mapping.Target, rel)
		mappedRel, err := filepath.Rel(mapping.Target, mapped)
		if err != nil || escapesRoot(mappedRel) {
			return "", fmt.Errorf("mapped video path escapes target root")
		}
		return mapped, nil
	}
	return "", fmt.Errorf("no video analysis path mapping matches %q", cleanPath)
}

func escapesRoot(rel string) bool {
	return rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel)
}
