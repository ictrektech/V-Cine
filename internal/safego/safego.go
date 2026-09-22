// Package safego 提供带 panic 恢复的 goroutine 包装。
// 后台协程 panic 会直接使整个进程崩溃；用 safego.Run 包装后，
// panic 被恢复并通过 zap 全局 logger 以 Error 级别连同栈一起记录。
package safego

import (
	"runtime/debug"

	"go.uber.org/zap"
)

// Run 执行 fn；若 fn panic 则恢复并记录日志（含栈），不让进程崩溃。
// 调用方保留 go 关键字以保持并发可见性：
//
//	go safego.Run(func() { s.worker(i) })
//
// 日志走 zap 全局 logger（cmd/server 启动时 zap.ReplaceGlobals 接线），
// 未初始化时为 nop：仅恢复不记录。Run 注册的 recover 位于最外层，
// fn 内部的 defer（wg.Done、close(ch) 等）仍会先于 recover 执行。
func Run(fn func()) {
	defer func() {
		if r := recover(); r != nil {
			zap.S().Errorw("goroutine panic recovered",
				"panic", r, "stack", string(debug.Stack()))
		}
	}()
	fn()
}
