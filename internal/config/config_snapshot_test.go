package config

import "testing"

// TestSTRMSnapshotDeepCopy 验证 STRMSnapshot 对 map 字段做深拷贝，
// 修改原 map 不影响已取出的快照。
func TestSTRMSnapshotDeepCopy(t *testing.T) {
	c := &Config{STRM: STRMConfig{
		ConnectTimeout:   30,
		DomainUserAgents: map[string]string{"115.com": "UA-1"},
		DomainReferers:   map[string]string{"115.com": "https://ref"},
	}}

	snap := c.STRMSnapshot()

	// 修改原 map，快照不应被影响
	c.STRM.DomainUserAgents["115.com"] = "UA-2"
	c.STRM.DomainReferers["new.com"] = "https://new"

	if snap.DomainUserAgents["115.com"] != "UA-1" {
		t.Fatalf("STRMSnapshot 未深拷贝 DomainUserAgents: got %q, want UA-1", snap.DomainUserAgents["115.com"])
	}
	if snap.DomainReferers["115.com"] != "https://ref" {
		t.Fatalf("STRMSnapshot 未深拷贝 DomainReferers: got %q", snap.DomainReferers["115.com"])
	}
	if _, ok := snap.DomainReferers["new.com"]; ok {
		t.Fatal("STRMSnapshot 与原 map 共享底层: new.com 不应出现在快照中")
	}
}

// TestAdultScraperSnapshotDeepCopy 验证 AdultScraperSnapshot 对
// FieldPriority map 做深拷贝，修改原 map 不影响已取出的快照。
func TestAdultScraperSnapshotDeepCopy(t *testing.T) {
	c := &Config{AdultScraper: AdultScraperConfig{
		Enabled:       true,
		FieldPriority: map[string][]string{"poster": {"javbus", "javdb"}},
	}}

	snap := c.AdultScraperSnapshot()

	// 修改原 map，快照不应被影响
	c.AdultScraper.FieldPriority["poster"] = []string{"fanart"}

	if got := snap.FieldPriority["poster"]; len(got) != 2 || got[0] != "javbus" {
		t.Fatalf("AdultScraperSnapshot 未深拷贝 FieldPriority: got %v", got)
	}
}

// TestSecretsSnapshotCopy 验证 SecretsSnapshot 返回值拷贝，
// 修改原字段不影响已取出的快照。
func TestSecretsSnapshotCopy(t *testing.T) {
	c := &Config{Secrets: SecretsConfig{TMDbAPIKey: "key-1"}}

	snap := c.SecretsSnapshot()
	c.Secrets.TMDbAPIKey = "key-2"

	if snap.TMDbAPIKey != "key-1" {
		t.Fatalf("SecretsSnapshot 未返回值拷贝: got %q, want key-1", snap.TMDbAPIKey)
	}
}
