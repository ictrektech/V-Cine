package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
)

func TestParseVOSImportPath(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		ok        bool
		kind      string
		volume    string
		publicDir string
		user      string
		rel       string
	}{
		{
			name: "share 公共目录根", in: "/share/01ABC/public/movies",
			ok: true, kind: ImportKindPublic, volume: "01ABC", publicDir: "movies", rel: "/",
		},
		{
			name: "share 公共目录子目录", in: "/share/01ABC/public/movies/2024/动作",
			ok: true, kind: ImportKindPublic, volume: "01ABC", publicDir: "movies", rel: "/2024/动作",
		},
		{
			name: "share 公共目录尾斜杠", in: "/share/01ABC/public/movies/",
			ok: true, kind: ImportKindPublic, volume: "01ABC", publicDir: "movies", rel: "/",
		},
		{
			name: "share 用户数据根", in: "/share/01ABC/users/admin/data",
			ok: true, kind: ImportKindUserData, volume: "01ABC", user: "admin", rel: "/",
		},
		{
			name: "share 用户数据子目录", in: "/share/01ABC/users/admin/data/public/x",
			ok: true, kind: ImportKindUserData, volume: "01ABC", user: "admin", rel: "/public/x",
		},
		{
			name: "exposed 公共目录", in: "/exposed/01ABC/public/movies",
			ok: true, kind: ImportKindPublic, volume: "01ABC", publicDir: "movies", rel: "/",
		},
		{
			name: "exposed 用户数据", in: "/exposed/01ABC/users/admin/data",
			ok: true, kind: ImportKindUserData, volume: "01ABC", user: "admin", rel: "/",
		},
		{name: "空串", in: "", ok: false},
		{name: "容器内路径 /media", in: "/media/Movies", ok: false},
		{name: "自定义宿主路径", in: "/mnt/lvm/movies", ok: false},
		{name: "缺少公共目录名", in: "/share/01ABC/public", ok: false},
		{name: "公共目录名为空", in: "/share/01ABC/public//x", ok: false},
		{name: "用户数据缺 data 段", in: "/share/01ABC/users/admin", ok: false},
		{name: "用户数据层级错位", in: "/share/01ABC/users/admin/movies", ok: false},
		{name: "卷内 apps 目录", in: "/share/01ABC/apps/com.ictrek.v-cine/exposed", ok: false},
		{name: "未知根", in: "/tmp/01ABC/public/movies", ok: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseVOSImportPath(tc.in)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v (in=%q)", ok, tc.ok, tc.in)
			}
			if !ok {
				return
			}
			if got.Kind != tc.kind {
				t.Errorf("Kind = %q, want %q", got.Kind, tc.kind)
			}
			if got.VolumeUUID != tc.volume {
				t.Errorf("VolumeUUID = %q, want %q", got.VolumeUUID, tc.volume)
			}
			if got.PublicDirName != tc.publicDir {
				t.Errorf("PublicDirName = %q, want %q", got.PublicDirName, tc.publicDir)
			}
			if got.User != tc.user {
				t.Errorf("User = %q, want %q", got.User, tc.user)
			}
			if got.Rel != tc.rel {
				t.Errorf("Rel = %q, want %q", got.Rel, tc.rel)
			}
		})
	}
}

// newExposedTree 造一个 /exposed 风格的临时目录树：<root>/<vol>/public/<name>
func newExposedTree(t *testing.T, dirs ...string) string {
	t.Helper()
	root := t.TempDir()
	for _, d := range dirs {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", d, err)
		}
	}
	return root
}

func newLib(id, name string, paths ...string) model.Library {
	lib := model.Library{ID: id, Name: name}
	lib.SetAllPaths(paths)
	return lib
}

const mediaHost = "/share/01VOL/public/media_video"

func TestBuildImportLocationsZeroLibrary(t *testing.T) {
	exposed := newExposedTree(t, "01VOL/public/docs")

	locs := BuildImportLocations(nil, mediaHost, exposed)
	if len(locs) != 2 {
		t.Fatalf("locations = %d, want 2: %+v", len(locs), locs)
	}

	media := locs[0]
	if media.LocalPath != "/media" || media.Path != "/" || media.PublicDirName != "media_video" {
		t.Errorf("media location = %+v", media)
	}
	if media.LibraryID != "" {
		t.Errorf("零库时 media 落点不应带 library_id")
	}
	if !media.Uploadable {
		t.Errorf("零库时 media 落点应可上传（上传后自动建库）")
	}

	docs := locs[1]
	if docs.LocalPath != filepath.Join(exposed, "01VOL/public/docs") || docs.PublicDirName != "docs" {
		t.Errorf("docs location = %+v", docs)
	}
	if docs.LibraryID != "" || !docs.Uploadable {
		t.Errorf("公共目录落点期望可上传且无 library_id, got %+v", docs)
	}
}

