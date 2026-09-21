// Package config 之 ai_gateway.go 提供 V-Router 网关判定（唯一特征表）。
package config

import "strings"

// IsVRouterGateway 判断是否为 V-Router 网关（网关判定的唯一入口，
// 特征表全仓只维护这一份）。custom = 非网关，无需独立判定函数。
//
// 网关特征：providerID 含 vrouter/v-router，或 APIBase 指向网关
// （docker 服务名 ://v-router: / 宿主机端口 22888）——与命名无关。
//
// API Key 全局可选：空 key = 不发 Authorization，是否需要 key
// 由服务端 401 事实回答，不再维护免 key 白名单。
func IsVRouterGateway(providerID, apiBase string) bool {
	p := strings.ToLower(strings.TrimSpace(providerID))
	b := strings.ToLower(strings.TrimSpace(apiBase))
	return strings.Contains(p, "vrouter") || strings.Contains(p, "v-router") ||
		strings.Contains(b, "://v-router:") || strings.Contains(b, ":22888")
}
