package service

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/nowen-video/nowen-video/internal/model"
)

// ==================== 媒体导入落点（位置驱动） ====================
//
// 背景（tasks/media-import/PLAN.md 第四节）：
//   - v-cine 容器内只认本地路径：/media（安装时选的媒体库目录）、/exposed（授权目录投影）；
//   - 平台 Finder 只认 adapter + 卷内相对路径，且 v_<卷uuid> 的根是"该用户私人数据目录"，
//     公共目录必须用 p_<公共目录uuid>；
//   - 因此这里只产出"本地事实"，p_ 侧的 uuid 由前端用用户 token 查目录表后 join。
//
// 落点语义（位置驱动，根治零库死锁）：
//  1. 已建库的库路径：直接作为落点，上传后归入该库并扫描；
//  2. 尚未建库的位置（/media、授权公共目录根）：作为落点，上传完成后由前端调
//     `ensure-library` 幂等建库（名称=目录名，类型 mixed）再扫描。
//
// 硬约束：文件必须落在某个扫描根内。因此与已有库路径存在前缀关系的位置**不**单独出现
// （否则会建出互相重叠的库，同一批文件被扫描两次）。

// 导入落点类别
const (
	// ImportKindPublic 落在卷的公共目录 <vol>/public/<name>
	ImportKindPublic = "public"
	// ImportKindUserData 落在某用户的私人数据目录 <vol>/users/<user>/data
	ImportKindUserData = "user_data"
)

// 说明：无法映射的库/位置不产生落点（前端据此隐藏上传入口，PLAN D8），因此不再带 reason 字段

// VOSImportPath 描述一个本地路径在 VOS Finder 中的寻址信息（不含公共目录 uuid）
type VOSImportPath struct {
	Kind          string // public | user_data
	VolumeUUID    string
	PublicDirName string // Kind=public 时有效
	User          string // Kind=user_data 时有效
	// Rel 相对 adapter 根的路径，始终以 "/" 开头（根目录即 "/"）
	Rel string
}

// ImportLocation 上传落点（要么已归属某个库，要么上传后自动建库）
type ImportLocation struct {
	Kind          string `json:"kind"`
	Name          string `json:"name,omitempty"` // 公共目录名；主媒体库为空
	LocalPath     string `json:"local_path"`     // 容器内路径（用于展示与建库）
	VolumeUUID    string `json:"volume_uuid,omitempty"`
	VolumeName    string `json:"volume_name,omitempty"` // 卷昵称（/exposed/volumes/<昵称> 软链），供 UI 说明"在哪个存储空间"
	PublicDirName string `json:"public_dir_name,omitempty"`
	User          string `json:"user,omitempty"`
	// Adapter 仅 user_data 可直接给出（v_<卷uuid>）；public 由前端 join 得到
	Adapter string `json:"adapter,omitempty"`
	// Path 相对 adapter 根的上传目录
	Path       string `json:"path"`
	Uploadable bool   `json:"uploadable"`
	// LibraryID 为空表示"该位置还没有库"，上传完成后需 ensure-library
	LibraryID   string `json:"library_id,omitempty"`
	LibraryName string `json:"library_name,omitempty"`
}