func TestBuildImportLocationsWithLibraryAtMedia(t *testing.T) {
	exposed := newExposedTree(t, "01VOL/public/docs")
	libs := []model.Library{newLib("lib1", "主库", "/media")}

	locs := BuildImportLocations(libs, mediaHost, exposed)
	if len(locs) != 2 {
		t.Fatalf("locations = %d, want 2: %+v", len(locs), locs)
	}
	if locs[0].LibraryID != "lib1" || locs[0].LibraryName != "主库" || locs[0].LocalPath != "/media" {
		t.Errorf("库落点 = %+v", locs[0])
	}
	// /media 已被库覆盖，不应再出现"自动建库"的 media 落点
	for _, loc := range locs {
		if loc.LocalPath == "/media" && loc.LibraryID == "" {
			t.Errorf("已被库覆盖的 /media 不应重复出现")
		}
	}
}

func TestBuildImportLocationsLibraryInSubdir(t *testing.T) {
	exposed := newExposedTree(t, "01VOL/public/docs")
	libs := []model.Library{newLib("lib2", "电影", "/media/Movies")}

	locs := BuildImportLocations(libs, mediaHost, exposed)
	if len(locs) != 2 {
		t.Fatalf("locations = %d, want 2: %+v", len(locs), locs)
	}
	if locs[0].LocalPath != "/media/Movies" || locs[0].Path != "/Movies" || locs[0].LibraryID != "lib2" {
		t.Errorf("子目录库落点 = %+v", locs[0])
	}
	// /media 与 /media/Movies 有前缀关系 → 不能作为"自动建库"落点（否则建出重叠库）
	for _, loc := range locs {
		if loc.LocalPath == "/media" {
			t.Errorf("与已有库重叠的 /media 不应出现")
		}
	}
}

func TestBuildImportLocationsCustomLibraryPath(t *testing.T) {
	exposed := newExposedTree(t)
	libs := []model.Library{newLib("lib3", "自定义", "/mnt/lvm/movies")}

	locs := BuildImportLocations(libs, mediaHost, exposed)
	if len(locs) != 1 {
		t.Fatalf("locations = %d, want 1: %+v", len(locs), locs)
	}
	if locs[0].LocalPath != "/media" || !locs[0].Uploadable {
		t.Errorf("自定义路径库不应产生落点，/media 仍应可用: %+v", locs[0])
	}
}

func TestBuildImportLocationsWithoutMediaHost(t *testing.T) {
	exposed := newExposedTree(t, "01VOL/public/docs")

	locs := BuildImportLocations(nil, "", exposed)
	// 未注入 VCINE_MEDIA_PATH：/media 无法映射 → 不提供该落点，只留公共目录
	if len(locs) != 1 {
		t.Fatalf("locations = %d, want 1: %+v", len(locs), locs)
	}
	if locs[0].LocalPath == "/media" {
		t.Errorf("未注入 VCINE_MEDIA_PATH 时不应出现 /media 落点: %+v", locs[0])
	}
	if !locs[0].Uploadable {
		t.Errorf("公共目录落点不受 VCINE_MEDIA_PATH 影响")
	}
}

func TestBuildImportLocationsAliasSameDirectory(t *testing.T) {
	// 用软链模拟 bind mount 别名：/media 与 /exposed/<卷>/public/<目录> 指向同一物理目录
	exposed := newExposedTree(t)
	real := filepath.Join(exposed, "01VOL/public/media_video")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	mediaLink := filepath.Join(exposed, "media-alias")
	if err := os.Symlink(real, mediaLink); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	lib := newLib("lib1", "主库", mediaLink)
	locs := BuildImportLocations([]model.Library{lib}, real, exposed)

	// 库根 media-alias 与公共目录 media_video 是同一目录 → 只应出现库落点
	for _, loc := range locs {
		if loc.LibraryID == "" {
			t.Errorf("同一物理目录的别名不应作为独立落点出现: %+v", loc)
		}
	}
}

