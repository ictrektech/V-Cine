// Package config 之 ai_gateway.go 提供 V-Scheduler 网关判定与内置网关条目的命名
// （网关判定的唯一特征表，全仓只维护这一份）。
package config

import "strings"

// 内置网关供应商：全新安装时种子条目，地址由系统内置、免 key、不可删除。
const (
	GatewayProviderID   = "vscheduler"
	GatewayProviderName = "V-Scheduler · VOS 账户模型"
	GatewayAPIBase      = "http://v-scheduler:8080/v1"
)

// 旧版 V-Router 内置条目：仅用于识别并就地迁移既有配置，不再写入新配置。
const (
	legacyGatewayProviderID = "vrouter"
	legacyGatewayAPIBase    = "http://v-router:8080/v1"
)

// IsVSchedulerGateway 判断是否为 V-Scheduler 网关（网关判定的唯一入口）。
// custom = 非网关，无需独立判定函数。
//
// 网关特征：providerID 含 vscheduler/v-scheduler，或 APIBase 指向网关
// （docker 服务名 ://v-scheduler: / 宿主机端口 22888）——与命名无关。
// 旧命名 vrouter/v-router 一并识别：V-Scheduler 安装包保留这两个兼容别名，
// 既有部署的 api_base 可以长期不改。
//
// API Key 全局可选：空 key = 不发 Authorization，是否需要 key
// 由服务端 401 事实回答，不再维护免 key 白名单。
func IsVSchedulerGateway(providerID, apiBase string) bool {
	p := strings.ToLower(strings.TrimSpace(providerID))
	b := strings.ToLower(strings.TrimSpace(apiBase))
	return strings.Contains(p, "vscheduler") || strings.Contains(p, "v-scheduler") ||
		strings.Contains(p, "vrouter") || strings.Contains(p, "v-router") ||
		strings.Contains(b, "://v-scheduler:") || strings.Contains(b, "://v-router:") ||
		strings.Contains(b, ":22888")
}

// IsBuiltInProviderID 判断是否为内置网关供应商条目（地址不可改、不可删除）。
// 只认当前 ID：旧版 vrouter 条目在加载时已被 migrateLegacyGatewayProvider 就地迁移，
// 残留的 vrouter 条目按用户自建处理。
func IsBuiltInProviderID(id string) bool {
	return strings.TrimSpace(id) == GatewayProviderID
}