// ParseVOSImportPath 解析 VOS 共享路径，支持两种形态：
//
//	/share/<卷uuid>/public/<公共目录名>[/...]
//	/share/<卷uuid>/users/<用户名>/data[/...]
//	/exposed/<卷uuid>/public/<公共目录名>[/...]
//	/exposed/<卷uuid>/users/<用户名>/data[/...]
//	/exposed/volumes/<卷昵称>/...   （软链，尽力解析后递归）
//
// 其它形态（如 /mnt/xxx、卷内 apps/ 目录、公共目录根本身缺目录名）返回 ok=false。
func ParseVOSImportPath(p string) (VOSImportPath, bool) {
	p = strings.TrimSpace(p)
	if p == "" {
		return VOSImportPath{}, false
	}
	p = "/" + strings.Trim(strings.ReplaceAll(p, "\\", "/"), "/")

	// /exposed/volumes/<昵称> 是平台维护的软链，能解析就按真实路径重新解析
	if strings.HasPrefix(p, "/exposed/volumes/") {
		resolved, err := filepath.EvalSymlinks(p)
		if err != nil {
			return VOSImportPath{}, false
		}
		return ParseVOSImportPath(resolved)
	}

	segs := strings.Split(strings.TrimPrefix(p, "/"), "/")
	if len(segs) < 3 {
		return VOSImportPath{}, false
	}
	root := segs[0]
	if root != "share" && root != "exposed" {
		return VOSImportPath{}, false
	}
	volumeUUID := segs[1]
	if volumeUUID == "" || volumeUUID == "." || volumeUUID == ".." {
		return VOSImportPath{}, false
	}

	switch segs[2] {
	case "public":
		// <vol>/public/<目录名>[/...]
		if len(segs) < 4 || segs[3] == "" {
			return VOSImportPath{}, false
		}
		return VOSImportPath{
			Kind:          ImportKindPublic,
			VolumeUUID:    volumeUUID,
			PublicDirName: segs[3],
			Rel:           relPath(segs[4:]),
		}, true
	case "users":
		// <vol>/users/<用户名>/data[/...]
		if len(segs) < 5 || segs[3] == "" || segs[4] != "data" {
			return VOSImportPath{}, false
		}
		return VOSImportPath{
			Kind:       ImportKindUserData,
			VolumeUUID: volumeUUID,
			User:       segs[3],
			Rel:        relPath(segs[5:]),
		}, true
	default:
		return VOSImportPath{}, false
	}
}

// relPath 把剩余路径段拼成 Finder 内的相对路径（根为 "/"）
func relPath(rest []string) string {
	if len(rest) == 0 {
		return "/"
	}
	return "/" + strings.Join(rest, "/")
}

// resolveLibraryPath 把容器内路径映射成 VOS 共享路径：
//   - /media[/...] → <VCINE_MEDIA_PATH>[/...]（安装时的宿主路径，形状为 /share/<卷>/public/<目录>）
//   - /exposed/... → 原样（exposed 投影保留 share 内相对层级）
func resolveLibraryPath(localPath, mediaHostPath string) (string, bool) {
	p := strings.TrimSpace(strings.TrimSuffix(localPath, "/"))
	if p == "" || IsRemotePath(localPath) {
		return "", false
	}
	if p == "/media" || strings.HasPrefix(p, "/media/") {
		host := strings.TrimSuffix(strings.TrimSpace(mediaHostPath), "/")
		if host == "" {
			return "", false
		}
		return host + strings.TrimPrefix(p, "/media"), true
	}
	if strings.HasPrefix(p, "/exposed/") {
		return p, true
	}
	return "", false
}

// pathsOverlap 判断两个本地路径是否有前缀关系（任一方向）
func pathsOverlap(a, b string) bool {
	a = strings.TrimSuffix(strings.TrimSpace(a), "/")
	b = strings.TrimSuffix(strings.TrimSpace(b), "/")
	if a == "" || b == "" {
		return false
	}
	return a == b || strings.HasPrefix(a, b+"/") || strings.HasPrefix(b, a+"/")
}

