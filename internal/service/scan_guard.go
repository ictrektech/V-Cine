package service

import "os"

// ==================== 失效记录清理的安全阀 ====================
//
// 背景：库根可能指向挂载点（/media、/exposed/<卷>/public/<目录>、/exposed/<卷>/users/<u>/data）。
// 平台撤销目录授权、卷未挂载、容器启动竞态都会让这些路径「消失」或「变空」。
// 此时若照常执行「DB 里有、磁盘上 stat 不到 → 删除记录」，会一次性清空整个库
// （连带收藏/观看历史），属于不可恢复的数据事故。
//
// 规则（保守）：**只要有一个本地库根不可用**（不存在 / 不是目录 / 不可读 / 空目录），
// 就跳过本次失效清理。
// 为什么不是"任一可用即放行"：多根库（例如远程根 + 本地根）里，远程根可用并不代表
// 本地根的文件还在；放行会删掉丢挂载那一部分记录。
// 代价：用户真把某个根清空时，记录会保留（可手动删库/重扫），换取不会因挂载抖动丢库。

// shouldSkipStaleCleanup 判定是否跳过「删除失效媒体记录」。
// existingCount 为本次参与比对的 DB 记录数（0 表示无需清理）。
// 返回 skip=true 时附带原因，供告警日志使用。
func shouldSkipStaleCleanup(libPaths []string, existingCount int) (bool, string) {
	if existingCount <= 0 {
		return false, ""
	}

	hasLocalRoot := false
	for _, p := range libPaths {
		if p == "" {
			continue
		}
		// 远程路径（webdav:// / alist:// / s3://）不走本地 stat，也不代表本地根可用
		if IsRemotePath(p) {
			continue
		}
		hasLocalRoot = true
		info, err := os.Stat(p)
		if err != nil {
			return true, "库根不存在: " + p
		}
		if !info.IsDir() {
			return true, "库根不是目录: " + p
		}
		entries, err := os.ReadDir(p)
		if err != nil {
			return true, "库根不可读: " + p
		}
		if len(entries) == 0 {
			return true, "库根为空（疑似未挂载/授权撤销）: " + p
		}
	}

	if !hasLocalRoot {
		// 纯远程库：交给远程遍历结果判断
		return false, ""
	}
	return false, ""
}
