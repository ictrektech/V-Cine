package safego

import (
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

// useObservedGlobal 把 zap 全局 logger 换成可观测的 Error 级别 logger，测试结束还原。
func useObservedGlobal(t *testing.T) *observer.ObservedLogs {
	t.Helper()
	core, logs := observer.New(zapcore.ErrorLevel)
	prev := zap.ReplaceGlobals(zap.New(core))
	t.Cleanup(prev)
	return logs
}

// TestRun_RecoversPanic panic 不应逃逸，且应被记录为 Error。
func TestRun_RecoversPanic(t *testing.T) {
	logs := useObservedGlobal(t)

	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("Run 应吞掉 panic，实际又抛出: %v", r)
			}
		}()
		Run(func() { panic("boom") })
	}()

	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("应记录 1 条日志，实际 %d 条", len(entries))
	}
	if entries[0].Level != zapcore.ErrorLevel {
		t.Errorf("级别应为 Error，实际 %s", entries[0].Level)
	}
	if entries[0].Message != "goroutine panic recovered" {
		t.Errorf("消息不匹配: %s", entries[0].Message)
	}
	if entries[0].ContextMap()["panic"] != "boom" {
		t.Errorf("panic 值未记录: %v", entries[0].ContextMap())
	}
}

// TestRun_RecoversWithoutGlobalLogger 未接线全局 logger（nop）时也必须吞掉 panic。
func TestRun_RecoversWithoutGlobalLogger(t *testing.T) {
	prev := zap.ReplaceGlobals(zap.NewNop())
	t.Cleanup(prev)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("nop logger 下也应吞掉 panic: %v", r)
		}
	}()
	Run(func() { panic("boom") })
}

// TestRun_ExecutesFn 正常路径应原样执行。
func TestRun_ExecutesFn(t *testing.T) {
	called := false
	Run(func() { called = true })
	if !called {
		t.Fatal("fn 未执行")
	}
}

// TestRun_FnDefersRunBeforeRecover fn 内部 defer（如 wg.Done）必须在 panic 展开时全部执行，
// 之后才由 Run 最外层的 recover 兜底。
func TestRun_FnDefersRunBeforeRecover(t *testing.T) {
	var order []string
	Run(func() {
		defer func() { order = append(order, "first-registered") }()
		defer func() { order = append(order, "second-registered") }()
		panic("boom")
	})
	// LIFO：后注册的先执行；两个 defer 都必须已执行。
	if len(order) != 2 || order[0] != "second-registered" || order[1] != "first-registered" {
		t.Errorf("fn 内部 defer 执行顺序错误: %v", order)
	}
}