// BuildImportLocations 产出上传落点：
//  1. 已建库的库路径（可直接上传并扫描）；
//  2. 尚未建库的位置（/media 与授权公共目录根），上传后需 ensure-library。
//
// 与已有库路径有前缀关系的"未建库位置"会被跳过，避免建出重叠的库。
func BuildImportLocations(libs []model.Library, mediaHostPath, exposedRoot string) []ImportLocation {
	nicks := volumeNicks(exposedRoot)
	fromLibraries := make([]ImportLocation, 0, len(libs))
	covered := make([]string, 0, len(libs)*2)

	for i := range libs {
		lib := &libs[i]
		paths := lib.AllPaths()
		if len(paths) == 0 {
			continue
		}
		covered = append(covered, paths...)

		var resolved VOSImportPath
		var localPath string
		ok := false
		for _, p := range paths {
			if host, mapped := resolveLibraryPath(p, mediaHostPath); mapped {
				if vp, parsed := ParseVOSImportPath(host); parsed {
					resolved, localPath, ok = vp, p, true
					break
				}
			}
		}
		if !ok {
			// 库路径不可映射（自定义宿主目录 / 远程路径）：不提供落点
			continue
		}
		fromLibraries = append(fromLibraries, locationFromPath(resolved, localPath, lib.ID, lib.Name, nicks))
	}
	sort.SliceStable(fromLibraries, func(i, j int) bool {
		return fromLibraries[i].LibraryName < fromLibraries[j].LibraryName
	})

	// 未建库的位置
	extra := make([]ImportLocation, 0, 4)
	// 库根的物理身份：bind mount 别名（/media 与 /exposed/<卷>/public/<目录>）路径字符串不同，
	// 但其实是同一个目录；用 os.SameFile 去重，否则会出现两个位置、甚至两个库扫同一批文件
	coveredFiles := make([]os.FileInfo, 0, len(covered))
	for _, p := range covered {
		if fi, err := os.Stat(p); err == nil {
			coveredFiles = append(coveredFiles, fi)
		}
	}
	appendIfUncovered := func(loc ImportLocation) {
		for _, p := range covered {
			if pathsOverlap(p, loc.LocalPath) {
				return
			}
		}
		if fi, err := os.Stat(loc.LocalPath); err == nil {
			for _, cf := range coveredFiles {
				if os.SameFile(fi, cf) {
					return
				}
			}
		}
		extra = append(extra, loc)
	}

	// 主媒体库根（/media）
	if loc, ok := mediaLocation(mediaHostPath, nicks); ok {
		appendIfUncovered(loc)
	}

	// 授权公共目录根
	for _, loc := range publicLocations(exposedRoot, nicks) {
		appendIfUncovered(loc)
	}

	// 已授权的用户私人数据目录（未授权时该路径在 exposed 下不存在，天然不出现）
	for _, loc := range userDataLocations(exposedRoot, nicks) {
		appendIfUncovered(loc)
	}

	return append(fromLibraries, extra...)
}

func locationFromPath(vp VOSImportPath, localPath, libraryID, libraryName string, nicks map[string]string) ImportLocation {
	loc := ImportLocation{
		Kind:          vp.Kind,
		Name:          vp.PublicDirName,
		LocalPath:     localPath,
		VolumeUUID:    vp.VolumeUUID,
		VolumeName:    nicks[vp.VolumeUUID],
		PublicDirName: vp.PublicDirName,
		Path:          vp.Rel,
		Uploadable:    true,
		LibraryID:     libraryID,
		LibraryName:   libraryName,
	}
	if vp.Kind == ImportKindUserData {
		loc.User = vp.User
		loc.Adapter = "v_" + vp.VolumeUUID
		// Name 保留用户名：UI 用「用户数据（xjx）」做标题
		loc.Name = vp.User
	}
	return loc
}

// mediaLocation 由 VCINE_MEDIA_PATH（/media 的宿主路径）推导主媒体库落点
func mediaLocation(mediaHostPath string, nicks map[string]string) (ImportLocation, bool) {
	host := strings.TrimSuffix(strings.TrimSpace(mediaHostPath), "/")
	if host == "" {
		return ImportLocation{}, false
	}
	vp, ok := ParseVOSImportPath(host)
	if !ok {
		return ImportLocation{}, false
	}
	return locationFromPath(vp, "/media", "", "", nicks), true
}