func TestBuildImportLocationsUserData(t *testing.T) {
	// 只投影"已授权"的目录：xjx 有 data 子目录；someone 只有 users 目录没有 data
	exposed := newExposedTree(t, "01VOL/public/docs", "01VOL/users/xjx/data", "01VOL/users/someone")

	locs := BuildImportLocations(nil, mediaHost, exposed)

	var userLocs []ImportLocation
	for _, loc := range locs {
		if loc.Kind == ImportKindUserData {
			userLocs = append(userLocs, loc)
		}
	}
	if len(userLocs) != 1 {
		t.Fatalf("user_data 落点数 = %d, want 1: %+v", len(userLocs), userLocs)
	}
	got := userLocs[0]
	if got.Name != "xjx" || got.Adapter != "v_01VOL" || got.Path != "/" || !got.Uploadable {
		t.Errorf("user_data 落点 = %+v", got)
	}
	if got.LocalPath != filepath.Join(exposed, "01VOL/users/xjx/data") {
		t.Errorf("LocalPath = %q", got.LocalPath)
	}
	// 公共目录 + 主媒体库 + 用户数据
	if len(locs) != 3 {
		t.Errorf("落点总数 = %d, want 3: %+v", len(locs), locs)
	}
}

func TestBuildImportLocationsVolumeNick(t *testing.T) {
	exposed := newExposedTree(t, "01VOL/public/docs")
	if err := os.MkdirAll(filepath.Join(exposed, "volumes"), 0o755); err != nil {
		t.Fatalf("mkdir volumes: %v", err)
	}
	// 平台维护的语义软链：/exposed/volumes/<昵称> -> ../<卷uuid>
	if err := os.Symlink("../01VOL", filepath.Join(exposed, "volumes", "vos_workspace")); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	locs := BuildImportLocations(nil, mediaHost, exposed)
	if len(locs) != 2 {
		t.Fatalf("locations = %d, want 2: %+v", len(locs), locs)
	}
	for _, loc := range locs {
		if loc.VolumeName != "vos_workspace" {
			t.Errorf("%s: VolumeName = %q, want vos_workspace", loc.LocalPath, loc.VolumeName)
		}
	}
}

func TestFindCoveringLibrary(t *testing.T) {
	libs := []model.Library{
		newLib("root", "根库", "/media"),
		newLib("movies", "电影", "/media/Movies"),
		newLib("other", "其它", "/exposed/01VOL/public/docs"),
	}

	cases := []struct {
		path   string
		wantID string
	}{
		{"/media", "root"},
		{"/media/Movies", "movies"},      // 最长匹配优先
		{"/media/Movies/2024", "movies"}, // 祖先覆盖
		{"/media/TV", "root"},
		{"/exposed/01VOL/public/docs", "other"},
		{"/mnt/elsewhere", ""},
	}
	for _, tc := range cases {
		lib, ok := FindCoveringLibrary(tc.path, libs)
		got := ""
		if ok && lib != nil {
			got = lib.ID
		}
		if got != tc.wantID {
			t.Errorf("FindCoveringLibrary(%q) = %q, want %q", tc.path, got, tc.wantID)
		}
	}
}

func TestLibraryNameForPath(t *testing.T) {
	// 兜底名必须语言中立（库名落库，正名由前端按语言传入）
	cases := map[string]string{
		"/media":                            "media",
		"/media/Movies":                     "Movies",
		"/exposed/01VOL/public/media_video": "media_video",
		// 用户数据目录：不能取 "data"
		"/exposed/01VOL/users/admin/data":        "admin",
		"/exposed/01VOL/users/admin/data/movies": "admin",
		// 非 data 层级不误判
		"/exposed/01VOL/users/admin/share": "share",
	}
	for in, want := range cases {
		if got := DefaultLibraryNameForPath(in); got != want {
			t.Errorf("DefaultLibraryNameForPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeLibraryName(t *testing.T) {
	if got := normalizeLibraryName("  主媒体库  ", "/media"); got != "主媒体库" {
		t.Errorf("应保留前端传入的本地化名并去空白, got %q", got)
	}
	if got := normalizeLibraryName("", "/exposed/01VOL/public/media_video"); got != "media_video" {
		t.Errorf("空名应回落到目录名, got %q", got)
	}
	long := strings.Repeat("长", 100)
	if got := normalizeLibraryName(long, "/media"); len([]rune(got)) != 64 {
		t.Errorf("超长库名应截断到 64 字符, got %d", len([]rune(got)))
	}
}
