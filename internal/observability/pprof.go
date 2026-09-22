package observability

import "sync/atomic"

// pprof 运行时开关：启动默认值由 observability.pprof_enabled 决定，运行期经 admin
// 端点（PUT /api/admin/settings/observability/pprof）切换。
var pprofEnabled atomic.Bool

// SetPprofEnabled 切换 pprof 开关（admin 端点调用）。
func SetPprofEnabled(v bool) { pprofEnabled.Store(v) }

// PprofEnabled 返回当前 pprof 开关状态。
func PprofEnabled() bool { return pprofEnabled.Load() }