// volumeNicks 读取 /exposed/volumes/<昵称> -> <卷uuid> 软链，得到 卷uuid → 昵称。
// 平台用它做"卷语义索引"，这里只用来在 UI 里说明"在哪个存储空间"。
func volumeNicks(exposedRoot string) map[string]string {
	nicks := map[string]string{}
	root := strings.TrimSuffix(strings.TrimSpace(exposedRoot), "/")
	if root == "" {
		return nicks
	}
	entries, err := os.ReadDir(filepath.Join(root, "volumes"))
	if err != nil {
		return nicks
	}
	for _, entry := range entries {
		target, err := os.Readlink(filepath.Join(root, "volumes", entry.Name()))
		if err != nil {
			continue
		}
		uuid := filepath.Base(strings.TrimSuffix(target, "/"))
		if uuid == "" || uuid == "." || uuid == ".." {
			continue
		}
		nicks[uuid] = entry.Name()
	}
	return nicks
}

// publicLocations 枚举 /exposed/<卷>/public/<目录> 作为落点（未建库时用）
func publicLocations(exposedRoot string, nicks map[string]string) []ImportLocation {
	root := strings.TrimSuffix(strings.TrimSpace(exposedRoot), "/")
	if root == "" {
		return nil
	}
	volDirs, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	locs := make([]ImportLocation, 0, 8)
	for _, volDir := range volDirs {
		if !volDir.IsDir() || strings.HasPrefix(volDir.Name(), ".") || volDir.Name() == "volumes" {
			continue
		}
		publicRoot := filepath.Join(root, volDir.Name(), "public")
		pubDirs, err := os.ReadDir(publicRoot)
		if err != nil {
			continue
		}
		for _, pub := range pubDirs {
			if !pub.IsDir() || strings.HasPrefix(pub.Name(), ".") {
				continue
			}
			locs = append(locs, ImportLocation{
				Kind:          ImportKindPublic,
				Name:          pub.Name(),
				LocalPath:     filepath.Join(publicRoot, pub.Name()),
				VolumeUUID:    volDir.Name(),
				VolumeName:    nicks[volDir.Name()],
				PublicDirName: pub.Name(),
				Path:          "/",
				Uploadable:    true,
			})
		}
	}
	sort.SliceStable(locs, func(i, j int) bool { return locs[i].LocalPath < locs[j].LocalPath })
	return locs
}

// userDataLocations 枚举 /exposed/<卷>/users/<用户>/data 作为落点。
// 平台只投影"已授权给本应用"的用户目录，因此这里出现即代表已授权；
// 撤销授权后路径消失，配合扫描安全阀（scan_guard.go）不会误删记录。
func userDataLocations(exposedRoot string, nicks map[string]string) []ImportLocation {
	root := strings.TrimSuffix(strings.TrimSpace(exposedRoot), "/")
	if root == "" {
		return nil
	}
	volDirs, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	locs := make([]ImportLocation, 0, 4)
	for _, volDir := range volDirs {
		if !volDir.IsDir() || strings.HasPrefix(volDir.Name(), ".") || volDir.Name() == "volumes" {
			continue
		}
		usersRoot := filepath.Join(root, volDir.Name(), "users")
		userDirs, err := os.ReadDir(usersRoot)
		if err != nil {
			continue
		}
		for _, u := range userDirs {
			if !u.IsDir() || strings.HasPrefix(u.Name(), ".") {
				continue
			}
			dataPath := filepath.Join(usersRoot, u.Name(), "data")
			if info, err := os.Stat(dataPath); err != nil || !info.IsDir() {
				continue
			}
			locs = append(locs, ImportLocation{
				Kind:       ImportKindUserData,
				Name:       u.Name(),
				User:       u.Name(),
				LocalPath:  dataPath,
				VolumeUUID: volDir.Name(),
				VolumeName: nicks[volDir.Name()],
				Adapter:    "v_" + volDir.Name(),
				Path:       "/",
				Uploadable: true,
			})
		}
	}
	sort.SliceStable(locs, func(i, j int) bool { return locs[i].LocalPath < locs[j].LocalPath })
	return locs
}
