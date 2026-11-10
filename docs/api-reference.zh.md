# V-Cine API

## 地址和协议

容器地址 `http://nowen-video:8080`；宿主机默认 `http://HOST:38085`；VOS 同源前缀 `/app/com.ictrek.v-cine`。以下 `/api/*` 路径追加到相应地址。监控端口 8900 → 9090 不是业务 API。API 管理入口在个人资料的 API Key 面板；侧栏新增 API 文档入口，含搜索和展开式字段目录。

## 身份、权限和 API Key

V-Cine 自己的 `nk_` Key 与 V-Scheduler Key、上游厂商 Key 是三种不同凭证，不能互换。业务 API 接受本应用 JWT 或 `Authorization: Bearer nk_...`；Key 按所属用户的媒体库权限访问，但中间件不会赋予管理员角色，管理员路由仍需管理员 JWT。VOS 登录经 `POST /api/auth/vos-oidc` 兑换本应用会话，不等于任何位置都直接接受 VOS token。

- `POST /api/users/me/api-keys`：JSON `{ "name": "external-agent", "expires_at": "2027-01-01T00:00:00Z" }`。name 必填；expires_at 可省略，为 RFC3339 时间或 null。201 返回 `{data: {..., key, raw_key}}`。
- `GET /api/users/me/api-keys`：200 `{data: [...]}`。字段 id、name、key_prefix、key、last_used_at、expires_at、is_revoked、created_at；时间为 RFC3339，可空时间为 null。**列表仍可返回解密后的完整 key**；raw_key 只在创建响应出现，不能因此说 Key 整体只显示一次。
- `DELETE /api/users/me/api-keys/:id`：200 `{message: ...}`，撤销后保留记录但不能继续使用。
- `DELETE /api/users/me/api-keys/:id/hard`：200 `{message: ...}`，彻底删除该用户的 Key 记录。没有就地改名或重新设置密钥值接口；轮换要创建新 Key、更新调用方，再撤销旧 Key。

不要把 Key 放到日志或截图中。媒体 URL 的 `token` 查询参数是兼容方式，优先用请求头。公开健康接口不代表私有媒体已经授权。`/internal/video-analysis/source/:id` 使用独立 source_token（空配置仅靠内网隔离）；联邦与 Emby 路由有单独协议和认证规则，不套用管理员 JWT 说明。

## 可复制示例

```bash
BASE=http://HOST:38085
# 先用已登录的 V-Cine JWT 创建个人 Key
curl "$BASE/api/users/me/api-keys" -H "Authorization: Bearer $VCINE_JWT" -H 'Content-Type: application/json' --data '{"name":"external-agent"}'
# 取响应 data.raw_key；这里只使用环境变量，不写死真实密钥
curl "$BASE/api/media?page=1&size=20" -H "Authorization: Bearer $VCINE_KEY"
curl --get "$BASE/api/search" --data-urlencode 'q=space' -H "Authorization: Bearer $VCINE_KEY"
```

## 分页、任务、停止和错误

各端点原生返回值并不统一：媒体列表通常是 `{data,total,page,size}`；详情通常 `{data}`；流媒体返回二进制或 HLS，不能统一按 JSON 解析。page/size 边界以具体端点为准（媒体列表 page 至少 1，size 1–100，非法 size 回退 20）。HTTP 400 是输入问题，401 凭证缺失/失效，403 角色或媒体库权限，404 资源不存在，500 服务端处理失败；错误通常 `{error: string}`，不要吞掉正文只显示状态码。

预处理、字幕和视频分析等是异步任务：创建成功后按返回 ID 查询状态，等待完成再读取结果。取消、重试、删除是不同操作；DELETE 可能删除数据库记录或实际媒体文件，操作前看该端点的请求字段。批量操作可能部分成功，不要把一次 HTTP 200 当作每项完成。`/api/ws` 是需认证 WebSocket；断线后重新查询任务状态，不承诺历史事件回放。AI 请求使用保存的模型/供应商设置；V-Scheduler 的模型权限、调度预算和任务优先级由调度器判定，不由 V-Cine Key 自动绕过。

## 完整原生契约

以下目录从实际 Gin 注册和处理器生成，保留查询参数、默认值、请求类型和响应表达式。Go 声明展示真实字段/类型；响应中的服务变量是原生表达式，**不是可以原样发送的 JSON**。服务内部动态结果未被猜测成固定结构。共享字段在文末展开。Emby/Infuse 的大小写别名及双前缀由独立路由注册器维护，见仓库 `internal/handler/emby/router.go`；这是 Emby 协议兼容层，不能当作普通 JSON API。

## 接口目录

### POST /api/auth/login

访问边界: `separate/public`. [Auth.Login](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/auth.go#L46)

```go
service.LoginRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusForbidden, gin.H{"error": err.Error()})
JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
JSON(http.StatusOK, token)
```

### GET /api/auth/status

访问边界: `separate/public`. [Auth.Status](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/auth.go#L69)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取状态失败"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"initialized":       status.Initialized,
			"registration_open": status.RegistrationOpen,
			"invite_required":   status.InviteRequired,
			// 服务器身份信息（供局域网发现识别）
			"server_name": serverName,
			"server_type": "nowen-video",
			"version":     version.Current(),
		},
	})
```

### POST /api/auth/register

访问边界: `separate/public`. [Auth.Register](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/auth.go#L96)

```go
service.RegisterRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效，用户名至少3位，密码至少6位"})
JSON(http.StatusConflict, gin.H{"error": err.Error()})
JSON(http.StatusForbidden, gin.H{"error": err.Error()})
JSON(http.StatusForbidden, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "注册失败"})
JSON(http.StatusCreated, token)
```

### GET /api/health

访问边界: `separate/public`. 静态资源/健康/预检内联处理器，见主路由。

### GET /api/capabilities

访问边界: `separate/public`. [Capability.List](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/capability.go#L26)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{"items": service.BuildCapabilities(h.cfg, ai, va)},
	})
```

### POST /api/auth/vos-oidc

访问边界: `separate/public`. [Auth.LoginWithVOSOIDC](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/auth.go#L17)

```go
vosOIDCRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "VOS access token 无效"})
JSON(http.StatusConflict, gin.H{"error": err.Error()})
JSON(http.StatusForbidden, gin.H{"error": err.Error()})
JSON(http.StatusUnauthorized, gin.H{"error": "VOS 身份验证失败"})
JSON(http.StatusOK, resp)
```

### POST /api/auth/refresh

访问边界: `user`. [Auth.RefreshToken](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/auth.go#L122)

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未提供有效的认证信息"})
JSON(http.StatusUnauthorized, gin.H{"error": "认证信息无效"})
JSON(http.StatusUnauthorized, gin.H{"error": "令牌刷新失败"})
JSON(http.StatusOK, token)
```

### PUT /api/auth/password

访问边界: `user`. [Auth.ChangePassword](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/auth.go#L145)

```go
service.ChangePasswordRequest
```

```go
JSON(http.StatusUnauthorized, gin.H{"error": "认证信息无效"})
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效，新密码至少6位"})
JSON(http.StatusBadRequest, gin.H{"error": "当前密码错误"})
JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "修改密码失败"})
JSON(http.StatusOK, gin.H{"message": "密码修改成功，请重新登录"})
JSON(http.StatusOK, gin.H{"message": "密码修改成功", "data": token})
```

### GET /manifest.json

访问边界: `separate/public`. 静态资源/健康/预检内联处理器，见主路由。

### GET /sw.js

访问边界: `separate/public`. 静态资源/健康/预检内联处理器，见主路由。

### GET /api/ws

访问边界: `user`. [WS.HandleWebSocket](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ws.go#L28)

### GET /api/libraries

访问边界: `user`. [Library.List](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L100)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库列表失败"})
JSON(http.StatusOK, gin.H{"data": libs})
```

### GET /api/libraries/scan-status

访问边界: `admin`. [Library.ScanStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L247)

```go
JSON(http.StatusOK, gin.H{"data": h.libService.ActiveScanPhases()})
```

### POST /api/libraries

访问边界: `admin`. [Library.Create](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L116)

```go
CreateLibraryRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": "请至少指定一个媒体文件夹路径"})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("路径不存在: %s，请检查路径是否正确以及Docker卷映射是否配置", p)})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("无权限访问路径: %s，请检查文件权限", p)})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("访问路径失败 %s: %v", p, err)})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("路径不是目录: %s", p)})
JSON(http.StatusInternalServerError, gin.H{"error": "创建媒体库失败"})
JSON(http.StatusBadRequest, gin.H{"error": "auto_organize_mode 取值非法（应为 off / rule_only / ai_assisted）"})
JSON(http.StatusCreated, gin.H{"data": lib})
```

### PUT /api/libraries/:id

访问边界: `admin`. [Library.Update](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L279)

参数: `Param id`

```go
UpdateLibraryRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusNotFound, gin.H{"error": "媒体库不存在"})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("路径不存在: %s", p)})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("无权限访问路径: %s", p)})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("访问路径失败 %s: %v", p, pathErr)})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("路径不是目录: %s", p)})
JSON(http.StatusBadRequest, gin.H{"error": "auto_organize_mode 取值非法（应为 off / rule_only / ai_assisted）"})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("创建 AI 整理输出目录失败: %s: %v", organizeOutputDir, err)})
JSON(http.StatusInternalServerError, gin.H{"error": "更新媒体库失败"})
JSON(http.StatusOK, gin.H{"data": lib})
```

### POST /api/libraries/:id/scan

访问边界: `admin`. [Library.Scan](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L211)

参数: `Param id`

```go
{
		Paths []string `json:"paths"`
		Files []string `json:"files"`
	}
```

```go
JSON(http.StatusAccepted, gin.H{
				"message": "扫描已在进行中",
				"data":    h.libService.ActiveScanPhases(),
			})
JSON(http.StatusOK, gin.H{"message": "扫描已启动"})
```

### POST /api/libraries/:id/reindex

访问边界: `admin`. [Library.Reindex](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L262)

参数: `Param id`

```go
JSON(http.StatusAccepted, gin.H{
				"message": "扫描已在进行中",
				"data":    h.libService.ActiveScanPhases(),
			})
JSON(http.StatusOK, gin.H{"message": "重建索引已启动"})
```

### DELETE /api/libraries/:id

访问边界: `admin`. [Library.Delete](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L252)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除媒体库失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/media

访问边界: `user`. [Media.List](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L28)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体列表失败"})
JSON(http.StatusOK, gin.H{
		"data":  media,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### GET /api/media/:id

访问边界: `user`. [Media.Detail](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L55)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{"data": media})
```

### GET /api/media/:id/enhanced

访问边界: `user`. [Media.DetailEnhanced](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L83)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{"data": enhanced})
```

### GET /api/media/:id/versions

访问边界: `user`. [Media.Versions](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L69)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{
		"data":  versions,
		"total": len(versions),
	})
```

### GET /api/media/recent

访问边界: `user`. [Media.Recent](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L94)

参数: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取最近媒体失败"})
JSON(http.StatusOK, gin.H{"data": media})
```

### GET /api/media/recent/aggregated

访问边界: `user`. [Media.RecentAggregated](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L105)

参数: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取最近媒体失败"})
JSON(http.StatusOK, gin.H{
		"media":  media,
		"series": series,
	})
```

### GET /api/media/recent/mixed

访问边界: `user`. [Media.RecentMixed](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L186)

参数: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取最近媒体失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/media/aggregated

访问边界: `user`. [Media.ListAggregated](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L119)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体列表失败"})
JSON(http.StatusOK, gin.H{
		"data":  media,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### GET /api/media/mixed

访问边界: `user`. [Media.ListMixed](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L146)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; Query year_from; Query year_to; Query library_id; Query type; Query genre; Query q; Query sort; Query order`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取混合列表失败"})
JSON(http.StatusOK, gin.H{
		"data":         result.Items,
		"total":        result.Total,
		"movie_count":  result.MovieCount,
		"series_count": result.SeriesCount,
		"page":         page,
		"size":         size,
	})
```

### GET /api/media/continue

访问边界: `user`. [Media.Continue](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L197)

参数: `DefaultQuery limit = 10`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取续播列表失败"})
JSON(http.StatusOK, gin.H{"data": histories})
```

### GET /api/series

访问边界: `user`. [Series.List](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/series.go#L27)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取剧集列表失败"})
JSON(http.StatusOK, gin.H{
		"data":  series,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### GET /api/series/:id

访问边界: `user`. [Series.Detail](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/series.go#L54)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "剧集不存在"})
JSON(http.StatusOK, gin.H{"data": series})
```

### GET /api/series/:id/seasons

访问边界: `user`. [Series.Seasons](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/series.go#L65)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取季列表失败"})
JSON(http.StatusOK, gin.H{"data": seasons})
```

### GET /api/series/:id/seasons/:season

访问边界: `user`. [Series.SeasonEpisodes](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/series.go#L76)

参数: `Param id; Param season`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取剧集列表失败"})
JSON(http.StatusOK, gin.H{"data": episodes})
```

### GET /api/series/:id/next

访问边界: `user`. [Series.NextEpisode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/series.go#L89)

参数: `Param id; Query season; Query episode`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取下一集失败"})
JSON(http.StatusOK, gin.H{"data": nil, "message": "已是最后一集"})
JSON(http.StatusOK, gin.H{"data": next})
```

### GET /api/stream/:id/info

访问边界: `user`. [Stream.MediaInfo](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L193)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": info})
```

### GET /api/stream/:id/direct

访问边界: `user`. [Stream.Direct](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L31)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusBadGateway, gin.H{"error": "远程流播放失败: " + err.Error()})
```

### GET /api/stream/:id/remux

访问边界: `user`. [Stream.Remux](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L182)

参数: `Param id`

### GET /api/stream/:id/master.m3u8

访问边界: `user`. [Stream.Master](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L86)

参数: `Param id; Query maxBitrate`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
String(http.StatusOK, playlist)
```

### GET /api/stream/:id/:quality/:segment

访问边界: `user`. [Stream.Segment](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L113)

参数: `Param id; Param quality; Param segment`

```go
String(http.StatusOK, playlist)
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
```

### POST /api/stream/:id/playback

访问边界: `user`. [Stream.Playback](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L213)

参数: `Param id; Query position; PostForm position`

```go
JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
JSON(http.StatusBadRequest, gin.H{"error": "invalid position"})
JSON(http.StatusOK, gin.H{"ok": true})
```

### POST /api/stream/:id/bandwidth

访问边界: `user`. [Stream.Bandwidth](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L249)

参数: `Param id; Query bitrate; PostForm bitrate`

```go
JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
JSON(http.StatusBadRequest, gin.H{"error": "invalid bitrate"})
JSON(http.StatusOK, resp)
```

### GET /api/stream/:id/throttle

访问边界: `user`. [Stream.ThrottleStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L285)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
JSON(http.StatusOK, gin.H{"data": gin.H{"media_id": id, "running": false}})
JSON(http.StatusOK, gin.H{"data": h.transcodeService.GetMediaThrottleStatus(id)})
```

### GET /api/stream/:id/strm-seg

访问边界: `user`. [Stream.STRMSegment](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L304)

参数: `Param id; Query u; Query target`

```go
JSON(http.StatusBadRequest, gin.H{"error": "missing target url"})
JSON(http.StatusBadGateway, gin.H{"error": "远程子资源拉取失败: " + err.Error()})
```

### GET /api/stream/:id/strm-check

访问边界: `user`. [Stream.STRMCheck](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L322)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/audio-track/:id/:trackIdx

访问边界: `user`. [Stream.AudioPlaylist](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L145)

参数: `Param id; Param trackIdx`

```go
JSON(http.StatusBadRequest, gin.H{"error": "invalid track index"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
String(http.StatusOK, playlist)
```

### GET /api/audio-track/:id/:trackIdx/:seg

访问边界: `user`. [Stream.AudioSegment](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L167)

参数: `Param id; Param trackIdx; Param seg`

```go
JSON(http.StatusBadRequest, gin.H{"error": "invalid track index"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
```

### GET /api/media/:id/poster

访问边界: `user`. [Stream.Poster](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/imagery.go#L46)

参数: `Param id`

### GET /api/media/:id/backdrop

访问边界: `user`. [Stream.Backdrop](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/imagery.go#L174)

参数: `Param id`

### GET /api/series/:id/poster

访问边界: `user`. [Series.Poster](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/series.go#L107)

参数: `Param id`

```go
String(http.StatusOK, posterPlaceholderSVG)
String(http.StatusOK, posterPlaceholderSVG)
Status(http.StatusNotModified)
File(posterPath)
```

### GET /api/series/:id/backdrop

访问边界: `user`. [Series.Backdrop](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/series.go#L155)

参数: `Param id`

```go
String(http.StatusOK, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect fill="#1e1e2e" width="1280" height="720"/></svg>`)
String(http.StatusOK, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect fill="#1e1e2e" width="1280" height="720"/></svg>`)
Status(http.StatusNotModified)
File(series.BackdropPath)
```

### GET /api/series/:id/persons

访问边界: `user`. [Series.GetPersons](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/series.go#L206)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusOK, gin.H{"data": deduped})
```

### GET /api/media/:id/persons

访问边界: `user`. [Media.GetPersons](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L299)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusOK, gin.H{"data": persons})
```

### GET /api/persons/:id

访问边界: `user`. [Media.GetPersonDetail](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L311)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "person not found"})
JSON(http.StatusOK, gin.H{"data": person})
```

### GET /api/persons/:id/media

访问边界: `user`. [Media.GetPersonMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L323)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{
		"media":  media,
		"series": series,
	})
```

### GET /api/persons/:id/profile

访问边界: `user`. [Media.PersonProfile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L346)

参数: `Param id`

```go
Status(http.StatusNotModified)
File(person.ProfileURL)
```

### GET /api/subtitle/:id/tracks

访问边界: `user`. [Subtitle.ListTracks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L24)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"embedded": []interface{}{},
				"external": []interface{}{},
			},
		})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"embedded": embedded,
			"external": external,
		},
	})
```

### GET /api/subtitle/:id/extract/:index

访问边界: `user`. [Subtitle.ExtractTrack](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L64)

参数: `Param id; Param index`

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的字幕轨道索引"})
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusBadRequest, gin.H{"error": "STRM 远程流不支持字幕提取"})
JSON(http.StatusBadRequest, gin.H{
					"error": "该字幕轨道为图形字幕（" + track.Codec + "），无法提取为文本格式",
				})
File(vttPath)
```

### GET /api/subtitle/external

访问边界: `user`. [Subtitle.ServeExternal](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L114)

参数: `Query path; Query format`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少字幕路径"})
File(subPath)
File(subPath)
File(utf8Path)
File(subPath)
File(vttPath)
File(subPath)
File(utf8Path)
File(subPath)
File(vttPath)
JSON(http.StatusBadRequest, gin.H{"error": "不支持的字幕格式"})
```

### POST /api/subtitle/:id/extract-all

访问边界: `user`. [Subtitle.ExtractAll](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L424)

参数: `Param id`

```go
{
		Format string `json:"format"` // 输出格式: srt | vtt，默认 srt
		Tracks []int  `json:"tracks"` // 指定轨道索引，为空则提取所有
	}
```

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusBadRequest, gin.H{"error": "STRM 远程流不支持字幕提取"})
JSON(http.StatusBadRequest, gin.H{"error": "不支持的输出格式，可选: srt, vtt, ass"})
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("提取完成: %d 成功, %d 失败", successCount, failCount),
		"data": gin.H{
			"files":   results,
			"success": successCount,
			"failed":  failCount,
			"total":   len(results),
		},
	})
```

### POST /api/subtitle/:id/extract-all/async

访问边界: `user`. [Subtitle.ExtractAllAsync](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L485)

参数: `Param id`

```go
{
		Format string `json:"format"`
		Tracks []int  `json:"tracks"`
		Title  string `json:"title"` // 媒体标题（用于进度消息）
	}
```

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusBadRequest, gin.H{"error": "STRM 远程流不支持字幕提取"})
JSON(http.StatusOK, gin.H{
		"message": "异步字幕提取任务已启动，请通过 WebSocket 监听进度",
	})
```

### GET /api/subtitle/download

访问边界: `user`. [Subtitle.DownloadExtracted](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L520)

参数: `Query path`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少文件路径"})
JSON(http.StatusBadRequest, gin.H{"error": "不支持的文件格式"})
JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
File(filePath)
```

### GET /api/subtitle/:id/search

访问边界: `user`. [SubtitleSearch.SearchSubtitles](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L60)

参数: `Param id; DefaultQuery language = zh-cn,en; Query title; Query year; DefaultQuery type = movie`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{"data": results})
```

### POST /api/subtitle/:id/download

访问边界: `user`. [SubtitleSearch.DownloadSubtitle](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L96)

参数: `Param id`

```go
{
		FileID string `json:"file_id"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{
		"message": "字幕下载成功",
		"data":    result,
	})
```

### POST /api/subtitle/:id/ai/generate

访问边界: `user`. [Subtitle.GenerateAISubtitle](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L203)

参数: `Param id`

```go
{
		Language string `json:"language"` // 语言代码，如 zh / en / ja，留空自动检测
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用，请先配置 AI API"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "AI 字幕生成任务已启动",
		"data":    task,
	})
```

### GET /api/subtitle/:id/ai/status

访问边界: `user`. [Subtitle.GetAISubtitleStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L230)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusOK, gin.H{
				"data": gin.H{
					"media_id": id,
					"status":   "completed",
					"progress": 100,
					"message":  "AI 字幕已就绪",
					"vtt_path": vttPath,
				},
			})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"media_id": id,
				"status":   "none",
				"message":  "暂无 AI 字幕",
			},
		})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /api/subtitle/:id/ai/serve

访问边界: `user`. [Subtitle.ServeAISubtitle](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L269)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusNotFound, gin.H{"error": "AI 字幕不存在，请先生成"})
File(vttPath)
```

### DELETE /api/subtitle/:id/ai

访问边界: `user`. [Subtitle.DeleteAISubtitle](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L289)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusOK, gin.H{"message": "AI 字幕已删除"})
```

### POST /api/subtitle/:id/translate

访问边界: `user`. [Subtitle.TranslateSubtitle](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L308)

参数: `Param id`

```go
{
		TargetLang string `json:"target_lang" binding:"required"` // 目标语言代码
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "请指定目标翻译语言（target_lang）"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "字幕翻译任务已启动",
		"data":    task,
	})
```

### GET /api/subtitle/:id/translate/status

访问边界: `user`. [Subtitle.GetTranslateStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L337)

参数: `Param id; Query lang`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusOK, gin.H{
					"data": gin.H{
						"media_id": id,
						"status":   "completed",
						"progress": 100,
						"language": targetLang,
						"message":  "翻译字幕已就绪",
						"vtt_path": vttPath,
					},
				})
JSON(http.StatusOK, gin.H{
				"data": gin.H{
					"media_id": id,
					"status":   "none",
					"language": targetLang,
					"message":  "暂无翻译字幕",
				},
			})
JSON(http.StatusOK, gin.H{"data": task})
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusOK, gin.H{"data": translated})
```

### GET /api/subtitle/:id/translate/:lang/serve

访问边界: `user`. [Subtitle.ServeTranslatedSubtitle](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L391)

参数: `Param id; Param lang`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusNotFound, gin.H{"error": "翻译字幕不存在"})
File(vttPath)
```

### GET /api/asr/status

访问边界: `user`. [Subtitle.GetASRStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle.go#L412)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false}})
JSON(http.StatusOK, gin.H{"data": h.asrService.GetStatus()})
```

### GET /api/subtitle-preprocess/media/:id/status

访问边界: `user`. [SubtitlePreprocess.GetMediaStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L247)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"status":  "none",
				"message": "未进行字幕预处理",
			},
		})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /api/preprocess/media/:id/status

访问边界: `user`. [Preprocess.GetMediaTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L113)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"media_id": mediaID,
				"status":   "none",
				"message":  "未预处理",
			},
		})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /api/preprocess/media/:id/master.m3u8

访问边界: `user`. [Preprocess.ServePreprocessedMaster](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L512)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
String(http.StatusOK, playlist)
```

### GET /api/preprocess/media/:id/:quality/:segment

访问边界: `user`. [Preprocess.ServePreprocessedSegment](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L527)

参数: `Param id; Param quality; Param segment`

```go
JSON(http.StatusNotFound, gin.H{"error": "预处理未完成"})
File(filePath)
```

### GET /api/preprocess/media/:id/thumbnail

访问边界: `user`. [Preprocess.ServeThumbnail](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L553)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "封面不存在"})
File(task.ThumbnailPath)
```

### GET /api/preprocess/media/:id/keyframe/:index

访问边界: `user`. [Preprocess.ServeKeyframe](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L568)

参数: `Param id; Param index`

```go
JSON(http.StatusNotFound, gin.H{"error": "关键帧不存在"})
File(filePath)
```

### GET /api/preprocess/media/:id/sprite.jpg

访问边界: `user`. [Preprocess.ServeSprite](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L585)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "雪碧图不存在"})
File(task.SpritePath)
```

### GET /api/preprocess/media/:id/sprite.vtt

访问边界: `user`. [Preprocess.ServeSpriteVTT](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L600)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "WebVTT 索引不存在"})
File(task.SpriteVTTPath)
```

### POST /api/media/:id/scrape

访问边界: `admin`. [Metadata.ScrapeMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/metadata.go#L18)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"message": "元数据刮削成功"})
```

### GET /api/media/:id/video-analysis

访问边界: `user`. [VideoAnalysis.GetMediaResult](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L411)

参数: `Param id; Query task_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusNotFound, gin.H{"error": "未找到可展示的视频分析结果"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询视频分析结果失败"})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/media/:id/video-analysis/scenes/:sceneIndex/grid

访问边界: `user`. [VideoAnalysis.ServeSceneGrid](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L431)

参数: `Param sceneIndex; Param id; Query task_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusBadRequest, gin.H{"error": "sceneIndex 必须是非负整数"})
JSON(http.StatusNotFound, gin.H{"error": "九宫格图片不存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "读取九宫格图片失败"})
```

### GET /api/video-analysis/scenes/search

访问边界: `user`. [VideoAnalysis.SearchScenes](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L495)

参数: `Query q; DefaultQuery limit = 20; DefaultQuery mode = text; Query library_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "缺少查询参数 q（文本查询）"})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("media_ids 数量超过上限 %d", sceneSearchMaxMediaIDs)})
JSON(http.StatusOK, gin.H{"data": results})
```

### GET /api/video-analysis/tasks/:id/scenes

访问边界: `user`. [VideoAnalysis.ListScenesByTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L535)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "taskId 是必填参数"})
JSON(http.StatusOK, gin.H{"scenes": items})
```

### GET /api/video-analysis/tasks/:id/workflow

访问边界: `user`. [VideoAnalysis.GetWorkflow](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L582)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"data": workflow})
```

### POST /api/video-analysis/tasks/:id/run-stage

访问边界: `user`. [VideoAnalysis.RunStage](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L596)

参数: `Param id`

```go
{
		Stage string `json:"stage" binding:"required"`
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 stage 参数 (detect/structure/describe)"})
JSON(http.StatusOK, gin.H{"message": "阶段已启动"})
```

### POST /api/video-analysis/tasks/:id/run-all

访问边界: `user`. [VideoAnalysis.RunAll](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L616)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"message": "任务已全部执行完成"})
```

### POST /api/video-analysis/tasks/:id/run-missing

访问边界: `user`. [VideoAnalysis.RunMissing](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L629)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"message": "缺失阶段已补齐"})
```

### GET /api/video-analysis/models/status

访问边界: `user`. [VideoAnalysis.ModelHubStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L243)

参数: `Query model`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 model 参数（如 v-scheduler/ollama-qa/minicpm-v4.6:latest）"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "未配置 V-Scheduler 模型仓库地址（video_analysis.model_hub_api_url）"})
JSON(http.StatusOK, gin.H{"data": status})
```

### GET /api/users/me

访问边界: `user`. [User.Profile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L24)

```go
JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
JSON(http.StatusOK, gin.H{"data": user})
```

### PUT /api/users/me

访问边界: `user`. [User.UpdateProfile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L36)

```go
service.UpdateSelfProfileRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusConflict, gin.H{"error": err.Error()})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
JSON(http.StatusOK, resp)
```

### GET /api/users/me/login-logs

访问边界: `user`. [User.LoginLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L68)

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": logs})
```

### PUT /api/users/me/progress/:mediaId

访问边界: `user`. [User.UpdateProgress](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L90)

参数: `Param mediaId`

```go
UpdateProgressRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "更新进度失败"})
JSON(http.StatusOK, gin.H{"message": "已更新"})
```

### GET /api/users/me/favorites

访问边界: `user`. [User.Favorites](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L109)

参数: `DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取收藏列表失败"})
JSON(http.StatusOK, gin.H{
		"data":  favs,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### POST /api/users/me/favorites/:mediaId

访问边界: `user`. [User.AddFavorite](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L129)

参数: `Param mediaId`

```go
JSON(http.StatusConflict, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "收藏失败"})
JSON(http.StatusCreated, gin.H{"message": "已收藏"})
```

### DELETE /api/users/me/favorites/:mediaId

访问边界: `user`. [User.RemoveFavorite](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L146)

参数: `Param mediaId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "取消收藏失败"})
JSON(http.StatusOK, gin.H{"message": "已取消收藏"})
```

### GET /api/users/me/favorites/:mediaId/check

访问边界: `user`. [User.CheckFavorite](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L159)

参数: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"data": favorited})
```

### GET /api/users/me/progress/:mediaId

访问边界: `user`. [User.GetProgress](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L168)

参数: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"data": nil})
JSON(http.StatusOK, gin.H{"data": progress})
```

### GET /api/users/me/history

访问边界: `user`. [User.History](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L182)

参数: `DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取观看历史失败"})
JSON(http.StatusOK, gin.H{
		"data":  histories,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### DELETE /api/users/me/history/:mediaId

访问边界: `user`. [User.DeleteHistory](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L209)

参数: `Param mediaId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除观看记录失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### DELETE /api/users/me/history

访问边界: `user`. [User.ClearHistory](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/user.go#L222)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "清空观看历史失败"})
JSON(http.StatusOK, gin.H{"message": "已清空"})
```

### GET /api/users/me/api-keys

访问边界: `user`. [ApiKey.List](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/api_key.go#L53)

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": keys})
```

### POST /api/users/me/api-keys

访问边界: `user`. [ApiKey.Create](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/api_key.go#L28)

```go
createApiKeyRequest
```

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 API Key 名称"})
JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
JSON(http.StatusCreated, gin.H{"data": result})
```

### DELETE /api/users/me/api-keys/:id

访问边界: `user`. [ApiKey.Revoke](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/api_key.go#L74)

参数: `Param id`

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
JSON(http.StatusBadRequest, gin.H{"error": "缺少 Key ID"})
JSON(http.StatusInternalServerError, gin.H{"error": "撤销失败"})
JSON(http.StatusOK, gin.H{"message": "已撤销"})
```

### DELETE /api/users/me/api-keys/:id/hard

访问边界: `user`. [ApiKey.Delete](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/api_key.go#L98)

参数: `Param id`

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
JSON(http.StatusBadRequest, gin.H{"error": "缺少 Key ID"})
JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/playlists

访问边界: `user`. [Playlist.List](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/playlist.go#L24)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取播放列表失败"})
JSON(http.StatusOK, gin.H{"data": playlists})
```

### POST /api/playlists

访问边界: `user`. [Playlist.Create](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/playlist.go#L35)

```go
CreatePlaylistRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "创建播放列表失败"})
JSON(http.StatusCreated, gin.H{"data": playlist})
```

### GET /api/playlists/:id

访问边界: `user`. [Playlist.Detail](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/playlist.go#L53)

参数: `Param id`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权访问该播放列表"})
JSON(http.StatusNotFound, gin.H{"error": "播放列表不存在"})
JSON(http.StatusOK, gin.H{"data": playlist})
```

### DELETE /api/playlists/:id

访问边界: `user`. [Playlist.Delete](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/playlist.go#L69)

参数: `Param id`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权操作"})
JSON(http.StatusInternalServerError, gin.H{"error": "删除播放列表失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### POST /api/playlists/:id/items/:mediaId

访问边界: `user`. [Playlist.AddItem](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/playlist.go#L85)

参数: `Param id; Param mediaId`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权操作"})
JSON(http.StatusInternalServerError, gin.H{"error": "添加失败"})
JSON(http.StatusCreated, gin.H{"message": "已添加"})
```

### DELETE /api/playlists/:id/items/:mediaId

访问边界: `user`. [Playlist.RemoveItem](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/playlist.go#L102)

参数: `Param id; Param mediaId`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权操作"})
JSON(http.StatusInternalServerError, gin.H{"error": "移除失败"})
JSON(http.StatusOK, gin.H{"message": "已移除"})
```

### GET /api/search

访问边界: `user`. [Media.Search](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L210)

参数: `Query q; DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusBadRequest, gin.H{"error": "搜索关键词不能为空"})
JSON(http.StatusInternalServerError, gin.H{"error": "搜索失败"})
JSON(http.StatusOK, gin.H{
		"data":  media,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### GET /api/search/advanced

访问边界: `user`. [Media.SearchAdvanced](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L236)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; DefaultQuery year_min = 0; DefaultQuery year_max = 0; DefaultQuery min_rating = 0; Query q; Query type; Query genre; DefaultQuery sort_by = created_at; DefaultQuery sort_order = desc`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "搜索失败"})
JSON(http.StatusOK, gin.H{
		"data":  media,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### GET /api/search/mixed

访问边界: `user`. [Media.SearchMixed](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/media.go#L272)

参数: `Query q; DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusBadRequest, gin.H{"error": "搜索关键词不能为空"})
JSON(http.StatusInternalServerError, gin.H{"error": "搜索失败"})
JSON(http.StatusOK, gin.H{
		"media":        result.Media,
		"series":       result.Series,
		"media_total":  result.MediaTotal,
		"series_total": result.SeriesTotal,
		"page":         page,
		"size":         size,
	})
```

### GET /api/recommend

访问边界: `user`. [Recommend.GetRecommendations](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/recommend.go#L19)

参数: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取推荐失败"})
JSON(http.StatusOK, gin.H{"data": recommendations})
```

### GET /api/recommend/similar/:mediaId

访问边界: `user`. [Recommend.GetSimilarMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/recommend.go#L38)

参数: `Param mediaId; DefaultQuery limit = 12`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取相关推荐失败"})
JSON(http.StatusOK, gin.H{"data": recommendations})
```

### GET /api/ai/search

访问边界: `user`. [AI.SmartSearch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L29)

参数: `Query q`

```go
JSON(http.StatusBadRequest, gin.H{"error": "搜索关键词不能为空"})
JSON(http.StatusOK, gin.H{
			"data": service.SearchIntent{
				Query:  query,
				Parsed: false,
			},
		})
JSON(http.StatusOK, gin.H{"data": intent})
```

### GET /api/cast/devices

访问边界: `user`. [Cast.ListDevices](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/cast.go#L18)

```go
JSON(http.StatusOK, gin.H{"data": devices})
```

### POST /api/cast/devices/refresh

访问边界: `user`. [Cast.RefreshDevices](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/cast.go#L24)

```go
JSON(http.StatusOK, gin.H{"message": "已触发设备发现，请稍后刷新列表"})
```

### POST /api/cast/start

访问边界: `user`. [Cast.CastMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/cast.go#L36)

```go
CastRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{
		"data":    session,
		"message": "投屏成功",
	})
```

### GET /api/cast/sessions

访问边界: `user`. [Cast.ListSessions](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/cast.go#L101)

```go
JSON(http.StatusOK, gin.H{"data": sessions})
```

### GET /api/cast/sessions/:sessionId

访问边界: `user`. [Cast.GetSession](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/cast.go#L88)

参数: `Param sessionId`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": session})
```

### POST /api/cast/sessions/:sessionId/control

访问边界: `user`. [Cast.ControlCast](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/cast.go#L69)

参数: `Param sessionId`

```go
ControlRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{"message": "操作成功"})
```

### DELETE /api/cast/sessions/:sessionId

访问边界: `user`. [Cast.StopSession](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/cast.go#L107)

参数: `Param sessionId`

```go
JSON(http.StatusOK, gin.H{"message": "已停止投屏"})
```

### POST /api/bookmarks

访问边界: `user`. [Bookmark.Create](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/bookmark.go#L27)

```go
CreateBookmarkRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusCreated, gin.H{"data": bookmark})
```

### GET /api/bookmarks

访问边界: `user`. [Bookmark.ListByUser](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/bookmark.go#L60)

参数: `DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取书签失败"})
JSON(http.StatusOK, gin.H{"data": bookmarks, "total": total, "page": page, "size": size})
```

### GET /api/bookmarks/media/:mediaId

访问边界: `user`. [Bookmark.ListByMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/bookmark.go#L46)

参数: `Param mediaId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取书签失败"})
JSON(http.StatusOK, gin.H{"data": bookmarks})
```

### PUT /api/bookmarks/:id

访问边界: `user`. [Bookmark.Update](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/bookmark.go#L94)

参数: `Param id`

```go
UpdateBookmarkRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "更新书签失败"})
JSON(http.StatusOK, gin.H{"message": "已更新"})
```

### DELETE /api/bookmarks/:id

访问边界: `user`. [Bookmark.Delete](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/bookmark.go#L75)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除书签失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/media/:id/comments

访问边界: `user`. [Comment.ListByMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/comment.go#L45)

参数: `Param id; DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取评论失败"})
JSON(http.StatusOK, gin.H{
		"data":         comments,
		"total":        total,
		"page":         page,
		"size":         size,
		"avg_rating":   avgRating,
		"rating_count": ratingCount,
	})
```

### POST /api/media/:id/comments

访问边界: `user`. [Comment.Create](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/comment.go#L25)

参数: `Param id`

```go
CreateCommentRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusCreated, gin.H{"data": comment})
```

### DELETE /api/comments/:id

访问边界: `user`. [Comment.Delete](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/comment.go#L70)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除评论失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/media/:id/danmaku

访问边界: `user`. [Danmaku.ListByMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/danmaku.go#L18)

参数: `Param id; DefaultQuery limit = 200`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取弹幕失败"})
JSON(http.StatusOK, gin.H{
		"data":  items,
		"total": len(items),
	})
```

### POST /api/stats/playback

访问边界: `user`. [Stats.RecordPlayback](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stats.go#L18)

```go
{
		MediaID      string  `json:"media_id" binding:"required"`
		WatchMinutes float64 `json:"watch_minutes" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
JSON(http.StatusInternalServerError, gin.H{"error": "记录失败"})
JSON(http.StatusOK, gin.H{"message": "ok"})
```

### GET /api/stats/me

访问边界: `user`. [Stats.GetUserStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stats.go#L40)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取统计失败"})
JSON(http.StatusOK, gin.H{"data": overview})
```

### POST /api/logs/playback-error

访问边界: `user`. [SystemLog.ReportPlaybackError](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/system_log.go#L166)

```go
{
		MediaID    string `json:"media_id"`
		MediaTitle string `json:"media_title"`
		Message    string `json:"message" binding:"required"`
		Detail     string `json:"detail"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "参数无效"})
JSON(http.StatusOK, gin.H{"message": "已记录"})
```

### GET /api/music/tracks

访问边界: `user`. [Music.ListTracks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L301)

参数: `Query library_id; DefaultQuery page = 1; DefaultQuery size = 50; DefaultQuery sort = artist`

```go
JSON(http.StatusOK, gin.H{"data": tracks, "total": total, "page": page, "size": size})
```

### GET /api/music/albums

访问边界: `user`. [Music.ListAlbums](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L315)

参数: `Query library_id; DefaultQuery page = 1; DefaultQuery size = 30`

```go
JSON(http.StatusOK, gin.H{"data": albums, "total": total, "page": page, "size": size})
```

### GET /api/music/albums/:id

访问边界: `user`. [Music.GetAlbum](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L328)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "专辑不存在"})
JSON(http.StatusOK, gin.H{"data": album})
```

### GET /api/music/search

访问边界: `user`. [Music.SearchMusic](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L338)

参数: `Query q; DefaultQuery limit = 20`

```go
JSON(http.StatusOK, gin.H{"data": tracks})
```

### GET /api/music/tracks/:id/lyrics

访问边界: `user`. [Music.GetLyrics](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L349)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": lyrics})
```

### POST /api/music/tracks/:id/love

访问边界: `user`. [Music.ToggleLove](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L359)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"loved": loved})
```

### GET /api/music/playlists

访问边界: `user`. [Music.ListPlaylists](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L386)

```go
JSON(http.StatusOK, gin.H{"data": playlists})
```

### POST /api/music/playlists

访问边界: `user`. [Music.CreatePlaylist](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L396)

```go
{
		Name string `json:"name"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"data": playlist})
```

### GET /api/music/playlists/:id

访问边界: `user`. [Music.GetPlaylist](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L413)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "播放列表不存在"})
JSON(http.StatusOK, gin.H{"data": playlist})
```

### POST /api/music/playlists/:id/tracks

访问边界: `user`. [Music.AddToPlaylist](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L423)

参数: `Param id`

```go
{
		TrackIDs []string `json:"track_ids"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "已添加到播放列表"})
```

### GET /api/photos

访问边界: `user`. [Photo.ListPhotos](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L446)

参数: `Query library_id; DefaultQuery page = 1; DefaultQuery size = 50; DefaultQuery sort = date_desc; Query album_id; Query tag; Query scene; Query favorite`

```go
JSON(http.StatusOK, gin.H{"data": photos, "total": total, "page": page, "size": size})
```

### GET /api/photos/:id

访问边界: `user`. [Photo.GetPhoto](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L467)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "照片不存在"})
JSON(http.StatusOK, gin.H{"data": photo})
```

### GET /api/photos/albums

访问边界: `user`. [Photo.ListAlbums](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L477)

```go
JSON(http.StatusOK, gin.H{"data": albums})
```

### POST /api/photos/albums

访问边界: `user`. [Photo.CreateAlbum](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L487)

```go
{
		Name        string `json:"name"`
		Description string `json:"description"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"data": album})
```

### POST /api/photos/albums/:id/photos

访问边界: `user`. [Photo.AddPhotosToAlbum](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L505)

参数: `Param id`

```go
{
		PhotoIDs []string `json:"photo_ids"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "照片已添加到相册"})
```

### POST /api/photos/:id/favorite

访问边界: `user`. [Photo.ToggleFavorite](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L521)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"is_favorite": fav})
```

### POST /api/photos/:id/rating

访问边界: `user`. [Photo.SetRating](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L531)

参数: `Param id`

```go
{
		Rating int `json:"rating"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "评分已更新"})
```

### GET /api/photos/search

访问边界: `user`. [Photo.SearchPhotos](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L547)

参数: `Query q; DefaultQuery limit = 50`

```go
JSON(http.StatusOK, gin.H{"data": photos})
```

### GET /api/photos/stats

访问边界: `user`. [Photo.GetStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L558)

参数: `Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/federation/search

访问边界: `user`. [Federation.SearchSharedMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L636)

参数: `Query q; DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusOK, gin.H{"data": media, "total": total})
```

### GET /api/federation/stream/:id

访问边界: `user`. [Federation.GetSharedMediaStream](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L648)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"stream_url": streamURL})
```

### POST /api/media/:id/ai/chapters

访问边界: `user`. [AIScene.GenerateChapters](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L18)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": task, "message": "章节生成任务已启动"})
```

### GET /api/media/:id/collection

访问边界: `user`. [Collection.GetMediaCollection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L25)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少媒体ID"})
JSON(http.StatusOK, gin.H{"data": nil})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/collections

访问边界: `user`. [Collection.ListCollections](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L62)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; DefaultQuery sort = created_desc; Query auto; Query library_id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取合集列表失败"})
JSON(http.StatusOK, gin.H{
		"data":  colls,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### GET /api/collections/search

访问边界: `user`. [Collection.SearchCollections](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L96)

参数: `Query keyword; DefaultQuery limit = 10`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少搜索关键词"})
JSON(http.StatusInternalServerError, gin.H{"error": "搜索失败"})
JSON(http.StatusOK, gin.H{"data": colls})
```

### GET /api/collections/:id

访问边界: `user`. [Collection.GetCollectionDetail](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L44)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少合集ID"})
JSON(http.StatusNotFound, gin.H{"error": "合集不存在"})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/collections/:id/poster

访问边界: `user`. [Collection.Poster](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L209)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少合集ID"})
String(http.StatusOK, collectionPosterPlaceholderSVG)
```

### GET /api/media/:id/chapters

访问边界: `user`. [AIScene.GetChapters](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L31)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取章节失败"})
JSON(http.StatusOK, gin.H{"data": chapters})
```

### POST /api/media/:id/ai/highlights

访问边界: `user`. [AIScene.ExtractHighlights](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L44)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": task, "message": "精彩片段提取任务已启动"})
```

### GET /api/media/:id/highlights

访问边界: `user`. [AIScene.GetHighlights](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L57)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取精彩片段失败"})
JSON(http.StatusOK, gin.H{"data": highlights})
```

### POST /api/media/:id/ai/covers

访问边界: `user`. [AIScene.GenerateCoverCandidates](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L70)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": task, "message": "封面候选生成任务已启动"})
```

### GET /api/media/:id/covers

访问边界: `user`. [AIScene.GetCoverCandidates](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L83)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取封面候选失败"})
JSON(http.StatusOK, gin.H{"data": candidates})
```

### POST /api/media/:id/covers/:candidateId/select

访问边界: `user`. [AIScene.SelectCover](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L96)

参数: `Param id; Param candidateId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "选择封面失败"})
JSON(http.StatusOK, gin.H{"message": "封面已选择"})
```

### POST /api/media/:id/covers/apply

访问边界: `user`. [AIScene.ApplyCover](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L109)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"message": "封面已应用"})
```

### GET /api/media/:id/ai/tasks

访问边界: `user`. [AIScene.GetAnalysisTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L121)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取分析任务失败"})
JSON(http.StatusOK, gin.H{"data": tasks})
```

### GET /api/ai/tasks/:taskId

访问边界: `user`. [AIScene.GetAnalysisTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_scene.go#L134)

参数: `Param taskId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取任务失败"})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /internal/video-analysis/source/:id

访问边界: `separate/public`. [Stream.AnalysisSource](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stream.go#L24)

### OPTIONS /api/admin/settings/douban/import

访问边界: `separate/public`. 静态资源/健康/预检内联处理器，见主路由。

### POST /api/admin/settings/douban/import

访问边界: `separate/public`. [Admin.ImportDoubanCookie](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L768)

参数: `Query token`

```go
ImportDoubanCookieRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少 token 参数"})
JSON(http.StatusBadRequest, gin.H{"error": "token 无效或已过期，请回到后台重新生成"})
JSON(http.StatusBadRequest, gin.H{"error": "此导入链接已被使用，请重新生成"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 Cookie 字段"})
JSON(http.StatusBadRequest, gin.H{"error": "Cookie 长度异常，请确认已在豆瓣登录"})
JSON(http.StatusBadRequest, gin.H{"error": "Cookie 中缺少豆瓣登录凭证 dbcl2（浏览器已将其标记为 HttpOnly，JS / Bookmarklet 无法读取）。请改用方式 3：安装 Cookie-Editor / EditThisCookie 扩展导出完整 Cookie"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"success":  true,
			"username": username,
			"message":  msg,
		},
	})
```

### GET /api/admin/users

访问边界: `admin`. [Admin.ListUsers](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L44)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取用户列表失败"})
JSON(http.StatusOK, gin.H{"data": users})
```

### POST /api/admin/users

访问边界: `admin`. [Admin.CreateUser](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L54)

```go
service.CreateUserRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusConflict, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "创建用户失败"})
JSON(http.StatusCreated, gin.H{"data": user})
```

### PUT /api/admin/users/:id

访问边界: `admin`. [Admin.UpdateUser](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L76)

参数: `Param id`

```go
service.UpdateUserRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "更新用户失败"})
JSON(http.StatusOK, gin.H{"data": user})
```

### POST /api/admin/users/:id/disabled

访问边界: `admin`. [Admin.SetUserDisabled](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L101)

参数: `Param id`

```go
{
		Disabled bool `json:"disabled"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "不能禁用自己"})
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "操作失败"})
JSON(http.StatusOK, gin.H{"message": "已更新"})
```

### DELETE /api/admin/users/:id

访问边界: `admin`. [Admin.DeleteUser](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L137)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "不能删除自己"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "删除用户失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### PUT /api/admin/users/:id/password

访问边界: `admin`. [Admin.ResetUserPassword](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L163)

参数: `Param id`

```go
{
		NewPassword            string `json:"new_password" binding:"required,min=6,max=64"`
		ForceChangeOnNextLogin *bool  `json:"force_change_on_next_login"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效，新密码至少6位"})
JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "重置密码失败"})
JSON(http.StatusOK, gin.H{"message": "密码已重置"})
```

### GET /api/admin/login-logs

访问边界: `admin`. [Admin.ListLoginLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L196)

参数: `Query only_failed`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}, "total": 0})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": logs, "total": total, "page": page, "size": size})
```

### GET /api/admin/audit-logs

访问边界: `admin`. [Admin.ListAuditLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L212)

参数: `Query action`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}, "total": 0})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": logs, "total": total, "page": page, "size": size})
```

### GET /api/admin/invite-codes

访问边界: `admin`. [Admin.ListInviteCodes](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L230)

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": codes})
```

### POST /api/admin/invite-codes

访问边界: `admin`. [Admin.CreateInviteCode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L244)

```go
{
		Code      string `json:"code"`
		MaxUses   int    `json:"max_uses"`
		ExpiresIn int    `json:"expires_in_hours"` // 0 = 永不过期
		Note      string `json:"note"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "生成邀请码失败"})
JSON(http.StatusInternalServerError, gin.H{"error": "创建失败（可能邀请码已存在）"})
JSON(http.StatusCreated, gin.H{"data": ic})
```

### DELETE /api/admin/invite-codes/:id

访问边界: `admin`. [Admin.DeleteInviteCode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L288)

参数: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/admin/system

访问边界: `admin`. [Admin.SystemInfo](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L333)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"version":    version.Current(),
			"go_version": runtime.Version(),
			"os":         runtime.GOOS,
			"arch":       runtime.GOARCH,
			"cpus":       runtime.NumCPU(),
			"goroutines": runtime.NumGoroutine(),
			"memory":     sysMem,
			"hw_accel":   h.transcodeService.GetHWAccelInfo(),
		},
	})
```

### GET /api/admin/transcode/status

访问边界: `admin`. [Admin.TranscodeStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L368)

```go
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/admin/transcode/throttle

访问边界: `admin`. [Admin.TranscodeThrottleStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L392)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### POST /api/admin/transcode/:taskId/cancel

访问边界: `admin`. [Admin.CancelTranscode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L398)

参数: `Param taskId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "任务ID不能为空"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "转码任务已取消"})
```

### GET /api/admin/transcode-tasks

访问边界: `admin`. [Admin.ListTranscodeTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L424)

参数: `DefaultQuery page = 1; DefaultQuery page_size = 20; Query status`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"tasks":     tasks,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
```

### GET /api/admin/transcode-tasks/statistics

访问边界: `admin`. [Admin.GetTranscodeStatistics](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L452)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### POST /api/admin/transcode-tasks/batch-cancel

访问边界: `admin`. [Admin.BatchCancelTranscodeTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L492)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量取消完成",
		"data":    gin.H{"cancelled": cancelled},
	})
```

### POST /api/admin/transcode-tasks/batch-delete

访问边界: `admin`. [Admin.BatchDeleteTranscodeTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L508)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量删除完成",
		"data":    gin.H{"deleted": deleted},
	})
```

### POST /api/admin/transcode-tasks/batch-retry

访问边界: `admin`. [Admin.BatchRetryTranscodeTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L528)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量重试完成",
		"data":    gin.H{"retried": retried},
	})
```

### POST /api/admin/transcode-tasks/batch-submit

访问边界: `admin`. [Admin.BatchSubmitTranscodeTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L554)

```go
{
		MediaIDs  []string `json:"media_ids" binding:"required"`
		Qualities []string `json:"qualities"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_ids"})
JSON(http.StatusBadRequest, gin.H{"error": "media_ids 不能为空"})
JSON(http.StatusOK, gin.H{
		"message": "批量转码任务已提交",
		"data": gin.H{
			"submitted": submitted,
			"skipped":   skipped,
			"tasks":     tasks,
			"errors":    errs,
		},
	})
```

### POST /api/admin/transcode-tasks/:id/cancel

访问边界: `admin`. [Admin.CancelTranscodeTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L458)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "任务ID不能为空"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已取消"})
```

### POST /api/admin/transcode-tasks/:id/retry

访问边界: `admin`. [Admin.RetryTranscodeTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L472)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已重新提交"})
```

### DELETE /api/admin/transcode-tasks/:id

访问边界: `admin`. [Admin.DeleteTranscodeTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin.go#L482)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已删除"})
```

### GET /api/admin/settings/tmdb

访问边界: `admin`. [Admin.GetTMDbConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L17)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"configured":               configured,
			"masked_key":               maskedKey,
			"api_proxy":                h.cfg.GetTMDbAPIProxy(),
			"image_proxy":              h.cfg.GetTMDbImageProxy(),
			"network_proxy":            h.cfg.GetTMDbNetworkProxy(),
			"api_proxy_base_url":       h.cfg.GetTMDbAPIProxy(),
			"image_proxy_base_url":     h.cfg.GetTMDbImageProxy(),
			"network_proxy_configured": h.cfg.GetTMDbNetworkProxy() != "",
		},
	})
```

### PUT /api/admin/settings/tmdb

访问边界: `admin`. [Admin.UpdateTMDbConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L41)

```go
UpdateTMDbConfigRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供有效的 API Key"})
JSON(http.StatusBadRequest, gin.H{"error": "API Key 格式不正确，请检查后重试"})
JSON(http.StatusOK, gin.H{
		"message": "TMDb API Key 已保存",
		"data": gin.H{
			"configured": true,
			"masked_key": h.cfg.GetTMDbAPIKeyMasked(),
		},
	})
```

### DELETE /api/admin/settings/tmdb

访问边界: `admin`. [Admin.ClearTMDbConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L71)

```go
JSON(http.StatusOK, gin.H{
		"message": "TMDb API Key 已清除",
		"data": gin.H{
			"configured": false,
			"masked_key": "",
		},
	})
```

### GET /api/admin/settings/tmdb/validate

访问边界: `admin`. [Admin.ValidateTMDbConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L92)

```go
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"valid":   false,
				"message": "尚未配置 TMDb API Key，请先填写并保存",
			},
		})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"valid":   ok,
			"message": msg,
		},
	})
```

### POST /api/admin/settings/tmdb/test

访问边界: `admin`. [Admin.TestTMDbAPIKey](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L122)

```go
TestTMDbAPIKeyRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供要测试的 api_key"})
JSON(http.StatusBadRequest, gin.H{"error": "API Key 格式不正确，请检查后重试"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"valid":   ok,
			"message": msg,
		},
	})
```

### PUT /api/admin/settings/tmdb/proxy

访问边界: `admin`. [Admin.UpdateTMDbProxy](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_tmdb_proxy.go#L38)

```go
UpdateTMDbProxyRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求体格式错误"})
JSON(http.StatusBadRequest, gin.H{"error": "API 反向代理无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "图片反向代理无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "HTTP/SOCKS 网络代理无效: " + err.Error()})
JSON(http.StatusOK, gin.H{"message": "TMDb 连接配置已保存，立即生效", "data": gin.H{
		"api_proxy": apiProxy, "image_proxy": imageProxy, "network_proxy": networkProxy,
	}})
```

### DELETE /api/admin/settings/tmdb/proxy

访问边界: `admin`. [Admin.ClearTMDbProxy](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_tmdb_proxy.go#L79)

```go
JSON(http.StatusOK, gin.H{"message": "已恢复 TMDb 官方直连", "data": gin.H{
		"api_proxy": "", "image_proxy": "", "network_proxy": "",
	}})
```

### POST /api/admin/settings/tmdb/proxy/test

访问边界: `admin`. [Admin.TestTMDbProxy](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_tmdb_proxy.go#L97)

```go
TestTMDbProxyRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "API 反向代理无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "图片反向代理无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "HTTP/SOCKS 网络代理无效: " + err.Error()})
JSON(http.StatusOK, gin.H{"data": gin.H{
		"api":     gin.H{"ok": apiOK, "message": apiMsg, "target": fallback(apiProxy, "https://api.themoviedb.org")},
		"image":   gin.H{"ok": imageOK, "message": imageMsg, "target": fallback(imageProxy, "https://image.tmdb.org")},
		"network": gin.H{"ok": networkOK, "configured": networkProxy != "", "message": networkMsg, "target": fallback(displayProxyURL(networkProxy), "官方直连")},
	}})
```

### GET /api/admin/settings/system

访问边界: `admin`. [Admin.GetSystemSettings](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L181)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取系统设置失败"})
JSON(http.StatusOK, gin.H{"data": settings})
```

### PUT /api/admin/settings/system

访问边界: `admin`. [Admin.UpdateSystemSettings](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L206)

```go
UpdateSystemSettingsRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": "未提供任何设置项"})
JSON(http.StatusInternalServerError, gin.H{"error": "保存设置失败"})
```

### PUT /api/admin/settings/observability/pprof

访问边界: `admin`. [Admin.SetPprofEnabled](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L671)

```go
{
		Enabled *bool `json:"enabled"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": observability.PprofEnabled()}})
```

### GET /api/admin/strm/config

访问边界: `admin`. [Admin.GetSTRMConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_strm.go#L14)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "配置未加载"})
JSON(http.StatusOK, gin.H{"data": h.cfg.STRMSnapshot()})
```

### PUT /api/admin/strm/config

访问边界: `admin`. [Admin.UpdateSTRMConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_strm.go#L37)

```go
config.STRMConfig
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "配置未加载"})
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "connect_timeout 必须在 0-600 之间"})
JSON(http.StatusBadRequest, gin.H{"error": "remote_probe_timeout 必须在 0-120 之间"})
JSON(http.StatusOK, gin.H{
		"message": "STRM 配置已更新",
		"data":    h.cfg.STRMSnapshot(),
	})
```

### GET /api/admin/system-logs

访问边界: `admin`. [SystemLog.ListSystemLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/system_log.go#L25)

参数: `DefaultQuery page = 1; DefaultQuery size = 50; Query type; Query level; Query keyword; Query method; Query path; Query user_id; Query media_id; Query start; Query end; Query min_status; Query max_status`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "查询日志失败"})
JSON(http.StatusOK, gin.H{
		"data":  logs,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### GET /api/admin/system-logs/stats

访问边界: `admin`. [SystemLog.GetSystemLogStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/system_log.go#L73)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取统计失败"})
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/system-logs/export

访问边界: `admin`. [SystemLog.ExportSystemLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/system_log.go#L84)

参数: `DefaultQuery max_rows = 5000; Query type; Query level; Query keyword; Query method; Query start; Query end`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "导出失败"})
```

### POST /api/admin/system-logs/clean

访问边界: `admin`. [SystemLog.CleanSystemLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/system_log.go#L143)

```go
{
		Days int `json:"days" binding:"required,min=1"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请指定保留天数（最少1天）"})
JSON(http.StatusInternalServerError, gin.H{"error": "清理失败"})
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已清理 %d 条日志（保留最近 %d 天）", deleted, req.Days),
		"deleted": deleted,
	})
```

### POST /api/admin/batch/scan

访问边界: `admin`. [Admin.BatchScan](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L26)

```go
BatchScanRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{
		"message": "批量扫描已启动",
		"started": started,
		"errors":  errors,
	})
```

### POST /api/admin/batch/scrape

访问边界: `admin`. [Admin.BatchScrape](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L56)

```go
BatchScrapeRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{
		"message": "批量刮削已启动",
		"total":   len(req.MediaIDs),
	})
```

### GET /api/admin/permissions/:userId

访问边界: `admin`. [Admin.GetUserPermission](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L102)

参数: `Param userId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取权限失败"})
JSON(http.StatusOK, gin.H{"data": perm})
```

### PUT /api/admin/permissions/:userId

访问边界: `admin`. [Admin.UpdateUserPermission](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L120)

参数: `Param userId`

```go
UpdateUserPermissionRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "更新权限失败"})
JSON(http.StatusOK, gin.H{"message": "权限已更新"})
```

### GET /api/admin/rating/:mediaId

访问边界: `admin`. [Admin.GetContentRating](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L161)

参数: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"media_id": mediaID, "level": ""}})
JSON(http.StatusOK, gin.H{"data": gin.H{"media_id": mediaID, "level": level}})
```

### PUT /api/admin/rating/:mediaId

访问边界: `admin`. [Admin.SetContentRating](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L143)

参数: `Param mediaId`

```go
SetContentRatingRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "分级已设置"})
```

### GET /api/admin/metadata/search

访问边界: `admin`. [Admin.SearchMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L156)

参数: `Query q; DefaultQuery type = movie; Query year`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供搜索关键词"})
JSON(http.StatusOK, gin.H{"data": results})
```

### POST /api/admin/media/:mediaId/match

访问边界: `admin`. [Admin.MatchMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L180)

参数: `Param mediaId`

```go
MatchMetadataRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{"message": "元数据已关联"})
```

### POST /api/admin/media/:mediaId/unmatch

访问边界: `admin`. [Admin.UnmatchMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L198)

参数: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"message": "已解除元数据匹配"})
```

### PUT /api/admin/media/:mediaId/metadata

访问边界: `admin`. [Admin.UpdateMediaMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L151)

参数: `Param mediaId`

```go
UpdateMediaMetadataRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusNotFound, gin.H{"error": "影片不存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "更新元数据失败"})
JSON(http.StatusOK, gin.H{"message": "元数据已更新", "data": media})
```

### DELETE /api/admin/media/:mediaId

访问边界: `admin`. [Admin.DeleteMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L17)

参数: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"message": "影片已删除"})
```

### GET /api/admin/media/:mediaId/strm

访问边界: `admin`. [Admin.GetMediaSTRM](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L126)

参数: `Param mediaId`

```go
JSON(http.StatusNotFound, gin.H{"error": "影片不存在"})
JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":                 media.ID,
		"title":              media.Title,
		"is_strm":            media.StreamURL != "",
		"stream_url":         media.StreamURL,
		"stream_ua":          media.StreamUA,
		"stream_referer":     media.StreamReferer,
		"stream_cookie":      media.StreamCookie,
		"stream_headers":     hdrMap,
		"stream_refresh_url": media.StreamRefreshURL,
	}})
```

### PUT /api/admin/media/:mediaId/strm

访问边界: `admin`. [Admin.UpdateMediaSTRM](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L61)

参数: `Param mediaId`

```go
UpdateMediaSTRMRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusNotFound, gin.H{"error": "影片不存在"})
JSON(http.StatusBadRequest, gin.H{"error": "该影片不是 STRM 远程流，无法覆写"})
JSON(http.StatusOK, gin.H{
		"message": "STRM 请求头已更新",
		"data": gin.H{
			"id":             media.ID,
			"stream_url":     media.StreamURL,
			"stream_ua":      media.StreamUA,
			"stream_referer": media.StreamReferer,
			"stream_cookie":  media.StreamCookie,
			"stream_headers": media.StreamHeaders,
		},
	})
```

### POST /api/admin/series/:seriesId/match

访问边界: `admin`. [Admin.MatchSeriesMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L212)

参数: `Param seriesId`

```go
{
		TMDbID int `json:"tmdb_id" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 tmdb_id"})
JSON(http.StatusOK, gin.H{"message": "元数据已关联"})
```

### POST /api/admin/series/:seriesId/unmatch

访问边界: `admin`. [Admin.UnmatchSeriesMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L232)

参数: `Param seriesId`

```go
JSON(http.StatusOK, gin.H{"message": "已解除元数据匹配"})
```

### POST /api/admin/series/:seriesId/scrape

访问边界: `admin`. [Admin.ScrapeSeriesMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L244)

参数: `Param seriesId`

```go
JSON(http.StatusOK, gin.H{"message": "元数据已刷新"})
```

### PUT /api/admin/series/:seriesId/metadata

访问边界: `admin`. [Admin.UpdateSeriesMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L222)

参数: `Param seriesId`

```go
UpdateSeriesMetadataRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusNotFound, gin.H{"error": "剧集合集不存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "更新元数据失败"})
JSON(http.StatusOK, gin.H{"message": "元数据已更新", "data": series})
```

### DELETE /api/admin/series/:seriesId

访问边界: `admin`. [Admin.DeleteSeries](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L274)

参数: `Param seriesId`

```go
JSON(http.StatusOK, gin.H{"message": "剧集已删除"})
```

### POST /api/admin/series/merge

访问边界: `admin`. [Admin.MergeSeries](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L412)

```go
MergeSeriesRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "至少需要一个待合并的从属剧集 ID"})
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已成功合并 %d 个剧集系列", result.MergedCount),
		"data":    result,
	})
```

### POST /api/admin/series/auto-merge

访问边界: `admin`. [Admin.AutoMergeSeries](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L439)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("自动合并完成: 处理了 %d 个系列组, 共合并 %d 个重复记录", len(results), totalMerged),
		"data": gin.H{
			"groups_processed": len(results),
			"total_merged":     totalMerged,
			"details":          results,
		},
	})
```

### GET /api/admin/series/merge-candidates

访问边界: `admin`. [Admin.MergeCandidates](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L464)

```go
JSON(http.StatusOK, gin.H{
		"data":  groups,
		"total": len(groups),
	})
```

### GET /api/admin/images/tmdb

访问边界: `admin`. [Admin.SearchTMDbImages](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L288)

参数: `DefaultQuery type = movie; Query tmdb_id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供有效的 tmdb_id"})
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/media/:mediaId/image/upload

访问边界: `admin`. [Admin.UploadMediaImage](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L306)

参数: `Param mediaId; DefaultQuery type = poster`

```go
JSON(http.StatusBadRequest, gin.H{"error": "type 必须为 poster 或 backdrop"})
JSON(http.StatusBadRequest, gin.H{"error": "请上传图片文件"})
JSON(http.StatusBadRequest, gin.H{"error": "图片文件过大，最大支持10MB"})
JSON(http.StatusBadRequest, gin.H{"error": "仅支持 JPG、PNG、WebP 格式"})
JSON(http.StatusInternalServerError, gin.H{"error": "读取上传文件失败"})
JSON(http.StatusInternalServerError, gin.H{"error": "读取上传文件失败"})
JSON(http.StatusOK, gin.H{"message": "图片已更新", "path": localPath})
```

### POST /api/admin/media/:mediaId/image/url

访问边界: `admin`. [Admin.SetMediaImageByURL](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L406)

参数: `Param mediaId`

```go
{
		URL       string `json:"url" binding:"required"`
		ImageType string `json:"image_type"` // poster 或 backdrop
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供图片URL"})
JSON(http.StatusBadRequest, gin.H{"error": "image_type 必须为 poster 或 backdrop"})
JSON(http.StatusOK, gin.H{"message": "图片已更新", "path": localPath})
```

### POST /api/admin/media/:mediaId/image/tmdb

访问边界: `admin`. [Admin.SetMediaImageFromTMDb](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L466)

参数: `Param mediaId`

```go
{
		TMDbPath  string `json:"tmdb_path" binding:"required"` // TMDb图片路径，如 /abc123.jpg
		ImageType string `json:"image_type"`                   // poster 或 backdrop
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 tmdb_path"})
JSON(http.StatusOK, gin.H{"message": "图片已更新", "path": localPath})
```

### POST /api/admin/series/:seriesId/image/upload

访问边界: `admin`. [Admin.UploadSeriesImage](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L357)

参数: `Param seriesId; DefaultQuery type = poster`

```go
JSON(http.StatusBadRequest, gin.H{"error": "type 必须为 poster 或 backdrop"})
JSON(http.StatusBadRequest, gin.H{"error": "请上传图片文件"})
JSON(http.StatusBadRequest, gin.H{"error": "图片文件过大，最大支持10MB"})
JSON(http.StatusBadRequest, gin.H{"error": "仅支持 JPG、PNG、WebP 格式"})
JSON(http.StatusInternalServerError, gin.H{"error": "读取上传文件失败"})
JSON(http.StatusInternalServerError, gin.H{"error": "读取上传文件失败"})
JSON(http.StatusOK, gin.H{"message": "图片已更新", "path": localPath})
```

### POST /api/admin/series/:seriesId/image/url

访问边界: `admin`. [Admin.SetSeriesImageByURL](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L436)

参数: `Param seriesId`

```go
{
		URL       string `json:"url" binding:"required"`
		ImageType string `json:"image_type"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供图片URL"})
JSON(http.StatusBadRequest, gin.H{"error": "image_type 必须为 poster 或 backdrop"})
JSON(http.StatusOK, gin.H{"message": "图片已更新", "path": localPath})
```

### POST /api/admin/series/:seriesId/image/tmdb

访问边界: `admin`. [Admin.SetSeriesImageFromTMDb](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_media.go#L492)

参数: `Param seriesId`

```go
{
		TMDbPath  string `json:"tmdb_path" binding:"required"`
		ImageType string `json:"image_type"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 tmdb_path"})
JSON(http.StatusOK, gin.H{"message": "图片已更新", "path": localPath})
```

### GET /api/admin/fs/browse

访问边界: `admin`. [Admin.BrowseFS](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L261)

参数: `DefaultQuery path = /; Query include_files`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权浏览该目录，仅允许浏览媒体库相关路径"})
JSON(http.StatusBadRequest, gin.H{"error": "无法读取目录: " + err.Error()})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"current": dir,
			"parent":  parent,
			"items":   items,
		},
	})
```

### GET /api/admin/storage/webdav

访问边界: `admin`. [Storage.GetWebDAVConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage.go#L37)

```go
JSON(http.StatusOK, gin.H{"data": response})
```

### PUT /api/admin/storage/webdav

访问边界: `admin`. [Storage.UpdateWebDAVConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage.go#L76)

```go
UpdateWebDAVConfigRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "启用 WebDAV 时必须提供服务器地址"})
JSON(http.StatusBadRequest, gin.H{"error": "超时时间必须大于0"})
JSON(http.StatusOK, gin.H{"message": "WebDAV 配置已更新"})
```

### POST /api/admin/storage/webdav/test

访问边界: `admin`. [Storage.TestWebDAVConnection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage.go#L142)

```go
TestWebDAVConnectionRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "连接测试失败: " + err.Error()})
JSON(http.StatusOK, gin.H{"message": "WebDAV 连接测试成功"})
```

### GET /api/admin/storage/webdav/status

访问边界: `admin`. [Storage.GetWebDAVStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage.go#L172)

```go
JSON(http.StatusOK, gin.H{"data": status})
```

### GET /api/admin/storage/browse

访问边界: `admin`. [Storage.BrowseRemoteDir](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage.go#L178)

参数: `Query type; DefaultQuery path = /`

```go
JSON(http.StatusBadRequest, gin.H{"error": "浏览远程目录失败: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "浏览远程目录失败: " + err.Error()})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"current": dir,
			"parent":  parent,
			"items":   items,
		},
	})
```

### GET /api/admin/storage/alist

访问边界: `admin`. [Storage.GetAlistConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage_remote.go#L24)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{
		"enabled":            cfg.Enabled,
		"server_url":         cfg.ServerURL,
		"username":           cfg.Username,
		"password":           h.maskPassword(cfg.Password),
		"token":              h.maskPassword(cfg.Token),
		"base_path":          cfg.BasePath,
		"timeout":            cfg.Timeout,
		"enable_cache":       cfg.EnableCache,
		"cache_ttl_hours":    cfg.CacheTTLHours,
		"read_block_size_mb": cfg.ReadBlockSizeMB,
		"read_block_count":   cfg.ReadBlockCount,
	}})
```

### PUT /api/admin/storage/alist

访问边界: `admin`. [Storage.UpdateAlistConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage_remote.go#L57)

```go
UpdateAlistConfigRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "启用 Alist 时必须提供服务器地址"})
JSON(http.StatusOK, gin.H{"message": "Alist 配置已更新"})
```

### POST /api/admin/storage/alist/test

访问边界: `admin`. [Storage.TestAlistConnection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage_remote.go#L125)

```go
TestAlistRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "连接测试失败: " + err.Error()})
JSON(http.StatusOK, gin.H{"message": "Alist 连接测试成功"})
```

### GET /api/admin/storage/alist/status

访问边界: `admin`. [Storage.GetAlistStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage_remote.go#L107)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false, "connected": false}})
JSON(http.StatusOK, gin.H{"data": h.remoteStorageService.GetAlistStatus()})
```

### GET /api/admin/storage/s3

访问边界: `admin`. [Storage.GetS3Config](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage_remote.go#L157)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{
		"enabled":            cfg.Enabled,
		"endpoint":           cfg.Endpoint,
		"region":             cfg.Region,
		"access_key":         cfg.AccessKey,
		"secret_key":         h.maskPassword(cfg.SecretKey),
		"bucket":             cfg.Bucket,
		"base_path":          cfg.BasePath,
		"path_style":         cfg.PathStyle,
		"timeout":            cfg.Timeout,
		"enable_cache":       cfg.EnableCache,
		"cache_ttl_hours":    cfg.CacheTTLHours,
		"read_block_size_mb": cfg.ReadBlockSizeMB,
		"read_block_count":   cfg.ReadBlockCount,
	}})
```

### PUT /api/admin/storage/s3

访问边界: `admin`. [Storage.UpdateS3Config](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage_remote.go#L194)

```go
UpdateS3ConfigRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "启用 S3 时必须提供 Endpoint 和 Bucket"})
JSON(http.StatusOK, gin.H{"message": "S3 配置已更新"})
```

### POST /api/admin/storage/s3/test

访问边界: `admin`. [Storage.TestS3Connection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage_remote.go#L264)

```go
TestS3Request
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "Secret Key 不能为空"})
JSON(http.StatusBadRequest, gin.H{"error": "连接测试失败: " + err.Error()})
JSON(http.StatusOK, gin.H{"message": "S3 连接测试成功"})
```

### GET /api/admin/storage/s3/status

访问边界: `admin`. [Storage.GetS3Status](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/storage_remote.go#L244)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false, "connected": false}})
JSON(http.StatusOK, gin.H{"data": h.remoteStorageService.GetS3Status()})
```

### POST /api/admin/system/clear-data

访问边界: `admin`. [Admin.ClearAllData](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_system.go#L518)

```go
ClearAllDataRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效，需要提供确认标识"})
JSON(http.StatusBadRequest, gin.H{"error": "确认标识不正确，请传入 CONFIRM_CLEAR_ALL 以确认操作"})
JSON(http.StatusUnauthorized, gin.H{"error": "无法获取当前用户信息"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"status":        status,
			"message":       message,
			"total_cleared": totalCleared,
			"success_count": successCount,
			"error_count":   errorCount,
			"details":       results,
		},
	})
```

### GET /api/admin/metadata/bangumi/search

访问边界: `admin`. [Admin.SearchBangumi](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L358)

参数: `Query q; DefaultQuery type = 2; Query year`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供搜索关键词"})
JSON(http.StatusOK, gin.H{"data": results})
```

### GET /api/admin/metadata/bangumi/subject/:subjectId

访问边界: `admin`. [Admin.GetBangumiSubject](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L382)

参数: `Param subjectId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供有效的 Bangumi 条目 ID"})
JSON(http.StatusOK, gin.H{"data": subject})
```

### POST /api/admin/media/:mediaId/match/bangumi

访问边界: `admin`. [Admin.MatchMediaBangumi](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L399)

参数: `Param mediaId`

```go
{
		BangumiID int `json:"bangumi_id" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 bangumi_id"})
JSON(http.StatusOK, gin.H{"message": "已关联 Bangumi 元数据"})
```

### POST /api/admin/series/:seriesId/match/bangumi

访问边界: `admin`. [Admin.MatchSeriesBangumi](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L419)

参数: `Param seriesId`

```go
{
		BangumiID int `json:"bangumi_id" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 bangumi_id"})
JSON(http.StatusOK, gin.H{"message": "已关联 Bangumi 元数据"})
```

### GET /api/admin/settings/bangumi

访问边界: `admin`. [Admin.GetBangumiConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L439)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"configured":   configured,
			"masked_token": maskedToken,
		},
	})
```

### PUT /api/admin/settings/bangumi

访问边界: `admin`. [Admin.UpdateBangumiConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L460)

```go
{
		AccessToken string `json:"access_token" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 Access Token"})
JSON(http.StatusOK, gin.H{
		"message": "Bangumi Access Token 已保存",
		"data": gin.H{
			"configured": true,
		},
	})
```

### DELETE /api/admin/settings/bangumi

访问边界: `admin`. [Admin.ClearBangumiConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L485)

```go
JSON(http.StatusOK, gin.H{
		"message": "Bangumi Access Token 已清除",
		"data": gin.H{
			"configured": false,
		},
	})
```

### GET /api/admin/metadata/douban/search

访问边界: `admin`. [Admin.SearchDouban](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L258)

参数: `Query q; Query year`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供搜索关键词"})
JSON(http.StatusOK, gin.H{"data": results})
```

### POST /api/admin/media/:mediaId/match/douban

访问边界: `admin`. [Admin.MatchMediaDouban](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L276)

参数: `Param mediaId`

```go
{
		DoubanID string `json:"douban_id" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 douban_id"})
JSON(http.StatusOK, gin.H{"message": "已关联豆瓣元数据"})
```

### POST /api/admin/series/:seriesId/match/douban

访问边界: `admin`. [Admin.MatchSeriesDouban](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L296)

参数: `Param seriesId`

```go
{
		DoubanID string `json:"douban_id" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 douban_id"})
JSON(http.StatusOK, gin.H{"message": "已关联豆瓣元数据"})
```

### GET /api/admin/settings/douban

访问边界: `admin`. [Admin.GetDoubanConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L504)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"configured":    configured,
			"masked_cookie": maskedCookie,
		},
	})
```

### PUT /api/admin/settings/douban

访问边界: `admin`. [Admin.UpdateDoubanConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L522)

```go
UpdateDoubanConfigRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供有效的 Cookie 字符串"})
JSON(http.StatusBadRequest, gin.H{"error": "Cookie 格式不正确，请复制浏览器中完整的 Cookie 字符串"})
JSON(http.StatusBadRequest, gin.H{"error": "Cookie 中缺少豆瓣登录凭证 dbcl2（通常被 HttpOnly 保护，JS 无法读取）。请使用浏览器扩展 Cookie-Editor / EditThisCookie 导出完整 Cookie 后再粘贴"})
JSON(http.StatusOK, gin.H{
		"message": "豆瓣 Cookie 已保存",
		"data": gin.H{
			"configured":    true,
			"masked_cookie": h.cfg.GetDoubanCookieMasked(),
		},
	})
```

### DELETE /api/admin/settings/douban

访问边界: `admin`. [Admin.ClearDoubanConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L559)

```go
JSON(http.StatusOK, gin.H{
		"message": "豆瓣 Cookie 已清除",
		"data": gin.H{
			"configured":    false,
			"masked_cookie": "",
		},
	})
```

### POST /api/admin/settings/douban/validate

访问边界: `admin`. [Admin.ValidateDoubanConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L577)

```go
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"valid":   false,
				"message": "未配置 Cookie，当前为匿名模式",
			},
		})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"valid":   false,
				"message": "校验失败: " + err.Error(),
			},
		})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"valid":   false,
				"message": msg,
			},
		})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"valid":    true,
			"username": username,
			"message":  msg,
		},
	})
```

### POST /api/admin/settings/douban/import-token

访问边界: `admin`. [Admin.CreateDoubanImportToken](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L668)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"token":       token,
			"expires_in":  int(doubanImportTokenTTL.Seconds()),
			"expires_at":  doubanImportTokens[token].ExpiresAt.Unix(),
			"import_url":  importURL,
			"bookmarklet": bookmarklet,
			"script":      script,
			"douban_url":  "https://www.douban.com/",
		},
	})
```

### GET /api/admin/settings/douban/import-token

访问边界: `admin`. [Admin.GetDoubanImportTokenStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L715)

参数: `Query token`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少 token 参数"})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"status":  "expired",
				"message": "token 已过期或不存在，请重新生成",
			},
		})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"status":         status,
			"message":        item.Message,
			"username":       item.Username,
			"expires_at":     item.ExpiresAt.Unix(),
			"remaining_secs": int(time.Until(item.ExpiresAt).Seconds()),
		},
	})
```

### GET /api/admin/metadata/thetvdb/search

访问边界: `admin`. [Admin.SearchTheTVDB](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L318)

参数: `Query q; Query year`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供搜索关键词"})
JSON(http.StatusOK, gin.H{"data": results})
```

### POST /api/admin/series/:seriesId/match/thetvdb

访问边界: `admin`. [Admin.MatchSeriesTheTVDB](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/admin_metadata.go#L336)

参数: `Param seriesId`

```go
{
		TVDBID int `json:"tvdb_id" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 tvdb_id"})
JSON(http.StatusOK, gin.H{"message": "已关联 TheTVDB 元数据"})
```

### GET /api/admin/ai/status

访问边界: `admin`. [AI.GetAIStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L52)

```go
JSON(http.StatusOK, gin.H{"data": status})
```

### PUT /api/admin/ai/config

访问边界: `admin`. [AI.UpdateAIConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L58)

```go
map
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "AI 配置已更新", "data": status})
```

### POST /api/admin/ai/auto-pilot

访问边界: `admin`. [AI.EnableAutoPilot](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L147)

```go
{
		Provider string `json:"provider"`
		APIKey   string `json:"api_key"`
	}
```

```go
JSON(http.StatusOK, gin.H{
		"message": "AI 全自动托管模式已开启",
		"data":    status,
	})
```

### POST /api/admin/ai/test

访问边界: `admin`. [AI.TestAIConnection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L75)

```go
{
		ProviderID string `json:"provider_id"` // 为空时测试当前激活的
	}
```

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"success": false, "error": err.Error()}})
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/ai/desensitize/test

访问边界: `admin`. [AI.TestDesensitizeConnection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L90)

```go
JSON(http.StatusOK, gin.H{"data": result})
```

### DELETE /api/admin/ai/cache

访问边界: `admin`. [AI.ClearAICache](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L96)

```go
JSON(http.StatusOK, gin.H{
		"message": "AI 缓存已清空",
		"data":    gin.H{"cleared": count},
	})
```

### GET /api/admin/ai/cache

访问边界: `admin`. [AI.GetAICacheStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L105)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/ai/errors

访问边界: `admin`. [AI.GetAIErrorLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L111)

```go
JSON(http.StatusOK, gin.H{"data": logs})
```

### POST /api/admin/ai/test/search

访问边界: `admin`. [AI.TestSmartSearch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L117)

```go
{
		Query string `json:"query" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 query 参数"})
JSON(http.StatusOK, gin.H{"data": gin.H{"success": false, "error": err.Error()}})
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/ai/test/recommend

访问边界: `admin`. [AI.TestRecommendReason](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L191)

```go
{
		Title  string `json:"title" binding:"required"`
		Genres string `json:"genres"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 title 参数"})
JSON(http.StatusOK, gin.H{"data": gin.H{"success": false, "error": err.Error()}})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/admin/ai/models

访问边界: `admin`. [AICost.ListModels](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_cost.go#L35)

参数: `Query provider`

```go
JSON(http.StatusOK, gin.H{"data": models, "total": len(models)})
```

### GET /api/admin/ai/cost/estimate

访问边界: `admin`. [AICost.Estimate](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_cost.go#L45)

参数: `Query model; Query provider; DefaultQuery prompt_tokens = 1000; DefaultQuery completion_tokens = 500`

```go
JSON(http.StatusBadRequest, gin.H{"error": "model 必填"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": est})
```

### GET /api/admin/ai/cost/summary

访问边界: `admin`. [AICost.Summary](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_cost.go#L64)

```go
JSON(http.StatusOK, gin.H{"data": sum})
```

### GET /api/admin/ai/router

访问边界: `admin`. [AI.GetRouterSnapshot](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L215)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{
			"failover_enabled":   false,
			"current_active":     "",
			"preferred_provider": "",
		}})
JSON(http.StatusOK, gin.H{"data": h.router.GetSnapshot()})
```

### POST /api/admin/ai/router/switch

访问边界: `admin`. [AI.ForceSwitchProvider](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L230)

```go
{
		Provider string `json:"provider" binding:"required"`
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AIRouter 未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 provider 参数"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "已切换到 " + req.Provider,
		"data":    h.router.GetSnapshot(),
	})
```

### POST /api/admin/ai/router/restore

访问边界: `admin`. [AI.RestoreProvider](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L254)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AIRouter 未启用"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "已恢复到主 provider",
		"data":    h.router.GetSnapshot(),
	})
```

### GET /api/admin/ai/router/logs

访问边界: `admin`. [AI.ListFailoverLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L273)

参数: `Query limit`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusOK, gin.H{"data": logs})
```

### GET /api/admin/ai/usage

访问边界: `admin`. [AI.GetUsageBuckets](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L297)

参数: `DefaultQuery range = month; Query provider`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"buckets":         buckets,
			"provider_totals": totals,
			"range":           rng,
			"from":            from,
			"to":              now,
		},
	})
```

### GET /api/admin/ai/providers

访问边界: `admin`. [AI.ListProviders](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L338)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"providers": providers}})
```

### POST /api/admin/ai/providers

访问边界: `admin`. [AI.AddProvider](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L348)

```go
{
		ID      string                `json:"id"`
		Name    string                `json:"name" binding:"required"`
		APIBase string                `json:"api_base"`
		APIKey  string                `json:"api_key"`
		Models  []config.AIModelEntry `json:"models"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "name 不能为空"})
JSON(http.StatusConflict, gin.H{"error": "同名供应商已存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
JSON(http.StatusOK, gin.H{"message": "供应商已添加", "data": gin.H{
		"id": id, "name": req.Name, "api_base": req.APIBase,
	}})
```

### PUT /api/admin/ai/providers/:id

访问边界: `admin`. [AI.UpdateProvider](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L396)

参数: `Param id`

```go
{
		Name    string                `json:"name"`
		APIBase string                `json:"api_base"`
		APIKey  string                `json:"api_key"`
		Models  []config.AIModelEntry `json:"models"`
		Enabled *bool                 `json:"enabled"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少供应商 ID"})
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
JSON(http.StatusNotFound, gin.H{"error": "供应商不存在"})
JSON(http.StatusOK, gin.H{"message": "供应商已更新"})
```

### DELETE /api/admin/ai/providers/:id

访问边界: `admin`. [AI.DeleteProvider](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L457)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少供应商 ID"})
JSON(http.StatusBadRequest, gin.H{"error": "内置 V-Scheduler 供应商不可删除"})
JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
JSON(http.StatusNotFound, gin.H{"error": "供应商不存在"})
JSON(http.StatusOK, gin.H{"message": "供应商已删除"})
```

### POST /api/admin/ai/set-active

访问边界: `admin`. [AI.SetActive](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L505)

```go
{
		Provider string `json:"provider" binding:"required"`
		Model    string `json:"model"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "provider 不能为空"})
JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
JSON(http.StatusOK, gin.H{"message": "AI 配置已更新", "data": gin.H{
		"active_provider": activeProvider,
		"active_model":    activeModel,
	}})
```

### POST /api/admin/ai/providers/fetch-models

访问边界: `admin`. [AI.FetchModels](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai.go#L540)

```go
{
		BaseURL    string `json:"base_url"`
		APIKey     string `json:"api_key"`
		ProviderID string `json:"provider_id"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求体"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 base_url"})
JSON(http.StatusBadRequest, gin.H{"error": "无效的 URL"})
JSON(http.StatusBadRequest, gin.H{"error": "无法连接到 API: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{
			"error":       "API 返回错误状态码: " + strconv.Itoa(resp.StatusCode),
			"url":         url,
			"status_code": resp.StatusCode,
			"response":    string(respBody),
		})
JSON(http.StatusOK, gin.H{"data": models})
```

### GET /api/admin/stats/:userId

访问边界: `admin`. [Stats.GetUserStatsAdmin](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/stats.go#L53)

参数: `Param userId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "用户ID不能为空"})
JSON(http.StatusInternalServerError, gin.H{"error": "获取统计失败"})
JSON(http.StatusOK, gin.H{"data": overview})
```

### POST /api/admin/smart-rename/scan

访问边界: `admin`. [SmartRename.Scan](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/smart_rename.go#L50)

```go
scanRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": plan})
```

### POST /api/admin/smart-rename/execute

访问边界: `admin`. [SmartRename.Execute](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/smart_rename.go#L80)

```go
executeRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": plan, "dry_run": !req.Confirm})
```

### POST /api/admin/smart-rename/rollback/:planId

访问边界: `admin`. [SmartRename.Rollback](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/smart_rename.go#L100)

参数: `Param planId`

```go
JSON(http.StatusOK, gin.H{"data": plan})
```

### POST /api/admin/smart-rename/cancel/:planId

访问边界: `admin`. [SmartRename.Cancel](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/smart_rename.go#L111)

参数: `Param planId`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "ok"})
```

### GET /api/admin/smart-rename/plans

访问边界: `admin`. [SmartRename.ListPlans](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/smart_rename.go#L121)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": gin.H{
		"items": plans,
		"total": total,
		"page":  page,
		"size":  size,
	}})
```

### GET /api/admin/smart-rename/plans/:planId

访问边界: `admin`. [SmartRename.GetPlan](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/smart_rename.go#L139)

参数: `Param planId`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": plan})
```

### DELETE /api/admin/smart-rename/plans/:planId

访问边界: `admin`. [SmartRename.DeletePlan](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/smart_rename.go#L150)

参数: `Param planId`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "ok"})
```

### PUT /api/admin/smart-rename/items/:itemId

访问边界: `admin`. [SmartRename.UpdateItem](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/smart_rename.go#L162)

参数: `Param itemId`

```go
updateItemRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": it})
```

### GET /api/admin/scan-classify

访问边界: `admin`. [ScanPostProcess.List](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/scan_postprocess.go#L56)

参数: `DefaultQuery page = 1; DefaultQuery size = 50; DefaultQuery min_score = 0; Query library_id; Query status; Query category; Query region; Query decade; Query keyword`

```go
JSON(http.StatusOK, gin.H{"data": gin.H{
		"items": items,
		"total": total,
		"page":  page,
		"size":  size,
	}})
```

### GET /api/admin/scan-classify/stats

访问边界: `admin`. [ScanPostProcess.Stats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/scan_postprocess.go#L193)

参数: `Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/scan-classify/:mediaId

访问边界: `admin`. [ScanPostProcess.Get](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/scan_postprocess.go#L86)

参数: `Param mediaId`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": item})
```

### POST /api/admin/scan-classify/reprocess

访问边界: `admin`. [ScanPostProcess.Reprocess](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/scan_postprocess.go#L103)

```go
reprocessRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": gin.H{
			"mode":      "batch",
			"requested": len(req.MediaIDs),
			"processed": ok,
		}})
JSON(http.StatusOK, gin.H{"data": gin.H{
		"mode":  mode,
		"async": async,
		"count": count,
	}})
```

### POST /api/admin/scan-classify/cancel

访问边界: `admin`. [ScanPostProcess.Cancel](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/scan_postprocess.go#L209)

参数: `Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": res})
```

### POST /api/admin/scan-classify/correct

访问边界: `admin`. [ScanPostProcess.Correct](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/scan_postprocess.go#L149)

```go
correctRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": out})
```

### DELETE /api/admin/scan-classify

访问边界: `admin`. [ScanPostProcess.Clear](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/scan_postprocess.go#L175)

参数: `Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": count}})
```

### POST /api/admin/ingest/submit

访问边界: `admin`. [LazyIngest.Submit](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ingest_lazy.go#L44)

```go
lazyIngestSubmitRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusConflict, gin.H{
				"error":         dup.Error(),
				"code":          "already_ingested",
				"existing_jobs": dup.ExistingJobs,
			})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": job})
```

### GET /api/admin/ingest/jobs

访问边界: `admin`. [LazyIngest.ListJobs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ingest_lazy.go#L95)

参数: `DefaultQuery limit = 50`

```go
JSON(http.StatusOK, gin.H{"data": jobs})
```

### GET /api/admin/ingest/jobs/:id

访问边界: `admin`. [LazyIngest.GetJob](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ingest_lazy.go#L82)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": job})
```

### GET /api/admin/ingest/jobs/:id/items

访问边界: `admin`. [LazyIngest.GetJobItems](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ingest_lazy.go#L121)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": items, "total": len(items)})
```

### POST /api/admin/ingest/jobs/:id/cancel

访问边界: `admin`. [LazyIngest.CancelJob](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ingest_lazy.go#L108)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "ok"})
```

### POST /api/admin/ingest/jobs/:id/rollback

访问边界: `admin`. [LazyIngest.RollbackJob](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ingest_lazy.go#L134)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": res})
```

### GET /api/admin/adult-scraper/config

访问边界: `admin`. [AdultScraper.GetConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper.go#L62)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"enabled":              cfg.Enabled,
			"nsfw_enabled":         h.cfg.NSFW.Enabled,
			"sources":              sources,
			"min_request_interval": cfg.MinRequestInterval,
			"max_request_interval": cfg.MaxRequestInterval,
			"supported_formats": []gin.H{
				{"type": "standard", "pattern": "ABC-123", "example": "SSIS-001, MIDV-123"},
				{"type": "fc2", "pattern": "FC2-PPV-1234567", "example": "FC2-PPV-1234567"},
				{"type": "uncensored", "pattern": "123456-789", "example": "1pondo/caribbeancom 格式"},
				{"type": "heyzo", "pattern": "HEYZO-1234", "example": "HEYZO-1234"},
			},
			"field_priority":         cfg.FieldPriority,
			"default_field_priority": service.DefaultAdultFieldPriority(),
			// Cookie 登录配置（参考 mdcx：每个站点一个完整 Cookie 字符串）
			// 出于安全考虑，返回原始 cookie 完整内容仅在 admin 场景下进行（本接口仅 admin 可访问）
			"cookies": gin.H{
				"javbus":    cfg.CookieJavBus,
				"javdb":     cfg.CookieJavDB,
				"freejavbt": cfg.CookieFreejavbt,
				"jav321":    cfg.CookieJav321,
				"fanza":     cfg.CookieFanza,
				"mgstage":   cfg.CookieMGStage,
				"fc2hub":    cfg.CookieFC2Hub,
			},
		},
	})
```

### PUT /api/admin/adult-scraper/config

访问边界: `admin`. [AdultScraper.UpdateConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper.go#L141)

```go
{
		Enabled             *bool   `json:"enabled"`
		EnableJavBus        *bool   `json:"enable_javbus"`
		JavBusURL           *string `json:"javbus_url"`
		EnableJavDB         *bool   `json:"enable_javdb"`
		JavDBURL            *string `json:"javdb_url"`
		PythonServiceURL    *string `json:"python_service_url"`
		PythonServiceAPIKey *string `json:"python_service_api_key"`
		AutoStartPython     *bool   `json:"auto_start_python"`
		MinRequestInterval  *int    `json:"min_request_interval"`
		MaxRequestInterval  *int    `json:"max_request_interval"`
		// Cookie 登录（参考 mdcx，每个站点一个完整 Cookie 字符串）
		CookieJavBus    *string `json:"cookie_javbus"`
		CookieJavDB     *string `json:"cookie_javdb"`
		CookieFreejavbt *string `json:"cookie_freejavbt"`
		CookieJav321    *string `json:"cookie_jav321"`
		CookieFanza     *string `json:"cookie_fanza"`
		CookieMGStage   *string `json:"cookie_mgstage"`
		CookieFC2Hub    *string `json:"cookie_fc2hub"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{"message": "配置已更新"})
```

### POST /api/admin/adult-scraper/scrape

访问边界: `admin`. [AdultScraper.ScrapeByCode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper.go#L260)

```go
{
		Code string `json:"code" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供番号（code 字段）"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": meta})
```

### GET /api/admin/adult-scraper/browser/status

访问边界: `admin`. [AdultScraper.BrowserMediaStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_browser.go#L11)

参数: `Query path; Query video_path`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 path 参数"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": status})
```

### POST /api/admin/adult-scraper/browser/import

访问边界: `admin`. [AdultScraper.ImportBrowserMetadata](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_browser.go#L30)

```go
{
		VideoPath    string                     `json:"video_path" binding:"required"`
		Metadata     service.AdultMetadata      `json:"metadata" binding:"required"`
		ShortReviews []service.JavDBShortReview `json:"short_reviews"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效，请提供 video_path 和 metadata"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, resp)
```

### GET /api/admin/adult-scraper/parse

访问边界: `admin`. [AdultScraper.ParseCode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper.go#L279)

参数: `Query input`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 input 参数"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"input":     input,
			"code":      info.Number,
			"code_type": info.CodeType,
			"is_adult":  info.IsAdult,
			// 增强字段
			"letters":      info.Letters,
			"short_number": info.ShortNumber,
			"mosaic":       info.Mosaic,    // 有码/无码/国产/欧美
			"cd_part":      info.CDPart,    // CD1/PART2 等
			"has_chn_sub":  info.HasChnSub, // 中文字幕版
		},
	})
```

### GET /api/admin/adult-scraper/python-health

访问边界: `admin`. [AdultScraper.PythonServiceHealth](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper.go#L309)

```go
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"configured": false,
				"status":     "not_configured",
				"message":    "Python 微服务未配置",
			},
		})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"configured": true,
				"status":     "offline",
				"message":    "无法连接到 Python 微服务: " + err.Error(),
				"url":        url,
			},
		})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"configured": true,
				"status":     "online",
				"message":    "Python 微服务运行正常",
				"url":        url,
			},
		})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"configured": true,
				"status":     "error",
				"message":    "Python 微服务返回异常状态码",
				"url":        url,
				"http_code":  resp.StatusCode,
			},
		})
```

### POST /api/admin/adult-scraper/aggregate

访问边界: `admin`. [AdultScraper.ScrapeAggregated](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p2.go#L19)

```go
{
		Code string `json:"code" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供番号（code 字段）"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"merged":  merged,
			"sources": sources,
			"count":   len(sources),
		},
	})
```

### GET /api/admin/adult-scraper/test-sources

访问边界: `admin`. [AdultScraper.TestAllSources](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p2.go#L46)

参数: `Query code`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 code 参数"})
JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"code":    code,
				"success": false,
				"sources": gin.H{},
				"error":   err.Error(),
			},
		})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"code":    code,
			"success": true,
			"sources": srcSummary,
			"count":   len(sources),
		},
	})
```

### GET /api/admin/adult-scraper/mappings

访问边界: `admin`. [AdultScraper.GetMappings](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p2.go#L96)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"note": "别名映射：左侧为别名，右侧为规范名。系统自动将左侧匹配到的数据替换为右侧。",
			"description": gin.H{
				"actress": "演员别名映射（日文/繁体/英文 -> 简体中文规范名）",
				"studio":  "片商别名映射",
				"series":  "系列别名映射",
				"genre":   "标签别名映射",
			},
		},
	})
```

### POST /api/admin/adult-scraper/mappings

访问边界: `admin`. [AdultScraper.AddMappings](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p2.go#L113)

```go
{
		Type     string            `json:"type" binding:"required"` // actress/studio/series/genre
		Mappings map[string]string `json:"mappings" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": "mappings 不能为空"})
JSON(http.StatusBadRequest, gin.H{"error": "type 必须是 actress/studio/series/genre 之一"})
JSON(http.StatusOK, gin.H{
		"message": "映射已添加",
		"count":   len(req.Mappings),
		"type":    req.Type,
	})
```

### POST /api/admin/adult-scraper/normalize-test

访问边界: `admin`. [AdultScraper.TestNormalize](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p2.go#L151)

```go
{
		Actresses []string `json:"actresses"`
		Studio    string   `json:"studio"`
		Series    string   `json:"series"`
		Genres    []string `json:"genres"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"actresses": gin.H{
				"input":      req.Actresses,
				"normalized": service.NormalizeActresses(req.Actresses),
			},
			"studio": gin.H{
				"input":      req.Studio,
				"normalized": service.NormalizeStudio(req.Studio),
			},
			"series": gin.H{
				"input":      req.Series,
				"normalized": service.NormalizeSeries(req.Series),
			},
			"genres": gin.H{
				"input":      req.Genres,
				"normalized": service.NormalizeGenres(req.Genres),
			},
		},
	})
```

### PUT /api/admin/adult-scraper/config-ext

访问边界: `admin`. [AdultScraper.UpdateConfigExtended](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p2.go#L189)

```go
{
		// 基础
		Enabled             *bool  `json:"enabled"`
		EnableJavBus        *bool  `json:"enable_javbus"`
		JavBusURL           string `json:"javbus_url"`
		EnableJavDB         *bool  `json:"enable_javdb"`
		JavDBURL            string `json:"javdb_url"`
		PythonServiceURL    string `json:"python_service_url"`
		PythonServiceAPIKey string `json:"python_service_api_key"`
		MinRequestInterval  *int   `json:"min_request_interval"`
		MaxRequestInterval  *int   `json:"max_request_interval"`

		// P1 数据源
		EnableFreejavbt *bool  `json:"enable_freejavbt"`
		FreejavbtURL    string `json:"freejavbt_url"`
		EnableJav321    *bool  `json:"enable_jav321"`
		Jav321URL       string `json:"jav321_url"`

		// P1 多媒体资源
		DownloadExtraFanart *bool `json:"download_extra_fanart"`
		MaxExtraFanart      *int  `json:"max_extra_fanart"`
		DownloadActorPhoto  *bool `json:"download_actor_photo"`
		FetchTrailer        *bool `json:"fetch_trailer"`

		// P1 翻译
		EnableTranslate     *bool  `json:"enable_translate"`
		TranslateProvider   string `json:"translate_provider"`
		TranslateEndpoint   string `json:"translate_endpoint"`
		TranslateAPIKey     string `json:"translate_api_key"`
		TranslateAPISecret  string `json:"translate_api_secret"`
		TranslateTargetLang string `json:"translate_target_lang"`

		// P2 数据源
		EnableFanza   *bool  `json:"enable_fanza"`
		FanzaURL      string `json:"fanza_url"`
		EnableMGStage *bool  `json:"enable_mgstage"`
		MGStageURL    string `json:"mgstage_url"`
		EnableFC2Hub  *bool  `json:"enable_fc2hub"`
		FC2HubURL     string `json:"fc2hub_url"`

		// P2/P3 其他
		EnableAggregatedMode *bool               `json:"enable_aggregated_mode"`
		EnablePosterCrop     *bool               `json:"enable_poster_crop"`
		FieldPriority        map[string][]string `json:"field_priority"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{"message": "扩展配置已更新"})
```

### GET /api/admin/adult-scraper/lazy/status

访问边界: `admin`. [AdultScraper.GetLazyStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L220)

参数: `Query days`

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"config_ready": h.isLazyScraperReady(),
			"folder_tasks": gin.H{
				"active":  folderActive,
				"history": folderHistory,
			},
			"media_tasks": gin.H{
				"active":  mediaActive,
				"history": mediaHistory,
			},
			"current_task":        currentTask,
			"recent_results":      recentResults,
			"report":              report,
			"failed_items":        failedItems,
			"failed_count":        len(failedItems) + folderFailedCount,
			"folder_failed_count": folderFailedCount,
			"scheduler":           scheduler,
			"cache":               cache,
			"days":                days,
		},
	})
```

### POST /api/admin/adult-scraper/lazy/start

访问边界: `admin`. [AdultScraper.StartLazyScrape](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L140)

```go
{
		Path        string `json:"path" binding:"required"`
		Recursive   *bool  `json:"recursive"`
		MaxDepth    int    `json:"max_depth"`
		Concurrency int    `json:"concurrency"`
		Aggregated  *bool  `json:"aggregated"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 path 参数"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "懒人刮削服务未初始化"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
			"message": "没有发现需要刮削的新视频，已有 NFO 的文件已自动跳过",
			"data": gin.H{
				"task_id": "",
				"queued":  0,
				"scan":    scan,
			},
		})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "懒人刮削已启动",
		"data": gin.H{
			"task_id": taskID,
			"queued":  len(paths),
			"scan":    scan,
		},
	})
```

### POST /api/admin/adult-scraper/lazy/retry-failed

访问边界: `admin`. [AdultScraper.RetryLazyFailed](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L358)

```go
{
		Days        int  `json:"days"`
		Concurrency int  `json:"concurrency"`
		Aggregated  bool `json:"aggregated"`
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "文件夹刮削服务未初始化"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "媒体库批量刮削服务未初始化"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"folder_task_id":     folderTaskID,
			"media_task_id":      mediaTaskID,
			"folder_retry_count": len(folderPaths),
			"media_retry_count":  len(mediaIDs),
			"retry_count":        len(folderPaths) + len(mediaIDs),
		},
	})
```

### POST /api/admin/adult-scraper/batch/start

访问边界: `admin`. [AdultScraper.StartBatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L462)

```go
{
		LibraryID     string   `json:"library_id"`
		MediaIDs      []string `json:"media_ids"`
		OnlyUnscraped bool     `json:"only_unscraped"`
		DryRun        bool     `json:"dry_run"`
		Concurrency   int      `json:"concurrency"`
		Aggregated    bool     `json:"aggregated"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "批量刮削服务未初始化"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": gin.H{"task_id": taskID}})
```

### POST /api/admin/adult-scraper/batch/:id/pause

访问边界: `admin`. [AdultScraper.PauseBatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L497)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "已暂停"})
```

### POST /api/admin/adult-scraper/batch/:id/resume

访问边界: `admin`. [AdultScraper.ResumeBatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L507)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "已恢复"})
```

### POST /api/admin/adult-scraper/batch/:id/cancel

访问边界: `admin`. [AdultScraper.CancelBatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L517)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "已取消"})
```

### GET /api/admin/adult-scraper/batch/:id

访问边界: `admin`. [AdultScraper.GetBatchStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L527)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": t})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /api/admin/adult-scraper/batch

访问边界: `admin`. [AdultScraper.ListBatchTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L546)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"active":  active,
			"history": history,
		},
	})
```

### GET /api/admin/adult-scraper/mirrors

访问边界: `admin`. [AdultScraper.ListMirrors](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L567)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{}})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"sources":        out,
			"last_health_at": h.proxyManager.LastHealthAt(),
		},
	})
```

### POST /api/admin/adult-scraper/mirrors/health-check

访问边界: `admin`. [AdultScraper.HealthCheckMirrors](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L590)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "代理管理器未初始化"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"total":   total,
			"healthy": healthy,
		},
	})
```

### POST /api/admin/adult-scraper/mirrors/:source

访问边界: `admin`. [AdultScraper.SetMirrors](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L607)

参数: `Param source`

```go
{
		URLs []string `json:"urls" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "参数无效"})
JSON(http.StatusOK, gin.H{"message": "镜像列表已更新", "source": src, "count": len(req.URLs)})
```

### GET /api/admin/adult-scraper/cache

访问边界: `admin`. [AdultScraper.GetCacheStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L624)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false}})
JSON(http.StatusOK, gin.H{"data": h.cache.Stats()})
```

### DELETE /api/admin/adult-scraper/cache

访问边界: `admin`. [AdultScraper.ClearCache](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L634)

```go
JSON(http.StatusOK, gin.H{"message": "缓存未启用"})
JSON(http.StatusOK, gin.H{"message": "缓存已清空"})
```

### DELETE /api/admin/adult-scraper/cache/:code

访问边界: `admin`. [AdultScraper.InvalidateCache](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L645)

参数: `Param code`

```go
JSON(http.StatusOK, gin.H{"message": "已失效: " + code})
```

### GET /api/admin/adult-scraper/scheduler

访问边界: `admin`. [AdultScraper.GetSchedulerConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L657)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false}})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"config":       h.scheduler.Config(),
			"last_run_at":  h.scheduler.LastRunAt(),
			"last_task_id": h.scheduler.LastTaskID(),
		},
	})
```

### PUT /api/admin/adult-scraper/scheduler

访问边界: `admin`. [AdultScraper.UpdateSchedulerConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L673)

```go
service.AdultSchedulerConfig
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "参数无效"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "调度器未初始化"})
JSON(http.StatusOK, gin.H{"message": "调度器配置已更新"})
```

### POST /api/admin/adult-scraper/scheduler/run

访问边界: `admin`. [AdultScraper.TriggerScheduler](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L689)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "调度器未初始化"})
JSON(http.StatusOK, gin.H{"data": gin.H{"task_id": taskID}})
```

### GET /api/admin/adult-scraper/report

访问边界: `admin`. [AdultScraper.GetReport](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L706)

参数: `Query days`

```go
JSON(http.StatusOK, gin.H{"data": service.BuildReport(nil, days)})
JSON(http.StatusOK, gin.H{"data": report})
```

### GET /api/admin/adult-scraper/failed-items

访问边界: `admin`. [AdultScraper.GetFailedItems](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L723)

参数: `Query days`

```go
JSON(http.StatusOK, gin.H{"data": []any{}, "count": 0})
JSON(http.StatusOK, gin.H{"data": items, "count": len(items)})
```

### POST /api/admin/adult-scraper/retry-failed

访问边界: `admin`. [AdultScraper.RetryFailed](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_p3.go#L741)

```go
{
		Days        int  `json:"days"`
		Concurrency int  `json:"concurrency"`
		Aggregated  bool `json:"aggregated"`
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "服务未初始化"})
JSON(http.StatusOK, gin.H{"message": "没有可重试的失败记录"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"task_id":     taskID,
			"retry_count": len(ids),
		},
	})
```

### GET /api/admin/adult-scraper/folder/scan

访问边界: `admin`. [AdultScraper.ScanFolder](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_folder.go#L17)

参数: `Query path; DefaultQuery recursive = true; DefaultQuery max_depth = 0`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 path 参数"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "番号刮削服务未初始化"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/adult-scraper/folder/batch/start

访问边界: `admin`. [AdultScraper.StartFolderBatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_folder.go#L43)

```go
{
		Paths        []string `json:"paths" binding:"required"`
		Aggregated   bool     `json:"aggregated"`
		Concurrency  int      `json:"concurrency"`
		SkipIfHasNFO bool     `json:"skip_if_has_nfo"`
		OverrideCode string   `json:"override_code"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 paths 列表"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "文件夹刮削服务未初始化"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": gin.H{"task_id": taskID}})
```

### GET /api/admin/adult-scraper/folder/batch

访问边界: `admin`. [AdultScraper.ListFolderBatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_folder.go#L91)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "文件夹刮削服务未初始化"})
JSON(http.StatusOK, gin.H{"data": gin.H{"active": active, "history": history}})
```

### GET /api/admin/adult-scraper/folder/batch/:id

访问边界: `admin`. [AdultScraper.GetFolderBatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_folder.go#L75)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "文件夹刮削服务未初始化"})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusOK, gin.H{"data": task})
```

### POST /api/admin/adult-scraper/folder/batch/:id/cancel

访问边界: `admin`. [AdultScraper.CancelFolderBatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_folder.go#L102)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "文件夹刮削服务未初始化"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "已取消"})
```

### GET /api/admin/adult-scraper/cookie/test

访问边界: `admin`. [AdultScraper.TestCookie](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/adult_scraper_folder.go#L119)

参数: `Query site`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 site 参数（javbus/javdb/freejavbt/jav321/fanza/mgstage/fc2hub）"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "番号刮削服务未初始化"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"ok":          ok,
			"message":     message,
			"status_code": code,
			"site":        site,
		},
	})
```

### GET /api/admin/files

访问边界: `admin`. [FileManager.ListFiles](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L34)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id; Query media_type; Query keyword; DefaultQuery sort_by = created_at; DefaultQuery sort_order = desc; Query scraped`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取文件列表失败"})
JSON(http.StatusOK, gin.H{
		"data":  files,
		"total": total,
		"page":  page,
		"size":  size,
	})
```

### GET /api/admin/files/folders

访问边界: `admin`. [FileManager.GetFolderTree](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L84)

参数: `Query library_id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取文件夹树失败"})
JSON(http.StatusOK, gin.H{"data": tree})
```

### GET /api/admin/files/by-folder

访问边界: `admin`. [FileManager.ListFilesByFolder](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L97)

参数: `Query path; DefaultQuery page = 1; DefaultQuery size = 20; Query library_id; Query media_type; Query keyword; DefaultQuery sort_by = created_at; DefaultQuery sort_order = desc; Query scraped`

```go
JSON(http.StatusBadRequest, gin.H{"error": "文件夹路径不能为空"})
JSON(http.StatusInternalServerError, gin.H{"error": "获取文件列表失败"})
JSON(http.StatusOK, gin.H{
		"data":        files,
		"total":       total,
		"page":        page,
		"size":        size,
		"sub_folders": subFolders,
		"folder_path": folderPath,
	})
```

### POST /api/admin/files/folders/create

访问边界: `admin`. [FileManager.CreateFolder](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L143)

```go
{
		ParentPath string `json:"parent_path" binding:"required"`
		FolderName string `json:"folder_name" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "文件夹创建成功"})
```

### POST /api/admin/files/folders/rename

访问边界: `admin`. [FileManager.RenameFolder](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L161)

```go
{
		FolderPath string `json:"folder_path" binding:"required"`
		NewName    string `json:"new_name" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "文件夹重命名成功"})
```

### POST /api/admin/files/folders/delete

访问边界: `admin`. [FileManager.DeleteFolder](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L179)

```go
{
		FolderPath string `json:"folder_path" binding:"required"`
		Force      bool   `json:"force"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "文件夹删除成功"})
```

### GET /api/admin/files/:id

访问边界: `admin`. [FileManager.GetFileDetail](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L73)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
JSON(http.StatusOK, gin.H{"data": media})
```

### POST /api/admin/files/import

访问边界: `admin`. [FileManager.ImportFile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L199)

```go
service.FileImportRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": media, "message": "文件导入成功"})
```

### PUT /api/admin/files/:id

访问边界: `admin`. [FileManager.UpdateFile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L219)

参数: `Param id`

```go
map
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": media, "message": "更新成功"})
```

### DELETE /api/admin/files/:id

访问边界: `admin`. [FileManager.DeleteFile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L240)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "文件记录已删除（原始文件未受影响）"})
```

### POST /api/admin/files/batch/delete

访问边界: `admin`. [FileManager.BatchDeleteFiles](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L253)

```go
{
		MediaIDs []string `json:"media_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{
		"message": "批量删除完成",
		"deleted": deleted,
		"errors":  errors,
	})
```

### POST /api/admin/files/:id/scrape

访问边界: `admin`. [FileManager.ScrapeFile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L275)

参数: `Param id`

```go
{
		Source string `json:"source"` // tmdb / bangumi / ai
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "刮削已启动"})
```

### POST /api/admin/files/batch/scrape

访问边界: `admin`. [FileManager.BatchScrapeFiles](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L292)

```go
{
		MediaIDs []string `json:"media_ids" binding:"required"`
		Source   string   `json:"source"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{
		"message": "批量刮削已启动",
		"started": started,
		"errors":  errors,
	})
```

### POST /api/admin/files/rename/preview

访问边界: `admin`. [FileManager.PreviewRename](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L315)

```go
{
		MediaIDs []string `json:"media_ids" binding:"required"`
		Template string   `json:"template"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "生成预览失败"})
JSON(http.StatusOK, gin.H{"data": previews})
```

### POST /api/admin/files/rename/execute

访问边界: `admin`. [FileManager.ExecuteRename](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L339)

```go
{
		MediaIDs []string `json:"media_ids" binding:"required"`
		Template string   `json:"template"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{
		"message": "重命名完成",
		"renamed": renamed,
		"errors":  errors,
	})
```

### POST /api/admin/files/rename/ai

访问边界: `admin`. [FileManager.AIGenerateRenames](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L364)

```go
{
		MediaIDs   []string `json:"media_ids" binding:"required"`
		TargetLang string   `json:"target_lang"` // 目标翻译语言: zh/en/ja/ko/fr/de 等
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": previews})
```

### GET /api/admin/files/rename/templates

访问边界: `admin`. [FileManager.GetRenameTemplates](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L384)

```go
JSON(http.StatusOK, gin.H{"data": templates})
```

### GET /api/admin/files/stats

访问边界: `admin`. [FileManager.GetStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L392)

参数: `Query library_id; Query folder_path`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取统计失败"})
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/files/logs

访问边界: `admin`. [FileManager.GetOperationLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/file_manager.go#L404)

参数: `DefaultQuery limit = 50`

```go
JSON(http.StatusOK, gin.H{"data": logs})
```

### POST /api/admin/assistant/chat

访问边界: `admin`. [AIAssistant.Chat](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_assistant.go#L19)

```go
service.ChatRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": "消息内容不能为空"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": resp})
```

### POST /api/admin/assistant/execute

访问边界: `admin`. [AIAssistant.ExecuteAction](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_assistant.go#L42)

```go
service.ExecuteRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": resp})
```

### POST /api/admin/assistant/undo/:opId

访问边界: `admin`. [AIAssistant.UndoOperation](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_assistant.go#L60)

参数: `Param opId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "操作ID不能为空"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": resp})
```

### GET /api/admin/assistant/session/:sessionId

访问边界: `admin`. [AIAssistant.GetSession](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_assistant.go#L78)

参数: `Param sessionId`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": session})
```

### DELETE /api/admin/assistant/session/:sessionId

访问边界: `admin`. [AIAssistant.DeleteSession](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_assistant.go#L90)

参数: `Param sessionId`

```go
JSON(http.StatusOK, gin.H{"message": "会话已删除"})
```

### GET /api/admin/assistant/history

访问边界: `admin`. [AIAssistant.GetOperationHistory](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_assistant.go#L97)

参数: `DefaultQuery limit = 20`

```go
JSON(http.StatusOK, gin.H{"data": history})
```

### GET /api/admin/assistant/misclassification

访问边界: `admin`. [AIAssistant.AnalyzeMisclassification](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_assistant.go#L109)

```go
JSON(http.StatusOK, gin.H{"data": report})
```

### POST /api/admin/assistant/reclassify

访问边界: `admin`. [AIAssistant.ReclassifyFiles](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/ai_assistant.go#L120)

```go
service.ReclassifyRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/admin/notification/config

访问边界: `admin`. [Notification.GetConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L19)

```go
JSON(http.StatusOK, gin.H{"data": cfg})
```

### PUT /api/admin/notification/config

访问边界: `admin`. [Notification.UpdateConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L25)

```go
service.NotificationConfig
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的配置参数"})
JSON(http.StatusOK, gin.H{"message": "通知配置已更新", "data": cfg})
```

### POST /api/admin/notification/test

访问边界: `admin`. [Notification.TestNotification](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L37)

参数: `Query channel`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请指定通知渠道"})
JSON(http.StatusOK, gin.H{"message": "测试通知已发送"})
```

### POST /api/admin/batch/metadata/media

访问边界: `admin`. [BatchMetadata.BatchUpdateMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L134)

```go
service.BatchUpdateRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{
		"message": "批量更新完成",
		"data":    result,
	})
```

### POST /api/admin/batch/metadata/series

访问边界: `admin`. [BatchMetadata.BatchUpdateSeries](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L154)

```go
{
		SeriesIDs []string          `json:"series_ids"`
		Updates   map[string]string `json:"updates"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{
		"message": "批量更新完成",
		"data":    result,
	})
```

### POST /api/admin/import/test

访问边界: `admin`. [BatchMetadata.TestImportConnection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L177)

```go
service.ImportSource
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "连接成功"})
```

### POST /api/admin/import/libraries

访问边界: `admin`. [BatchMetadata.FetchImportLibraries](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L193)

```go
service.ImportSource
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"data": libraries})
```

### POST /api/admin/import/external

访问边界: `admin`. [BatchMetadata.ImportFromExternal](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L210)

```go
{
		Source          service.ImportSource `json:"source"`
		LibraryID       string               `json:"library_id"`
		TargetLibraryID string               `json:"target_library_id"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{
		"message": "导入完成",
		"data":    result,
	})
```

### GET /api/admin/export/library

访问边界: `admin`. [BatchMetadata.ExportLibrary](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L234)

参数: `Query library_id`

```go
JSON(http.StatusOK, gin.H{
		"message": "导出成功",
		"data":    data,
	})
```

### POST /api/admin/import/data

访问边界: `admin`. [BatchMetadata.ImportFromExportData](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/notification.go#L250)

```go
{
		Data            service.ExportData `json:"data"`
		TargetLibraryID string             `json:"target_library_id"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{
		"message": "导入完成",
		"data":    result,
	})
```

### GET /api/admin/import/targets

访问边界: `admin`. [ImportTarget.List](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/import_target.go#L35)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库列表失败"})
JSON(http.StatusOK, gin.H{
		"data": service.BuildImportLocations(libs, mediaHostPath, exposedRoot),
	})
```

### POST /api/admin/import/ensure-library

访问边界: `admin`. [ImportTarget.EnsureLibrary](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/import_target.go#L66)

```go
ensureLibraryRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库列表失败"})
JSON(http.StatusBadRequest, gin.H{"error": "该目录不可上传"})
JSON(http.StatusBadRequest, gin.H{"error": "创建媒体库失败"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"library_id":   lib.ID,
			"library_name": lib.Name,
			"created":      created,
		},
	})
```

### GET /api/admin/emby/detect

访问边界: `admin`. [EmbyCompat.DetectEmbyFormat](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/emby_compat.go#L18)

参数: `Query path`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供目录路径"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/emby/import

访问边界: `admin`. [EmbyCompat.ImportEmbyLibrary](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/emby_compat.go#L35)

```go
service.EmbyImportRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 EMBY 媒体库根目录路径"})
JSON(http.StatusBadRequest, gin.H{"error": "请选择目标媒体库"})
JSON(http.StatusOK, gin.H{
		"message": "EMBY 媒体库导入完成",
		"data":    result,
	})
```

### GET /api/admin/emby/info

访问边界: `admin`. [EmbyCompat.GetEmbyCompatInfo](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/emby_compat.go#L69)

```go
JSON(http.StatusOK, gin.H{"data": info})
```

### GET /api/admin/emby/nfo/:mediaId

访问边界: `admin`. [EmbyCompat.GenerateEmbyNFO](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/emby_compat.go#L75)

参数: `Param mediaId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供媒体 ID"})
JSON(http.StatusOK, gin.H{
		"message":  "NFO 生成功能已就绪",
		"media_id": mediaID,
	})
```

### GET /api/admin/profiles

访问边界: `admin`. [UserProfile.ListProfiles](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L19)

```go
JSON(http.StatusOK, gin.H{"data": profiles})
```

### POST /api/admin/profiles

访问边界: `admin`. [UserProfile.CreateProfile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L29)

```go
service.UserProfile
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "配置文件已创建", "data": profile})
```

### GET /api/admin/profiles/:id

访问边界: `admin`. [UserProfile.GetProfile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L43)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "配置文件不存在"})
JSON(http.StatusOK, gin.H{"data": profile})
```

### PUT /api/admin/profiles/:id

访问边界: `admin`. [UserProfile.UpdateProfile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L53)

参数: `Param id`

```go
map
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "配置文件已更新"})
```

### DELETE /api/admin/profiles/:id

访问边界: `admin`. [UserProfile.DeleteProfile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L67)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "配置文件已删除"})
```

### POST /api/admin/profiles/:id/switch

访问边界: `admin`. [UserProfile.SwitchProfile](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L76)

参数: `Param id`

```go
{
		PIN string `json:"pin"`
	}
```

```go
JSON(http.StatusForbidden, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": profile})
```

### GET /api/admin/profiles/:id/watch-logs

访问边界: `admin`. [UserProfile.GetWatchLogs](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L90)

参数: `Param id; DefaultQuery days = 7`

```go
JSON(http.StatusOK, gin.H{"data": logs})
```

### GET /api/admin/profiles/:id/usage

访问边界: `admin`. [UserProfile.GetDailyUsage](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L101)

参数: `Param id; DefaultQuery days = 30`

```go
JSON(http.StatusOK, gin.H{"data": usage})
```

### GET /api/admin/profiles/:id/stats

访问边界: `admin`. [UserProfile.GetProfileStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L112)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### POST /api/admin/downloads

访问边界: `admin`. [OfflineDownload.CreateDownload](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L125)

```go
{
		MediaID  string `json:"media_id"`
		Title    string `json:"title"`
		FileSize int64  `json:"file_size"`
		FilePath string `json:"file_path"`
		Quality  string `json:"quality"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载任务已创建", "data": task})
```

### POST /api/admin/downloads/batch

访问边界: `admin`. [OfflineDownload.BatchDownload](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L146)

```go
service.BatchDownloadRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"data": tasks, "errors": errors})
```

### GET /api/admin/downloads

访问边界: `admin`. [OfflineDownload.ListDownloads](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L157)

参数: `Query status`

```go
JSON(http.StatusOK, gin.H{"data": tasks})
```

### GET /api/admin/downloads/queue

访问边界: `admin`. [OfflineDownload.GetQueueInfo](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L168)

```go
JSON(http.StatusOK, gin.H{"data": info})
```

### POST /api/admin/downloads/:id/cancel

访问边界: `admin`. [OfflineDownload.CancelDownload](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L178)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载已取消"})
```

### POST /api/admin/downloads/:id/pause

访问边界: `admin`. [OfflineDownload.PauseDownload](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L188)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载已暂停"})
```

### POST /api/admin/downloads/:id/resume

访问边界: `admin`. [OfflineDownload.ResumeDownload](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L198)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载已恢复"})
```

### DELETE /api/admin/downloads/:id

访问边界: `admin`. [OfflineDownload.DeleteDownload](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L208)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载已删除"})
```

### GET /api/admin/abr/status

访问边界: `admin`. [ABR.GetStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L699)

```go
JSON(http.StatusOK, gin.H{"data": status})
```

### GET /api/admin/abr/gpu

访问边界: `admin`. [ABR.GetGPUInfo](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L704)

```go
JSON(http.StatusOK, gin.H{"data": info})
```

### DELETE /api/admin/abr/cache

访问边界: `admin`. [ABR.CleanCache](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L709)

参数: `Query media_id`

```go
JSON(http.StatusOK, gin.H{"message": "ABR 缓存已清理"})
JSON(http.StatusOK, gin.H{"message": "所有 ABR 缓存已清理", "freed_bytes": size})
```

### GET /api/admin/plugins

访问边界: `admin`. [Plugin.ListPlugins](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L225)

```go
JSON(http.StatusOK, gin.H{"data": plugins})
```

### GET /api/admin/plugins/:id

访问边界: `admin`. [Plugin.GetPlugin](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L234)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "插件不存在"})
JSON(http.StatusOK, gin.H{"data": info, "manifest": manifest})
```

### POST /api/admin/plugins/:id/enable

访问边界: `admin`. [Plugin.EnablePlugin](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L244)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "插件已启用"})
```

### POST /api/admin/plugins/:id/disable

访问边界: `admin`. [Plugin.DisablePlugin](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L253)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "插件已禁用"})
```

### DELETE /api/admin/plugins/:id

访问边界: `admin`. [Plugin.UninstallPlugin](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L262)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "插件已卸载"})
```

### PUT /api/admin/plugins/:id/config

访问边界: `admin`. [Plugin.UpdatePluginConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L271)

参数: `Param id`

```go
map
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的配置"})
JSON(http.StatusOK, gin.H{"message": "插件配置已更新"})
```

### POST /api/admin/plugins/scan

访问边界: `admin`. [Plugin.ScanPlugins](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L285)

```go
JSON(http.StatusOK, gin.H{"data": discovered})
```

### POST /api/admin/music/scan

访问边界: `admin`. [Music.ScanLibrary](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L369)

```go
{
		LibraryID string `json:"library_id"`
		Path      string `json:"path"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "扫描完成", "count": count})
```

### POST /api/admin/photos/scan

访问边界: `admin`. [Photo.ScanLibrary](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L564)

```go
{
		LibraryID string `json:"library_id"`
		Path      string `json:"path"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "扫描完成", "count": count})
```

### GET /api/admin/federation/nodes

访问边界: `admin`. [Federation.ListNodes](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L588)

```go
JSON(http.StatusOK, gin.H{"data": nodes})
```

### POST /api/admin/federation/nodes

访问边界: `admin`. [Federation.RegisterNode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L597)

```go
{
		Name   string `json:"name"`
		URL    string `json:"url"`
		APIKey string `json:"api_key"`
		Role   string `json:"role"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "节点已注册", "data": node})
```

### DELETE /api/admin/federation/nodes/:id

访问边界: `admin`. [Federation.RemoveNode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L616)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "节点已移除"})
```

### POST /api/admin/federation/nodes/:id/sync

访问边界: `admin`. [Federation.SyncNode](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L625)

参数: `Param id; DefaultQuery type = full`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "同步已开始", "data": task})
```

### GET /api/admin/federation/stats

访问边界: `admin`. [Federation.GetStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L658)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/federation/sync-tasks

访问边界: `admin`. [Federation.GetSyncTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L667)

参数: `Query node_id`

```go
JSON(http.StatusOK, gin.H{"data": tasks})
```

### POST /api/admin/media/batch-move

访问边界: `admin`. [Library.BatchMoveMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v4_features.go#L13)

```go
service.BatchMoveMediaRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误"})
JSON(http.StatusBadRequest, gin.H{"error": "media_ids 和 target_library_id 不能为空"})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/admin/duplicates

访问边界: `admin`. [Library.DetectAllDuplicates](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L421)

```go
JSON(http.StatusOK, gin.H{
		"data":  groups,
		"total": len(groups),
	})
```

### GET /api/admin/libraries/:id/duplicates

访问边界: `admin`. [Library.DetectDuplicates](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L406)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{
		"data":  groups,
		"total": len(groups),
	})
```

### POST /api/admin/libraries/:id/mark-duplicates

访问边界: `admin`. [Library.MarkDuplicates](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/library.go#L435)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已标记 %d 个重复文件", count),
		"marked":  count,
	})
```

### GET /api/admin/pulse/dashboard

访问边界: `admin`. [Pulse.GetDashboard](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L21)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取仪表盘数据失败"})
JSON(http.StatusOK, gin.H{"data": data})
```

### GET /api/admin/pulse/dashboard/trends

访问边界: `admin`. [Pulse.GetPlayTrends](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L31)

参数: `DefaultQuery days = 30`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取播放趋势失败"})
JSON(http.StatusOK, gin.H{"data": trends})
```

### GET /api/admin/pulse/dashboard/top-content

访问边界: `admin`. [Pulse.GetTopContent](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L42)

参数: `DefaultQuery days = 30; DefaultQuery limit = 10`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取热门内容失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/dashboard/top-users

访问边界: `admin`. [Pulse.GetTopUsers](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L54)

参数: `DefaultQuery days = 30; DefaultQuery limit = 10`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取用户排行失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/dashboard/recent

访问边界: `admin`. [Pulse.GetRecentPlays](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L66)

参数: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取最近播放失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/analytics

访问边界: `admin`. [Pulse.GetAnalytics](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L79)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体分析失败"})
JSON(http.StatusOK, gin.H{"data": data})
```

### GET /api/admin/pulse/analytics/hourly

访问边界: `admin`. [Pulse.GetHourlyDistribution](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L89)

参数: `DefaultQuery days = 30`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取时段分布失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/analytics/libraries

访问边界: `admin`. [Pulse.GetLibraryStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L100)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库统计失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/analytics/growth

访问边界: `admin`. [Pulse.GetMediaGrowth](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/pulse.go#L110)

参数: `DefaultQuery months = 12`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取增长趋势失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### POST /api/admin/preprocess/submit

访问边界: `admin`. [Preprocess.SubmitMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L25)

```go
{
		MediaID  string `json:"media_id" binding:"required"`
		Priority int    `json:"priority"`
		Force    bool   `json:"force"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "预处理任务已提交",
		"data":    task,
	})
```

### POST /api/admin/preprocess/batch

访问边界: `admin`. [Preprocess.BatchSubmit](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L51)

```go
{
		MediaIDs []string `json:"media_ids" binding:"required"`
		Priority int      `json:"priority"`
		Force    bool     `json:"force"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_ids"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "批量预处理任务已提交",
		"data": gin.H{
			"submitted": len(tasks),
			"tasks":     tasks,
		},
	})
```

### POST /api/admin/preprocess/library/:id

访问边界: `admin`. [Preprocess.SubmitLibrary](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L78)

参数: `Param id`

```go
{
		Priority int `json:"priority"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "媒体库预处理任务已提交",
		"data": gin.H{
			"submitted": count,
		},
	})
```

### GET /api/admin/preprocess/tasks

访问边界: `admin`. [Preprocess.ListTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L132)

参数: `DefaultQuery page = 1; DefaultQuery page_size = 20; Query status`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"tasks":     tasks,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
```

### GET /api/admin/preprocess/tasks/:id

访问边界: `admin`. [Preprocess.GetTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L100)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusOK, gin.H{"data": task})
```

### POST /api/admin/preprocess/tasks/:id/pause

访问边界: `admin`. [Preprocess.PauseTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L161)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已暂停"})
```

### POST /api/admin/preprocess/tasks/:id/resume

访问边界: `admin`. [Preprocess.ResumeTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L171)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已恢复"})
```

### POST /api/admin/preprocess/tasks/:id/cancel

访问边界: `admin`. [Preprocess.CancelTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L181)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已取消"})
```

### POST /api/admin/preprocess/tasks/:id/retry

访问边界: `admin`. [Preprocess.RetryTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L191)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已重新提交"})
```

### DELETE /api/admin/preprocess/tasks/:id

访问边界: `admin`. [Preprocess.DeleteTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L201)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已删除"})
```

### GET /api/admin/preprocess/statistics

访问边界: `admin`. [Preprocess.GetStatistics](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L277)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/preprocess/system-load

访问边界: `admin`. [Preprocess.GetSystemLoad](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L283)

```go
JSON(http.StatusOK, gin.H{"data": load})
```

### POST /api/admin/preprocess/tasks/batch-delete

访问边界: `admin`. [Preprocess.BatchDeleteTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L211)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量删除完成",
		"data":    gin.H{"deleted": deleted},
	})
```

### POST /api/admin/preprocess/tasks/batch-cancel

访问边界: `admin`. [Preprocess.BatchCancelTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L233)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量取消完成",
		"data":    gin.H{"cancelled": cancelled},
	})
```

### POST /api/admin/preprocess/tasks/batch-retry

访问边界: `admin`. [Preprocess.BatchRetryTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L255)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量重试完成",
		"data":    gin.H{"retried": retried},
	})
```

### DELETE /api/admin/preprocess/cache/:id

访问边界: `admin`. [Preprocess.CleanCache](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L289)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "预处理缓存已清理"})
```

### GET /api/admin/preprocess/storage-usage

访问边界: `admin`. [Preprocess.GetStorageUsage](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L302)

参数: `DefaultQuery limit = 20`

```go
JSON(http.StatusOK, gin.H{"data": usage})
```

### POST /api/admin/preprocess/clean-orphan

访问边界: `admin`. [Preprocess.CleanOrphanCache](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L320)

```go
JSON(http.StatusOK, gin.H{
		"message": "孤儿预处理目录已清理",
		"data": gin.H{
			"cleaned":     cleaned,
			"freed_bytes": freed,
		},
	})
```

### GET /api/admin/cache/usage

访问边界: `admin`. [Preprocess.GetCacheUsage](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L339)

参数: `Query force; Query force`

```go
JSON(http.StatusOK, gin.H{"data": usage})
```

### POST /api/admin/cache/clean

访问边界: `admin`. [Preprocess.CleanCacheCategory](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L356)

参数: `Query key; Query mode`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "已清理",
		"data":    res,
	})
```

### POST /api/admin/cache/clean-all

访问边界: `admin`. [Preprocess.CleanAllCache](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L375)

```go
JSON(http.StatusOK, gin.H{
		"message": "一键清理完成",
		"data": gin.H{
			"results":      results,
			"total_freed":  totalFreed,
			"total_count":  totalCount,
			"category_num": len(results),
		},
	})
```

### POST /api/admin/preprocess/filter-preview

访问边界: `admin`. [Preprocess.PreviewByFilter](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L426)

```go
preprocessFilterRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": preview})
```

### POST /api/admin/preprocess/submit-by-filter

访问边界: `admin`. [Preprocess.SubmitByFilter](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L447)

```go
{
		preprocessFilterRequest
		Priority int  `json:"priority"`
		Force    bool `json:"force"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "已按筛选条件提交预处理任务",
		"data": gin.H{
			"submitted": submitted,
			"skipped":   skipped,
		},
	})
```

### GET /api/admin/preprocess/candidates

访问边界: `admin`. [Preprocess.ListCandidateMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/preprocess.go#L486)

参数: `DefaultQuery page = 1; DefaultQuery size = 20; Query only_need_preprocess; Query keyword; Query library_id; Query media_type; Query video_codec; Query sort_by; Query sort_order`

```go
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/video-analysis/tasks

访问边界: `admin`. [VideoAnalysis.SubmitMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L37)

```go
{
		MediaID             string `json:"media_id" binding:"required"`
		Force               bool   `json:"force"`
		IncludeDescriptions bool   `json:"include_descriptions"`
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
JSON(status, gin.H{"error": err.Error()})
JSON(http.StatusAccepted, gin.H{"data": task, "reused": reused})
```

### POST /api/admin/video-analysis/tasks/batch

访问边界: `admin`. [VideoAnalysis.BatchSubmit](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L68)

```go
{
		MediaIDs            []string `json:"media_ids" binding:"required,min=1,max=500"`
		Force               bool     `json:"force"`
		IncludeDescriptions bool     `json:"include_descriptions"`
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 1 到 500 个 media_ids"})
JSON(http.StatusAccepted, gin.H{"data": result})
```

### GET /api/admin/video-analysis/tasks

访问边界: `admin`. [VideoAnalysis.ListTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L130)

参数: `DefaultQuery page = 1; DefaultQuery page_size = 20; Query group_by_media; Query status; Query library_id; Query keyword; Query media_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询任务列表失败"})
JSON(http.StatusOK, gin.H{"data": gin.H{
		"tasks": tasks, "total": total, "page": page, "page_size": pageSize,
	}})
```

### GET /api/admin/video-analysis/tasks/latest

访问边界: `admin`. [VideoAnalysis.GetLatestTaskByMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L108)

参数: `Query media_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
JSON(http.StatusOK, gin.H{"data": nil})
JSON(http.StatusInternalServerError, gin.H{"error": "查询最新任务失败"})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /api/admin/video-analysis/tasks/:id

访问边界: `admin`. [VideoAnalysis.GetTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L91)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询任务失败"})
JSON(http.StatusOK, gin.H{"data": task})
```

### POST /api/admin/video-analysis/tasks/:id/retry

访问边界: `admin`. [VideoAnalysis.RetryTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L157)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusConflict, gin.H{"error": "该媒体已有进行中的视频分析任务", "data": task})
JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
JSON(http.StatusAccepted, gin.H{"data": task})
```

### DELETE /api/admin/video-analysis/tasks/:id

访问边界: `admin`. [VideoAnalysis.DeleteTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L180)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusConflict, gin.H{"error": "分析中的任务不可删除，请等待完成后再删"})
JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已删除"})
```

### GET /api/admin/video-analysis/statistics

访问边界: `admin`. [VideoAnalysis.Statistics](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L199)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询任务统计失败"})
JSON(http.StatusOK, gin.H{"data": counts})
```

### GET /api/admin/video-analysis/statistics/detailed

访问边界: `admin`. [VideoAnalysis.DetailedStatistics](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L212)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询详细统计失败"})
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/video-analysis/config

访问边界: `admin`. [VideoAnalysis.GetConfig](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L226)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusOK, gin.H{"data": config})
```

### GET /api/admin/video-analysis/health

访问边界: `admin`. [VideoAnalysis.GetHealth](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L237)

```go
JSON(http.StatusOK, gin.H{"data": h.service.GetHealth(c.Request.Context())})
```

### GET /api/admin/video-analysis/settings

访问边界: `admin`. [VideoAnalysis.GetSettings](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L319)

```go
JSON(http.StatusOK, gin.H{"data": videoAnalysisSettingsView{
		Enabled:            cfg.Enabled,
		SceneBaseURL:       cfg.SceneBaseURL,
		StructureBaseURL:   cfg.StructureBaseURL,
		RemoteVideoEnabled: cfg.RemoteVideoEnabled,
		AssetDir:           cfg.AssetDir,
		DescribeEnabled:    cfg.DescribeEnabled,
	}})
```

### PUT /api/admin/video-analysis/settings

访问边界: `admin`. [VideoAnalysis.UpdateSettings](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L334)

```go
updateVideoAnalysisSettingsRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "配置格式错误"})
JSON(http.StatusBadRequest, gin.H{"error": "启用视频分析需要填写 Scene 与 Structure 服务地址"})
JSON(http.StatusBadRequest, gin.H{"error": "启用视频分析需要配置产物目录 asset_dir"})
JSON(http.StatusBadRequest, gin.H{"error": "服务地址格式无效: " + err.Error()})
Status(http.StatusOK)
```

### POST /api/admin/video-analysis/cleanup

访问边界: `admin`. [VideoAnalysis.Cleanup](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L391)

```go
{
		KeepRecent int `json:"keep_recent"`
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "清理任务失败"})
JSON(http.StatusOK, gin.H{"data": gin.H{"deleted_count": deletedCount}})
```

### GET /api/admin/video-analysis/scenes/search

访问边界: `admin`. [VideoAnalysis.SearchScenes](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L495)

参数: `Query q; DefaultQuery limit = 20; DefaultQuery mode = text; Query library_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "缺少查询参数 q（文本查询）"})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("media_ids 数量超过上限 %d", sceneSearchMaxMediaIDs)})
JSON(http.StatusOK, gin.H{"data": results})
```

### GET /api/admin/video-analysis/tasks/:id/scenes

访问边界: `admin`. [VideoAnalysis.ListScenesByTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L535)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "taskId 是必填参数"})
JSON(http.StatusOK, gin.H{"scenes": items})
```

### GET /api/admin/video-analysis/tasks/:id/workflow

访问边界: `admin`. [VideoAnalysis.GetWorkflow](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L582)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"data": workflow})
```

### POST /api/admin/video-analysis/tasks/:id/run-stage

访问边界: `admin`. [VideoAnalysis.RunStage](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L596)

参数: `Param id`

```go
{
		Stage string `json:"stage" binding:"required"`
	}
```

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 stage 参数 (detect/structure/describe)"})
JSON(http.StatusOK, gin.H{"message": "阶段已启动"})
```

### POST /api/admin/video-analysis/tasks/:id/run-all

访问边界: `admin`. [VideoAnalysis.RunAll](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L616)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"message": "任务已全部执行完成"})
```

### POST /api/admin/video-analysis/tasks/:id/run-missing

访问边界: `admin`. [VideoAnalysis.RunMissing](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L629)

参数: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"message": "缺失阶段已补齐"})
```

### POST /api/admin/video-analysis/models/pull

访问边界: `admin`. [VideoAnalysis.PullModelHubModel](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/video_analysis.go#L266)

```go
{
		Model string `json:"model" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 model 参数（如 v-scheduler/ollama-qa/minicpm-v4.6:latest）"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "未配置 V-Scheduler 模型仓库地址（video_analysis.model_hub_api_url）"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusConflict, gin.H{"error": err.Error()})
JSON(http.StatusAccepted, gin.H{"data": gin.H{"task_id": taskID}})
```

### POST /api/admin/subtitle-preprocess/submit

访问边界: `admin`. [SubtitlePreprocess.SubmitMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L22)

```go
{
		MediaID         string   `json:"media_id" binding:"required"`
		TargetLangs     []string `json:"target_langs"`
		ForceRegenerate bool     `json:"force_regenerate"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
JSON(http.StatusOK, gin.H{
		"message": "字幕预处理任务已提交",
		"data":    task,
	})
```

### POST /api/admin/subtitle-preprocess/batch

访问边界: `admin`. [SubtitlePreprocess.BatchSubmit](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L46)

```go
{
		MediaIDs        []string `json:"media_ids" binding:"required"`
		TargetLangs     []string `json:"target_langs"`
		ForceRegenerate bool     `json:"force_regenerate"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量字幕预处理任务已提交",
		"data": gin.H{
			"submitted": len(tasks),
			"tasks":     tasks,
		},
	})
```

### POST /api/admin/subtitle-preprocess/library/:id

访问边界: `admin`. [SubtitlePreprocess.SubmitLibrary](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L73)

参数: `Param id`

```go
{
		TargetLangs     []string `json:"target_langs"`
		ForceRegenerate bool     `json:"force_regenerate"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供媒体库 ID"})
JSON(http.StatusOK, gin.H{
		"message": "媒体库字幕预处理任务已提交",
		"data": gin.H{
			"submitted": count,
		},
	})
```

### GET /api/admin/subtitle-preprocess/tasks

访问边界: `admin`. [SubtitlePreprocess.ListTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L101)

参数: `DefaultQuery page = 1; DefaultQuery page_size = 20; Query status`

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"tasks":     tasks,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
```

### GET /api/admin/subtitle-preprocess/tasks/:id

访问边界: `admin`. [SubtitlePreprocess.GetTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L130)

参数: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusOK, gin.H{"data": task})
```

### POST /api/admin/subtitle-preprocess/tasks/:id/cancel

访问边界: `admin`. [SubtitlePreprocess.CancelTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L142)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已取消"})
```

### POST /api/admin/subtitle-preprocess/tasks/:id/retry

访问边界: `admin`. [SubtitlePreprocess.RetryTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L153)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已重新提交"})
```

### DELETE /api/admin/subtitle-preprocess/tasks/:id

访问边界: `admin`. [SubtitlePreprocess.DeleteTask](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L164)

参数: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已删除"})
```

### GET /api/admin/subtitle-preprocess/statistics

访问边界: `admin`. [SubtitlePreprocess.GetStatistics](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L175)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### POST /api/admin/subtitle-preprocess/tasks/batch-delete

访问边界: `admin`. [SubtitlePreprocess.BatchDeleteTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L181)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量删除完成",
		"data":    gin.H{"deleted": deleted},
	})
```

### POST /api/admin/subtitle-preprocess/tasks/batch-cancel

访问边界: `admin`. [SubtitlePreprocess.BatchCancelTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L203)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量取消完成",
		"data":    gin.H{"cancelled": cancelled},
	})
```

### POST /api/admin/subtitle-preprocess/tasks/batch-retry

访问边界: `admin`. [SubtitlePreprocess.BatchRetryTasks](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L225)

```go
{
		TaskIDs []string `json:"task_ids" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 task_ids"})
JSON(http.StatusOK, gin.H{
		"message": "批量重试完成",
		"data":    gin.H{"retried": retried},
	})
```

### POST /api/admin/subtitle-preprocess/retry-all-failed

访问边界: `admin`. [SubtitlePreprocess.RetryAllFailed](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L264)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已重试 %d 个失败任务", count),
		"data":    gin.H{"retried": count},
	})
```

### DELETE /api/admin/subtitle-preprocess/tasks/by-status/:status

访问边界: `admin`. [SubtitlePreprocess.DeleteByStatus](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L278)

参数: `Param status`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供状态参数"})
JSON(http.StatusBadRequest, gin.H{"error": "不允许删除运行中的任务"})
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已删除 %d 个 %s 状态的任务", deleted, status),
		"data":    gin.H{"deleted": deleted},
	})
```

### GET /api/admin/subtitle-preprocess/asr-health

访问边界: `admin`. [SubtitlePreprocess.CheckASRHealth](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/subtitle_preprocess.go#L302)

```go
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/collections

访问边界: `admin`. [Collection.CreateCollection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L134)

```go
{
		Name     string   `json:"name" binding:"required"`
		MediaIDs []string `json:"media_ids"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
JSON(http.StatusOK, gin.H{"data": coll})
```

### POST /api/admin/collections/auto-match

访问边界: `admin`. [Collection.AutoMatch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L119)

```go
JSON(http.StatusOK, gin.H{
		"message": "自动匹配完成",
		"created": count,
	})
```

### POST /api/admin/collections/rematch

访问边界: `admin`. [Collection.Rematch](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L325)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("重新匹配完成，新建 %d 个合集", created),
		"created": created,
	})
```

### POST /api/admin/collections/merge-duplicates

访问边界: `admin`. [Collection.MergeDuplicates](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L293)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("合并完成，共处理 %d 组同名合集", merged),
		"merged":  merged,
	})
```

### POST /api/admin/collections/cleanup-empty

访问边界: `admin`. [Collection.CleanupEmpty](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L308)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("清理完成，共删除 %d 个空壳合集", cleaned),
		"cleaned": cleaned,
	})
```

### GET /api/admin/collections/duplicate-stats

访问边界: `admin`. [Collection.DuplicateStats](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L340)

```go
JSON(http.StatusOK, gin.H{
		"data":  stats,
		"count": len(stats),
	})
```

### PUT /api/admin/collections/:id

访问边界: `admin`. [Collection.UpdateCollection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L155)

参数: `Param id`

```go
{
		Name     string `json:"name" binding:"required"`
		Overview string `json:"overview"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
JSON(http.StatusOK, gin.H{"message": "更新成功"})
```

### DELETE /api/admin/collections/:id

访问边界: `admin`. [Collection.DeleteCollection](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L176)

参数: `Param id`

```go
JSON(http.StatusOK, gin.H{"message": "删除成功"})
```

### POST /api/admin/collections/:id/media

访问边界: `admin`. [Collection.AddMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L188)

参数: `Param id`

```go
{
		MediaID string `json:"media_id" binding:"required"`
	}
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
JSON(http.StatusOK, gin.H{"message": "添加成功"})
```

### DELETE /api/admin/collections/:id/media/:mediaId

访问边界: `admin`. [Collection.RemoveMedia](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/collection.go#L355)

参数: `Param id; Param mediaId`

```go
JSON(http.StatusOK, gin.H{"message": "移除成功"})
```

### GET /api/federation/health

访问边界: `separate/public`. [Federation.Health](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L678)

```go
JSON(http.StatusOK, health)
```

### GET /api/federation/media

访问边界: `separate/public`. [Federation.MediaList](https://github.com/ictrektech/nowen-video/blob/main/internal/handler/v2_handlers.go#L683)

```go
JSON(http.StatusOK, gin.H{"data": media})
```

## 共享字段声明

### UpdateMediaMetadataRequest

```go
{
	Title     *string  `json:"title"`
	OrigTitle *string  `json:"orig_title"`
	Year      *int     `json:"year"`
	Overview  *string  `json:"overview"`
	Rating    *float64 `json:"rating"`
	Genres    *string  `json:"genres"`
	Country   *string  `json:"country"`
	Language  *string  `json:"language"`
	Tagline   *string  `json:"tagline"`
	Studio    *string  `json:"studio"`
}
```

### UpdateMediaSTRMRequest

```go
{
	StreamURL    *string            `json:"stream_url"`    // 可选：替换远程 URL（token 过期后手工刷新等）
	UserAgent    *string            `json:"user_agent"`    // 单条覆盖 UA
	Referer      *string            `json:"referer"`       // 单条覆盖 Referer
	Cookie       *string            `json:"cookie"`        // 单条覆盖 Cookie
	Headers      *map[string]string `json:"headers"`       // 额外 Header（整体替换）
	RefreshURL   *string            `json:"refresh_url"`   // 刷新直链的上游 API（预留）
	ClearHeaders bool               `json:"clear_headers"` // 兼容字段：显式清空 headers
}
```

### UpdateSeriesMetadataRequest

```go
{
	Title     *string  `json:"title"`
	OrigTitle *string  `json:"orig_title"`
	Year      *int     `json:"year"`
	Overview  *string  `json:"overview"`
	Rating    *float64 `json:"rating"`
	Genres    *string  `json:"genres"`
	Country   *string  `json:"country"`
	Language  *string  `json:"language"`
	Studio    *string  `json:"studio"`
}
```

### UpdateTMDbConfigRequest

```go
{
	APIKey string `json:"api_key" binding:"required"`
}
```

### TestTMDbAPIKeyRequest

```go
{
	APIKey string `json:"api_key" binding:"required"`
}
```

### SearchMetadataRequest

```go
{
	Query     string `json:"query" binding:"required"`
	Year      int    `json:"year"`
	MediaType string `json:"media_type"` // movie, tv
}
```

### MatchMetadataRequest

```go
{
	TMDbID int `json:"tmdb_id" binding:"required"`
}
```

### UpdateDoubanConfigRequest

```go
{
	Cookie string `json:"cookie" binding:"required"`
}
```

### ImportDoubanCookieRequest

```go
{
	Cookie string `json:"cookie" binding:"required"`
}
```

### BatchScanRequest

```go
{
	LibraryIDs []string `json:"library_ids" binding:"required"`
}
```

### BatchScrapeRequest

```go
{
	MediaIDs []string `json:"media_ids" binding:"required"`
}
```

### UpdateUserPermissionRequest

```go
{
	AllowedLibraries string `json:"allowed_libraries"` // 逗号分隔的媒体库ID
	MaxRatingLevel   string `json:"max_rating_level"`
	DailyTimeLimit   int    `json:"daily_time_limit"` // 分钟
}
```

### SetContentRatingRequest

```go
{
	Level string `json:"level" binding:"required"` // G, PG, PG-13, R, NC-17
}
```

### UpdateSystemSettingsRequest

```go
{
	EnableGPUTranscode *bool `json:"enable_gpu_transcode"`
	AutoPreprocess     *bool `json:"auto_preprocess_on_scan"`
	AutoTranscode      *bool `json:"auto_transcode_on_play"`
}
```

### FsEntry

```go
{
		Name  string `json:"name"`
		Path  string `json:"path"`
		IsDir bool   `json:"is_dir"`
		Size  int64  `json:"size"`
	}
```

### MergeSeriesRequest

```go
{
	PrimaryID    string   `json:"primary_id" binding:"required"`
	SecondaryIDs []string `json:"secondary_ids" binding:"required"`
}
```

### CandidateGroup

```go
{
		NormalizedTitle string      `json:"normalized_title"`
		Count           int         `json:"count"`
		Series          interface{} `json:"series"`
	}
```

### ClearAllDataRequest

```go
{
	Confirm string `json:"confirm" binding:"required"` // 必须为 "CONFIRM_CLEAR_ALL"
}
```

### ClearTableResult

```go
{
	Table   string `json:"table"`
	Cleared int64  `json:"cleared"`
	Status  string `json:"status"` // success / skipped / error
	Message string `json:"message,omitempty"`
}
```

### UpdateTMDbProxyRequest

```go
{
	APIProxy     string `json:"api_proxy"`
	ImageProxy   string `json:"image_proxy"`
	NetworkProxy string `json:"network_proxy"`
}
```

### TestTMDbProxyRequest

```go
{
	APIProxy     *string `json:"api_proxy"`
	ImageProxy   *string `json:"image_proxy"`
	NetworkProxy *string `json:"network_proxy"`
}
```

### createApiKeyRequest

```go
{
	Name      string     `json:"name" binding:"required"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}
```

### vosOIDCRequest

```go
{
	AccessToken string `json:"access_token" binding:"required"`
}
```

### CreateBookmarkRequest

```go
{
	MediaID  string  `json:"media_id" binding:"required"`
	Position float64 `json:"position" binding:"required"`
	Title    string  `json:"title" binding:"required"`
	Note     string  `json:"note"`
}
```

### UpdateBookmarkRequest

```go
{
	Title string `json:"title" binding:"required"`
	Note  string `json:"note"`
}
```

### CastRequest

```go
{
	DeviceID string `json:"device_id" binding:"required"`
	MediaID  string `json:"media_id" binding:"required"`
}
```

### ControlRequest

```go
{
	Action string  `json:"action" binding:"required"` // play / pause / stop / seek / volume
	Value  float64 `json:"value"`                     // seek=秒数, volume=0-100
}
```

### CreateCommentRequest

```go
{
	Content string  `json:"content" binding:"required"`
	Rating  float64 `json:"rating"` // 可选评分
}
```

### ensureLibraryRequest

```go
{
	LocalPath string `json:"local_path" binding:"required"`
	// LibraryName 由前端按当前语言给出（库名会落库，服务端不本地化）
	LibraryName string `json:"library_name"`
}
```

### lazyIngestSubmitRequest

```go
{
	SourcePath  string `json:"source_path" binding:"required"`
	TargetRoot  string `json:"target_root"`
	NamingStyle string `json:"naming_style"`
	// hardlink（默认）/ move（专家模式：原地移动 + journal 回滚）
	Mode string `json:"mode"`
	// 强制重新入库：即使同源已被处理过也继续
	Force bool `json:"force"`
}
```

### CreateLibraryRequest

```go
{
	Name string `json:"name" binding:"required"`
	// Path 主路径（保留以兼容旧客户端）。如传入 Paths 则以 Paths[0] 为主路径
	Path string `json:"path"`
	// Paths 完整的媒体文件夹列表（支持多个）。与 Path 二选一，优先使用 Paths
	Paths []string `json:"paths"`
	Type  string   `json:"type" binding:"required,oneof=movie tvshow mixed other"`
	// 高级设置
	PreferLocalNFO    *bool   `json:"prefer_local_nfo"`
	EnableFileFilter  *bool   `json:"enable_file_filter"`
	MinFileSize       *int    `json:"min_file_size"`
	MetadataLang      *string `json:"metadata_lang"`
	AllowAdultContent *bool   `json:"allow_adult_content"`
	AutoDownloadSub   *bool   `json:"auto_download_sub"`
	// 扫描行为设置
	AutoScrapeMetadata *bool `json:"auto_scrape_metadata"`
	AutoAnalyzeVideo   *bool `json:"auto_analyze_video"`
	// AI 自动整理：off / rule_only / ai_assisted
	AutoOrganizeMode *string `json:"auto_organize_mode"`
	// 硬链接整理输出目录（为空=不落盘）
	OrganizeOutputDir *string `json:"organize_output_dir"`
	// 媒体库级别设置
	EnableFileWatch *bool `json:"enable_file_watch"`
}
```

### UpdateLibraryRequest

```go
{
	Name *string `json:"name"`
	// Path 主路径（保留）。传入 Paths 时优先使用 Paths
	Path  *string  `json:"path"`
	Paths []string `json:"paths"`
	Type  *string  `json:"type"`
	// 高级设置
	PreferLocalNFO    *bool   `json:"prefer_local_nfo"`
	EnableFileFilter  *bool   `json:"enable_file_filter"`
	MinFileSize       *int    `json:"min_file_size"`
	MetadataLang      *string `json:"metadata_lang"`
	AllowAdultContent *bool   `json:"allow_adult_content"`
	AutoDownloadSub   *bool   `json:"auto_download_sub"`
	// 扫描行为设置
	AutoScrapeMetadata *bool `json:"auto_scrape_metadata"`
	AutoAnalyzeVideo   *bool `json:"auto_analyze_video"`
	// AI 自动整理：off / rule_only / ai_assisted
	AutoOrganizeMode *string `json:"auto_organize_mode"`
	// 硬链接整理输出目录（为空=不落盘）
	OrganizeOutputDir *string `json:"organize_output_dir"`
	// 媒体库级别设置
	EnableFileWatch *bool `json:"enable_file_watch"`
}
```

### CreatePlaylistRequest

```go
{
	Name string `json:"name" binding:"required"`
}
```

### preprocessFilterRequest

```go
{
	service.PreprocessFilter
	ExcludeAlreadyPreprocessedPtr *bool `json:"exclude_already_preprocessed_ptr,omitempty"`
	ExcludeDirectlyPlayablePtr    *bool `json:"exclude_directly_playable_ptr,omitempty"`
	ExcludeStrmPtr                *bool `json:"exclude_strm_ptr,omitempty"`
}
```

### reprocessRequest

```go
{
	LibraryID string   `json:"library_id"`
	MediaIDs  []string `json:"media_ids"`
	Async     bool     `json:"async"` // 异步入队（默认 true，整库场景更稳）
}
```

### correctRequest

```go
{
	MediaID  string `json:"media_id" binding:"required"`
	Title    string `json:"title"`
	Year     int    `json:"year"`
	TMDbID   int    `json:"tmdb_id"`
	IMDbID   string `json:"imdb_id"`
	Category string `json:"category"`
	Region   string `json:"region"`
}
```

### scanRequest

```go
{
	RootPath              string   `json:"root_path" binding:"required"`
	LibraryID             string   `json:"library_id"`
	NamingStyle           string   `json:"naming_style"`
	Template              string   `json:"template"`
	EnableAIFallback      *bool    `json:"enable_ai_fallback"`
	AIConfidenceThreshold *float64 `json:"ai_confidence_threshold"`
	SafeRoots             []string `json:"safe_roots"`
}
```

### executeRequest

```go
{
	PlanID       string   `json:"plan_id" binding:"required"`
	Confirm      bool     `json:"confirm"`
	ItemIDs      []string `json:"item_ids"`
	IgnoreSafety bool     `json:"ignore_safety"`
}
```

### updateItemRequest

```go
{
	OverrideName string `json:"override_name"`
	Excluded     *bool  `json:"excluded"`
}
```

### UpdateWebDAVConfigRequest

```go
{
	Enabled       bool   `json:"enabled"`
	ServerURL     string `json:"server_url"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	BasePath      string `json:"base_path"`
	Timeout       int    `json:"timeout"`
	EnablePool    bool   `json:"enable_pool"`
	PoolSize      int    `json:"pool_size"`
	EnableCache   bool   `json:"enable_cache"`
	CacheTTLHours int    `json:"cache_ttl_hours"`
	MaxRetries    int    `json:"max_retries"`
	RetryInterval int    `json:"retry_interval"`
}
```

### TestWebDAVConnectionRequest

```go
{
	ServerURL string `json:"server_url" binding:"required"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	BasePath  string `json:"base_path"`
}
```

### RemoteFsEntry

```go
{
		Name string `json:"name"`
		Path string `json:"path"`
	}
```

### UpdateAlistConfigRequest

```go
{
	Enabled         bool   `json:"enabled"`
	ServerURL       string `json:"server_url"`
	Username        string `json:"username"`
	Password        string `json:"password"`
	Token           string `json:"token"`
	BasePath        string `json:"base_path"`
	Timeout         int    `json:"timeout"`
	EnableCache     bool   `json:"enable_cache"`
	CacheTTLHours   int    `json:"cache_ttl_hours"`
	ReadBlockSizeMB int    `json:"read_block_size_mb"`
	ReadBlockCount  int    `json:"read_block_count"`
}
```

### TestAlistRequest

```go
{
	ServerURL string `json:"server_url" binding:"required"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Token     string `json:"token"`
	BasePath  string `json:"base_path"`
}
```

### UpdateS3ConfigRequest

```go
{
	Enabled         bool   `json:"enabled"`
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	AccessKey       string `json:"access_key"`
	SecretKey       string `json:"secret_key"`
	Bucket          string `json:"bucket"`
	BasePath        string `json:"base_path"`
	PathStyle       bool   `json:"path_style"`
	Timeout         int    `json:"timeout"`
	EnableCache     bool   `json:"enable_cache"`
	CacheTTLHours   int    `json:"cache_ttl_hours"`
	ReadBlockSizeMB int    `json:"read_block_size_mb"`
	ReadBlockCount  int    `json:"read_block_count"`
}
```

### TestS3Request

```go
{
	Endpoint  string `json:"endpoint" binding:"required"`
	Region    string `json:"region"`
	AccessKey string `json:"access_key" binding:"required"`
	SecretKey string `json:"secret_key"`
	Bucket    string `json:"bucket" binding:"required"`
	BasePath  string `json:"base_path"`
	PathStyle bool   `json:"path_style"`
}
```

### UpdateProgressRequest

```go
{
	Position float64 `json:"position" binding:"required"`
	Duration float64 `json:"duration" binding:"required"`
}
```

### videoAnalysisSettingsView

```go
{
	Enabled            bool   `json:"enabled"`
	SceneBaseURL       string `json:"scene_base_url"`
	StructureBaseURL   string `json:"structure_base_url"`
	RemoteVideoEnabled bool   `json:"remote_video_enabled"`
	AssetDir           string `json:"asset_dir"`
	DescribeEnabled    bool   `json:"describe_enabled"`
}
```

### updateVideoAnalysisSettingsRequest

```go
{
	Enabled            bool   `json:"enabled"`
	SceneBaseURL       string `json:"scene_base_url"`
	StructureBaseURL   string `json:"structure_base_url"`
	RemoteVideoEnabled bool   `json:"remote_video_enabled"`
	DescribeEnabled    bool   `json:"describe_enabled"`
}
```

### sceneListItem

```go
{
		ID                  string  `json:"id"`
		VideoAnalysisTaskID string  `json:"video_analysis_task_id"`
		SceneIndex          int     `json:"scene_index"`
		StartTime           float64 `json:"start_time"`
		EndTime             float64 `json:"end_time"`
		ImagePath           string  `json:"image_path"`
		Description         string  `json:"description"`
		Status              string  `json:"status"`
		Error               string  `json:"error"`
		CreatedAt           string  `json:"created_at"`
	}
```

### AIUsageRecord

```go
{
	ID               string    `json:"id" gorm:"primaryKey;type:text"`
	Provider         string    `json:"provider" gorm:"index;type:text"`
	Model            string    `json:"model" gorm:"type:text"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	TotalTokens      int       `json:"total_tokens"`
	CostUSD          float64   `json:"cost_usd"`
	CostCNY          float64   `json:"cost_cny"`
	Scene            string    `json:"scene" gorm:"index;type:text"` // smart_search / recommend / metadata / autopilot / assistant ...
	LatencyMs        int64     `json:"latency_ms"`
	Success          bool      `json:"success"`
	CreatedAt        time.Time `json:"created_at" gorm:"index"`
}
```

### AIFailoverLog

```go
{
	ID           string    `json:"id" gorm:"primaryKey;type:text"`
	FromProvider string    `json:"from_provider" gorm:"type:text"`
	ToProvider   string    `json:"to_provider" gorm:"type:text"`
	Reason       string    `json:"reason" gorm:"index;type:text"` // quota_exhausted / http_429 / http_5xx / manual_switch / manual_restore / auto_recover
	Detail       string    `json:"detail" gorm:"type:text"`       // 错误体片段或操作来源
	Operator     string    `json:"operator" gorm:"type:text"`     // system / userID
	OccurredAt   time.Time `json:"occurred_at" gorm:"index"`
}
```

### IngestJob

```go
{
	ID string `json:"id" gorm:"primaryKey;type:text"`

	// 输入：用户唯一需要给的参数
	SourcePath string `json:"source_path" gorm:"type:text;not null"`

	// 自动派生：目标根目录（默认 = SourcePath/_organized）
	TargetRoot string `json:"target_root" gorm:"type:text"`

	// 执行策略（懒人模式默认值即可，全部硬编码到服务里，模型仅记录）
	KeepOriginal bool   `json:"keep_original" gorm:"default:true"` // 默认不删源
	NamingStyle  string `json:"naming_style" gorm:"type:text;default:jellyfin"`

	// 落盘模式：hardlink（默认，懒人）/ move（专家，原地移动 + journal 回滚）
	Mode string `json:"mode" gorm:"type:text;default:hardlink;index"`
	// Move 模式下的 journal 文件绝对路径（每行一条 JSON 操作记录，用于回滚）
	JournalPath string `json:"journal_path" gorm:"type:text"`

	// 状态机
	Status IngestJobStatus `json:"status" gorm:"type:text;default:pending;index"`
	Phase  string          `json:"phase" gorm:"type:text"` // 人类可读阶段（与 Status 对应，便于 UI 展示）

	// 进度（0-100，整体感知）
	Progress int `json:"progress"`

	// 派生产物
	LibraryIDs string `json:"library_ids" gorm:"type:text"` // JSON 数组：本次自动创建/复用的媒体库 ID
	PlanIDs    string `json:"plan_ids" gorm:"type:text"`    // JSON 数组：本次产出的 RenamePlan ID

	// 统计快照（JSON）
	// {"scanned":N,"classified":N,"planned":N,"executed":N,"skipped":N,"failed":N,"unsorted":N}
	Stats string `json:"stats" gorm:"type:text"`

	// 错误信息（最后一条致命错误）
	ErrorMessage string `json:"error_message" gorm:"type:text"`

	// 创建者（用户 ID，多用户审计）
	CreatedBy string `json:"created_by" gorm:"type:text"`

	CreatedAt   time.Time      `json:"created_at" gorm:"index"`
	UpdatedAt   time.Time      `json:"updated_at"`
	StartedAt   *time.Time     `json:"started_at"`
	CompletedAt *time.Time     `json:"completed_at"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}
```

### User

```go
{
	ID       string `json:"id" gorm:"primaryKey;type:text"`
	Username string `json:"username" gorm:"uniqueIndex;type:text;not null"`
	// VOSSubject is the immutable OIDC sub claim used to bind a VOS account.
	// NULL permits existing local-only users and multiple unbound accounts.
	VOSSubject *string `json:"-" gorm:"uniqueIndex;type:text"`
	Password   string  `json:"-" gorm:"type:text;not null"`        // bcrypt哈希，JSON不输出
	Role       string  `json:"role" gorm:"type:text;default:user"` // admin / user
	Avatar     string  `json:"avatar" gorm:"type:text"`
	// 扩展资料
	Nickname string `json:"nickname" gorm:"type:text"`
	Email    string `json:"email" gorm:"type:text;index"`
	// 账号状态
	Disabled      bool `json:"disabled" gorm:"default:false"`        // 是否被封禁
	MustChangePwd bool `json:"must_change_pwd" gorm:"default:false"` // 首次登录强制改密
	// 会话版本号：用于吊销旧 Token（密码/角色/封禁变更时自增）
	TokenVersion int `json:"-" gorm:"default:0"`
	// 最近登录
	LastLoginAt *time.Time     `json:"last_login_at"`
	LastLoginIP string         `json:"last_login_ip" gorm:"type:text"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}
```

### LoginLog

```go
{
	ID        string    `json:"id" gorm:"primaryKey;type:text"`
	UserID    string    `json:"user_id" gorm:"index;type:text"`
	Username  string    `json:"username" gorm:"type:text"` // 冗余便于展示（用户删除后仍可回溯）
	IP        string    `json:"ip" gorm:"type:text"`
	UserAgent string    `json:"user_agent" gorm:"type:text"`
	Success   bool      `json:"success" gorm:"index"`
	Reason    string    `json:"reason" gorm:"type:text"` // 失败原因（password_error / user_disabled / user_not_found）
	CreatedAt time.Time `json:"created_at" gorm:"index"`
}
```

### AuditLog

```go
{
	ID         string    `json:"id" gorm:"primaryKey;type:text"`
	OperatorID string    `json:"operator_id" gorm:"index;type:text"`
	Operator   string    `json:"operator" gorm:"type:text"`     // 操作者用户名（冗余）
	Action     string    `json:"action" gorm:"index;type:text"` // user.create / user.delete / user.reset_password / user.disable ...
	TargetType string    `json:"target_type" gorm:"type:text"`  // user / library / media / system
	TargetID   string    `json:"target_id" gorm:"type:text"`
	Detail     string    `json:"detail" gorm:"type:text"` // JSON 或文本描述
	IP         string    `json:"ip" gorm:"type:text"`
	CreatedAt  time.Time `json:"created_at" gorm:"index"`
}
```

### InviteCode

```go
{
	ID        string     `json:"id" gorm:"primaryKey;type:text"`
	Code      string     `json:"code" gorm:"uniqueIndex;type:text;not null"`
	MaxUses   int        `json:"max_uses" gorm:"default:1"` // 最大使用次数，0 表示无限
	UsedCount int        `json:"used_count" gorm:"default:0"`
	ExpiresAt *time.Time `json:"expires_at"` // 过期时间（nil 表示永不过期）
	CreatorID string     `json:"creator_id" gorm:"type:text"`
	Note      string     `json:"note" gorm:"type:text"`
	CreatedAt time.Time  `json:"created_at" gorm:"index"`
}
```

### Library

```go
{
	ID   string `json:"id" gorm:"primaryKey;type:text"`
	Name string `json:"name" gorm:"type:text;not null"`
	// Path 主路径（第一个媒体文件夹，保留以兼容历史数据）
	Path string `json:"path" gorm:"type:text;not null"`
	// ExtraPaths 额外媒体文件夹列表（JSON 数组），用于支持多个目录
	// 对外字段名为 extra_paths；聚合后的完整路径列表请使用 AllPaths()
	ExtraPaths string     `json:"extra_paths" gorm:"type:text"`
	Type       string     `json:"type" gorm:"type:text;default:movie"` // movie / tvshow / mixed / other
	LastScan   *time.Time `json:"last_scan"`
	// 高级设置
	PreferLocalNFO    bool   `json:"prefer_local_nfo" gorm:"default:true"`         // 优先读取本地NFO和图片
	MinFileSize       int    `json:"min_file_size" gorm:"default:3"`               // 排除小于此大小(MB)的视频文件
	EnableFileFilter  bool   `json:"enable_file_filter" gorm:"default:true"`       // 启用文件过滤
	MetadataLang      string `json:"metadata_lang" gorm:"type:text;default:zh-CN"` // 媒体元数据下载语言
	AllowAdultContent bool   `json:"allow_adult_content" gorm:"default:false"`     // 允许成人内容
	AutoDownloadSub   bool   `json:"auto_download_sub" gorm:"default:false"`       // 自动下载字幕
	// 扫描行为设置
	AutoScrapeMetadata bool `json:"auto_scrape_metadata" gorm:"default:true"` // 扫描后自动刮削元数据
	AutoAnalyzeVideo   bool `json:"auto_analyze_video" gorm:"default:false"`  // 扫描后自动提交视频分析任务
	// AI 自动整理（扫描后处理：识别 + 虚拟归类 + 命名映射，仅写 DB）
	//   off          - 关闭，不做任何后处理
	//   rule_only    - 仅规则识别+归类+命名（禁止调 AI）
	//   ai_assisted  - 规则 + 低置信度时 AI 兜底（默认）
	AutoOrganizeMode string `json:"auto_organize_mode" gorm:"type:text;default:ai_assisted"`
	// 硬链接整理输出目录（AI 自动整理时，按虚拟路径+建议名称创建硬链接到此目录下）
	// 为空则不进行硬链接操作（仅写 DB）；非空时按 VirtualPath/SuggestedName 建立硬链接目录树
	// 默认值为空字符串（禁用硬链接输出），用户可自定义设置为具体目录路径
	OrganizeOutputDir string `json:"organize_output_dir" gorm:"type:text;default:''"`
	// 实时文件监控（媒体库级别设置）
	EnableFileWatch bool `json:"enable_file_watch" gorm:"default:false"` // 启用实时文件监控
	// 时间戳
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}
```

### Series

```go
{
	ID           string  `json:"id" gorm:"primaryKey;type:text"`
	LibraryID    string  `json:"library_id" gorm:"index;type:text;not null"`
	Title        string  `json:"title" gorm:"index;type:text;not null"` // 剧集名称
	OrigTitle    string  `json:"orig_title" gorm:"type:text"`           // 原始标题
	Year         int     `json:"year" gorm:"index"`
	Overview     string  `json:"overview" gorm:"type:text"`
	PosterPath   string  `json:"poster_path" gorm:"type:text"`
	BackdropPath string  `json:"backdrop_path" gorm:"type:text"`
	Rating       float64 `json:"rating"`
	Genres       string  `json:"genres" gorm:"type:text"`
	FolderPath   string  `json:"folder_path" gorm:"uniqueIndex;type:text;not null"` // 剧集根目录路径
	SeasonCount  int     `json:"season_count"`                                      // 季数
	EpisodeCount int     `json:"episode_count"`                                     // 总集数
	// V2 扩展字段
	TMDbID    int    `json:"tmdb_id" gorm:"column:tmdb_id;index"`
	IMDbID    string `json:"imdb_id" gorm:"column:imdb_id;index;type:text"` // IMDB ID (tt开头)
	DoubanID  string `json:"douban_id" gorm:"type:text"`
	BangumiID int    `json:"bangumi_id" gorm:"index"` // Bangumi 条目 ID
	Country   string `json:"country" gorm:"type:text"`
	Language  string `json:"language" gorm:"type:text"`
	Studio    string `json:"studio" gorm:"type:text"`
	// 刮削状态：pending / scraped / partial / failed / manual（C 方案新增）
	ScrapeStatus string     `json:"scrape_status" gorm:"type:text;default:pending;index"`
	ScrapeSource string     `json:"scrape_source"` // 刮削来源（链路上第一个成功的主数据源，如 TMDb/豆瓣）
	LastScrapeAt *time.Time `json:"last_scrape_at,omitempty"`
	// 时间戳
	CreatedAt time.Time      `json:"created_at" gorm:"index"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`

	Library  Library `json:"-" gorm:"foreignKey:LibraryID"`
	Episodes []Media `json:"episodes,omitempty" gorm:"foreignKey:SeriesID"`
}
```

### MovieCollection

```go
{
	ID          string    `json:"id" gorm:"primaryKey;type:text"`
	Name        string    `json:"name" gorm:"index;type:text;not null"` // 合集名称（如"逃学威龙"）
	Overview    string    `json:"overview" gorm:"type:text"`            // 合集简介
	PosterPath  string    `json:"poster_path" gorm:"type:text"`         // 合集海报（取第一部的海报）
	TMDbCollID  int       `json:"tmdb_coll_id" gorm:"index"`            // TMDb Collection ID
	MediaCount  int       `json:"media_count"`                          // 去重后的电影数量（同一部电影的不同版本算一部）
	FileCount   int       `json:"file_count"`                           // 原始文件总数（每个版本各算一个）
	AutoMatched bool      `json:"auto_matched" gorm:"default:true"`     // 是否自动匹配生成
	YearRange   string    `json:"year_range" gorm:"type:text"`          // 年份范围（如"1991-1993"或"2020"）
	CreatedAt   time.Time `json:"created_at" gorm:"index"`
	UpdatedAt   time.Time `json:"updated_at"`

	Media []Media `json:"media,omitempty" gorm:"foreignKey:CollectionID"`
}
```

### Media

```go
{
	ID           string `json:"id" gorm:"primaryKey;type:text"`
	LibraryID    string `json:"library_id" gorm:"index;type:text;not null"`
	Title        string `json:"title" gorm:"index;type:text;not null"`
	OrigTitle    string `json:"orig_title" gorm:"type:text"` // 原始标题
	Year         int    `json:"year" gorm:"index"`
	Overview     string `json:"overview" gorm:"type:text"`
	PosterPath   string `json:"poster_path" gorm:"type:text"`   // 海报图片路径
	BackdropPath string `json:"backdrop_path" gorm:"type:text"` // 背景图路径
	// PosterOrigin 海报来源（embedded / frame，空 = 非程序生成）：仅当封面是从视频生成的派生图时置值。
	// 由接口在读取时填充，不落库（写入 DB 会与真实图片状态不一致）。
	PosterOrigin string  `json:"poster_origin,omitempty" gorm:"-"`
	Rating       float64 `json:"rating"`
	Runtime      int     `json:"runtime"`                             // 时长（分钟）
	Genres       string  `json:"genres" gorm:"type:text"`             // 逗号分隔的类型
	FilePath     string  `json:"file_path" gorm:"type:text;not null"` // 视频文件绝对路径
	FileSize     int64   `json:"file_size"`
	MediaType    string  `json:"media_type" gorm:"type:text;default:movie"` // movie / episode
	// 视频信息
	VideoCodec string  `json:"video_codec" gorm:"type:text"`
	AudioCodec string  `json:"audio_codec" gorm:"type:text"`
	Resolution string  `json:"resolution" gorm:"type:text"` // 1080p, 4K 等
	Duration   float64 `json:"duration"`                    // 时长（秒）
	// 字幕
	SubtitlePaths string `json:"subtitle_paths" gorm:"type:text"` // 外挂字幕路径，| 分隔
	// STRM 远程流支持
	StreamURL string `json:"stream_url" gorm:"type:text"` // .strm 文件中的远程流地址（为空表示本地文件）
	// STRM 增强字段：由 .strm 同目录 .json / KODI #KODIPROP / M3U 扩展头 携带的请求参数
	StreamUA         string `json:"stream_ua" gorm:"type:text"`          // 自定义 User-Agent（某些云盘/HLS 源要求）
	StreamReferer    string `json:"stream_referer" gorm:"type:text"`     // 自定义 Referer
	StreamCookie     string `json:"stream_cookie" gorm:"type:text"`      // 自定义 Cookie（多条用分号分隔）
	StreamHeaders    string `json:"stream_headers" gorm:"type:text"`     // 额外自定义 Header，JSON: {"X-K":"V"}
	StreamRefreshURL string `json:"stream_refresh_url" gorm:"type:text"` // 刷新直链的上游 API（预留，留空表示不刷新）
	// V2 扩展字段
	TMDbID     int    `json:"tmdb_id" gorm:"column:tmdb_id;index"`           // TMDb 唯一 ID
	IMDbID     string `json:"imdb_id" gorm:"column:imdb_id;index;type:text"` // IMDB ID (tt开头)
	DoubanID   string `json:"douban_id" gorm:"type:text"`                    // 豆瓣 ID
	BangumiID  int    `json:"bangumi_id" gorm:"index"`                       // Bangumi 条目 ID
	Premiered  string `json:"premiered" gorm:"type:text"`                    // 首映日期（NFO YYYY-MM-DD）
	Country    string `json:"country" gorm:"type:text"`                      // 制片国家
	Language   string `json:"language" gorm:"type:text"`                     // 语言
	Tagline    string `json:"tagline" gorm:"type:text"`                      // 标语/宣传语
	Studio     string `json:"studio" gorm:"type:text"`                       // 出品公司
	TrailerURL string `json:"trailer_url" gorm:"type:text"`                  // 预告片链接（YouTube）
	// NFO 扩展字段（方案 B 完整建模，用于番号/成人内容等精细展示）
	Num          string `json:"num" gorm:"index;type:text"`       // 番号（如 MIDD-835），取自 NFO <num>
	SortTitle    string `json:"sort_title" gorm:"type:text"`      // 排序用标题，取自 NFO <sorttitle>
	Outline      string `json:"outline" gorm:"type:text"`         // 剧情简要（短摘要），取自 NFO <outline>
	OriginalPlot string `json:"original_plot" gorm:"type:text"`   // 原始剧情（日文/原文），取自 NFO <originalplot>
	MPAA         string `json:"mpaa" gorm:"type:text"`            // 分级（如 JP-18+），取自 NFO <mpaa>/<customrating>
	CountryCode  string `json:"country_code" gorm:"type:text"`    // 国家代码（JP/CN/US），取自 NFO <countrycode>
	Maker        string `json:"maker" gorm:"index;type:text"`     // 制作商，取自 NFO <maker>
	Publisher    string `json:"publisher" gorm:"index;type:text"` // 发行商，取自 NFO <publisher>
	Label        string `json:"label" gorm:"index;type:text"`     // 厂牌，取自 NFO <label>
	Tags         string `json:"tags" gorm:"type:text"`            // 用户标签（逗号分隔），取自 NFO <tag>，与 genres 并列
	Website      string `json:"website" gorm:"type:text"`         // 官方网站，取自 NFO <website>
	ReleaseDate  string `json:"release_date" gorm:"type:text"`    // 发行日期（可独立于首映日期），取自 NFO <releasedate>
	// 多CD堆叠 & 多版本聚合（P2）
	StackGroup   string `json:"stack_group" gorm:"index;type:text"`   // 堆叠组 ID（cd1/cd2 共享同一组 ID）
	StackOrder   int    `json:"stack_order"`                          // 堆叠顺序（1=cd1, 2=cd2...）
	VersionTag   string `json:"version_tag" gorm:"type:text"`         // 版本标识（"4K", "Director's Cut" 等）
	VersionGroup string `json:"version_group" gorm:"index;type:text"` // 同一内容的不同版本共享此 ID
	// 刮削状态追踪（P3）
	ScrapeStatus   string     `json:"scrape_status" gorm:"type:text;default:pending"` // pending / scraped / failed / manual
	ScrapeSource   string     `json:"scrape_source" gorm:"type:text"`                 // 刮削来源（链路上第一个成功的主数据源）
	ScrapeAttempts int        `json:"scrape_attempts"`                                // 刮削尝试次数
	LastScrapeAt   *time.Time `json:"last_scrape_at"`                                 // 最后一次刮削时间
	// 电影系列合集
	// default:NULL — 空字符串零值入库时必须转 NULL，否则违反 fk_movie_collections_media 外键（PostgreSQL 对 '' 做引用检查，NULL 才放行）
	CollectionID string `json:"collection_id" gorm:"index;type:text;default:NULL"` // 所属电影合集 ID
	// 重复媒体检测
	DuplicateOf    string `json:"duplicate_of" gorm:"index;type:text"`    // 重复的原始媒体 ID（为空表示非重复）
	DuplicateGroup string `json:"duplicate_group" gorm:"index;type:text"` // 重复组标识（相同标题+年份的媒体共享此标识）
	// 剧集专属字段
	// default:NULL — 空字符串零值入库时必须转 NULL，否则违反 fk_series_episodes 外键（PostgreSQL 对 '' 做引用检查，NULL 才放行）
	SeriesID     string `json:"series_id" gorm:"index;type:text;default:NULL"` // 所属剧集 ID（单集/剧集入库时为 NULL）
	SeasonNum    int    `json:"season_num"`
	EpisodeNum   int    `json:"episode_num"`
	EpisodeTitle string `json:"episode_title" gorm:"type:text"` // 单集标题（如有）
	// 时间戳
	CreatedAt time.Time      `json:"created_at" gorm:"index"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`

	Library    Library          `json:"-" gorm:"foreignKey:LibraryID"`
	Series     *Series          `json:"series,omitempty" gorm:"foreignKey:SeriesID"`
	Collection *MovieCollection `json:"collection,omitempty" gorm:"foreignKey:CollectionID"`
}
```

### Person

```go
{
	ID         string `json:"id" gorm:"primaryKey;type:text"`
	Name       string `json:"name" gorm:"index;type:text;not null"`
	OrigName   string `json:"orig_name" gorm:"type:text"`
	ProfileURL string `json:"profile_url" gorm:"type:text"` // 头像路径
	TMDbID     int    `json:"tmdb_id" gorm:"column:tmdb_id;index"`
	// 时间戳
	CreatedAt time.Time `json:"created_at"`
}
```

### MediaPerson

```go
{
	ID        string `json:"id" gorm:"primaryKey;type:text"`
	MediaID   string `json:"media_id" gorm:"index;type:text;not null"`
	SeriesID  string `json:"series_id" gorm:"index;type:text"` // 也可以关联到 Series
	PersonID  string `json:"person_id" gorm:"index;type:text;not null"`
	Role      string `json:"role" gorm:"type:text;not null"` // director / actor / writer
	Character string `json:"character" gorm:"type:text"`     // 饰演角色名
	SortOrder int    `json:"sort_order" gorm:"default:0"`
	// 时间戳
	CreatedAt time.Time `json:"created_at"`

	Person Person `json:"person" gorm:"foreignKey:PersonID"`
}
```

### WatchHistory

```go
{
	ID        string    `json:"id" gorm:"primaryKey;type:text"`
	UserID    string    `json:"user_id" gorm:"index;type:text;not null"`
	ProfileID string    `json:"profile_id" gorm:"index;type:text"` // Profile 隔离（空=账号级历史，兼容旧数据）
	MediaID   string    `json:"media_id" gorm:"index;type:text;not null"`
	Position  float64   `json:"position"`  // 观看进度（秒）
	Duration  float64   `json:"duration"`  // 总时长（秒）
	Completed bool      `json:"completed"` // 是否看完
	UpdatedAt time.Time `json:"updated_at" gorm:"index"`
	CreatedAt time.Time `json:"created_at"`

	User  User  `json:"-" gorm:"foreignKey:UserID"`
	Media Media `json:"media" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### Favorite

```go
{
	ID        string    `json:"id" gorm:"primaryKey;type:text"`
	UserID    string    `json:"user_id" gorm:"index;type:text;not null"`
	ProfileID string    `json:"profile_id" gorm:"index;type:text"` // Profile 隔离（空=账号级收藏，兼容旧数据）
	MediaID   string    `json:"media_id" gorm:"index;type:text;not null"`
	CreatedAt time.Time `json:"created_at"`

	User  User  `json:"-" gorm:"foreignKey:UserID"`
	Media Media `json:"media" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### TranscodeTask

```go
{
	ID         string  `json:"id" gorm:"primaryKey;type:text"`
	MediaID    string  `json:"media_id" gorm:"index;type:text;not null"`
	Status     string  `json:"status" gorm:"type:text;default:pending"` // pending / running / done / failed / cancelled
	Quality    string  `json:"quality" gorm:"type:text"`                // 720p / 1080p / 4k
	Progress   float64 `json:"progress"`                                // 0-100
	OutputDir  string  `json:"output_dir" gorm:"type:text"`
	Error      string  `json:"error" gorm:"type:text"`
	MediaTitle string  `json:"media_title" gorm:"type:text"` // 媒体标题（冗余，方便列表展示）
	Priority   int     `json:"priority" gorm:"default:0"`    // 优先级（保留字段，当前转码服务为按需触发）
	Retries    int     `json:"retries" gorm:"default:0"`     // 已重试次数
	MaxRetry   int     `json:"max_retry" gorm:"default:0"`   // 最大重试次数（0=不自动重试）
	// 时间字段
	StartedAt   *time.Time `json:"started_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`

	// 关联（仅查询时按需 Preload）
	Media Media `json:"media,omitempty" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### Playlist

```go
{
	ID        string         `json:"id" gorm:"primaryKey;type:text"`
	UserID    string         `json:"user_id" gorm:"index;type:text;not null"`
	Name      string         `json:"name" gorm:"type:text;not null"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`

	User  User           `json:"-" gorm:"foreignKey:UserID"`
	Items []PlaylistItem `json:"items" gorm:"foreignKey:PlaylistID"`
}
```

### PlaylistItem

```go
{
	ID         string    `json:"id" gorm:"primaryKey;type:text"`
	PlaylistID string    `json:"playlist_id" gorm:"index;type:text;not null"`
	MediaID    string    `json:"media_id" gorm:"index;type:text;not null"`
	SortOrder  int       `json:"sort_order" gorm:"default:0"`
	CreatedAt  time.Time `json:"created_at"`

	Media Media `json:"media" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### Bookmark

```go
{
	ID        string    `json:"id" gorm:"primaryKey;type:text"`
	UserID    string    `json:"user_id" gorm:"index;type:text;not null"`
	MediaID   string    `json:"media_id" gorm:"index;type:text;not null"`
	Position  float64   `json:"position"`                        // 书签时间点（秒）
	Title     string    `json:"title" gorm:"type:text;not null"` // 书签标题
	Note      string    `json:"note" gorm:"type:text"`           // 备注
	CreatedAt time.Time `json:"created_at"`

	User  User  `json:"-" gorm:"foreignKey:UserID"`
	Media Media `json:"media,omitempty" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### Comment

```go
{
	ID        string         `json:"id" gorm:"primaryKey;type:text"`
	UserID    string         `json:"user_id" gorm:"index;type:text;not null"`
	MediaID   string         `json:"media_id" gorm:"index;type:text;not null"`
	Content   string         `json:"content" gorm:"type:text;not null"`
	Rating    float64        `json:"rating"` // 用户评分（0-10）
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`

	User  User  `json:"user,omitempty" gorm:"foreignKey:UserID"`
	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### DanmakuComment

```go
{
	ID         string    `json:"id" gorm:"primaryKey;type:text"`
	MediaID    string    `json:"media_id" gorm:"index;type:text;not null"`
	Source     string    `json:"source" gorm:"uniqueIndex:idx_danmaku_source_item;type:text;not null"`    // javdb / local
	SourceID   string    `json:"source_id" gorm:"uniqueIndex:idx_danmaku_source_item;type:text;not null"` // 外部评论稳定 ID 或内容哈希
	Author     string    `json:"author" gorm:"type:text"`
	Content    string    `json:"content" gorm:"type:text;not null"`
	Rating     float64   `json:"rating"`
	Likes      int       `json:"likes"`
	Position   float64   `json:"position"`               // 出现时间（秒）
	Color      string    `json:"color" gorm:"type:text"` // CSS 色值
	Mode       string    `json:"mode" gorm:"type:text;default:scroll"`
	ImportedAt time.Time `json:"imported_at" gorm:"index"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### ContentRating

```go
{
	ID        string    `json:"id" gorm:"primaryKey;type:text"`
	MediaID   string    `json:"media_id" gorm:"uniqueIndex;type:text;not null"`
	Level     string    `json:"level" gorm:"type:text;not null"` // G, PG, PG-13, R, NC-17
	CreatedAt time.Time `json:"created_at"`
}
```

### UserPermission

```go
{
	ID               string    `json:"id" gorm:"primaryKey;type:text"`
	UserID           string    `json:"user_id" gorm:"uniqueIndex;type:text;not null"`
	AllowedLibraries string    `json:"allowed_libraries" gorm:"type:text"`              // 允许访问的媒体库ID，逗号分隔，空表示全部
	MaxRatingLevel   string    `json:"max_rating_level" gorm:"type:text;default:NC-17"` // 最高允许观看的分级
	DailyTimeLimit   int       `json:"daily_time_limit" gorm:"default:0"`               // 每日观看时长限制（分钟），0表示不限
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`

	User User `json:"-" gorm:"foreignKey:UserID"`
}
```

### SystemSetting

```go
{
	Key       string    `json:"key" gorm:"primaryKey;type:text"`
	Value     string    `json:"value" gorm:"type:text"`
	UpdatedAt time.Time `json:"updated_at"`
}
```

### PlaybackStats

```go
{
	ID           string    `json:"id" gorm:"primaryKey;type:text"`
	UserID       string    `json:"user_id" gorm:"index;type:text;not null"`
	MediaID      string    `json:"media_id" gorm:"index;type:text;not null"`
	WatchMinutes float64   `json:"watch_minutes"`               // 本次观看分钟数
	Date         string    `json:"date" gorm:"index;type:text"` // YYYY-MM-DD 格式
	CreatedAt    time.Time `json:"created_at"`
}
```

### AICacheEntry

```go
{
	CacheKey  string    `json:"cache_key" gorm:"primaryKey;type:text"`
	Value     string    `json:"value" gorm:"type:text"`
	ExpiresAt time.Time `json:"expires_at" gorm:"index"`
	CreatedAt time.Time `json:"created_at"`
}
```

### GenreMapping

```go
{
	ID           string `json:"id" gorm:"primaryKey;type:text"`
	SourceGenre  string `json:"source_genre" gorm:"uniqueIndex:idx_source_genre;type:text;not null"` // 原始标签（如 "Sci-Fi"）
	SourceType   string `json:"source_type" gorm:"uniqueIndex:idx_source_genre;type:text;not null"`  // 来源（tmdb/douban/bangumi/ai）
	StandardName string `json:"standard_name" gorm:"index;type:text;not null"`                       // 标准化名称（如 "科幻"）
}
```

### RecommendCache

```go
{
	UserID    string    `json:"user_id" gorm:"primaryKey;type:text"`
	Results   string    `json:"results" gorm:"type:text"` // JSON 序列化的推荐结果
	ExpiresAt time.Time `json:"expires_at" gorm:"index"`
	UpdatedAt time.Time `json:"updated_at"`
}
```

### PreprocessTask

```go
{
	ID         string  `json:"id" gorm:"primaryKey;type:text"`
	MediaID    string  `json:"media_id" gorm:"index;type:text;not null"`
	Status     string  `json:"status" gorm:"type:text;default:pending"` // pending / queued / running / paused / completed / failed / cancelled
	Phase      string  `json:"phase" gorm:"type:text"`                  // probe / thumbnail / keyframes / transcode_360p / transcode_480p / transcode_720p / transcode_1080p / abr_master
	Progress   float64 `json:"progress"`                                // 0-100 总体进度
	Priority   int     `json:"priority" gorm:"default:0"`               // 优先级（数字越大越优先）
	Message    string  `json:"message" gorm:"type:text"`                // 当前状态描述
	Error      string  `json:"error" gorm:"type:text"`                  // 错误信息
	Retries    int     `json:"retries" gorm:"default:0"`                // 已重试次数
	MaxRetry   int     `json:"max_retry" gorm:"default:3"`              // 最大重试次数
	InputPath  string  `json:"input_path" gorm:"type:text"`             // 输入文件路径
	OutputDir  string  `json:"output_dir" gorm:"type:text"`             // 输出目录
	MediaTitle string  `json:"media_title" gorm:"type:text"`            // 媒体标题（冗余，方便展示）
	// 预处理结果
	ThumbnailPath  string  `json:"thumbnail_path" gorm:"type:text"`  // 封面缩略图路径
	KeyframesDir   string  `json:"keyframes_dir" gorm:"type:text"`   // 关键帧预览目录
	SpritePath     string  `json:"sprite_path" gorm:"type:text"`     // 进度条雪碧图路径
	SpriteVTTPath  string  `json:"sprite_vtt_path" gorm:"type:text"` // 进度条雪碧图 WebVTT 索引路径
	HLSMasterPath  string  `json:"hls_master_path" gorm:"type:text"` // HLS 主播放列表路径
	Variants       string  `json:"variants" gorm:"type:text"`        // 已完成的变体列表（JSON: ["360p","720p","1080p"]）
	SourceHeight   int     `json:"source_height"`                    // 源视频高度
	SourceWidth    int     `json:"source_width"`                     // 源视频宽度
	SourceCodec    string  `json:"source_codec" gorm:"type:text"`    // 源视频编码
	SourceDuration float64 `json:"source_duration"`                  // 源视频时长（秒）
	SourceSize     int64   `json:"source_size"`                      // 源文件大小（字节）
	// 性能统计
	StartedAt   *time.Time `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at"`
	ElapsedSec  float64    `json:"elapsed_sec"` // 总耗时（秒）
	SpeedRatio  float64    `json:"speed_ratio"` // 转码速度比（如 2.5x）
	// 时间戳
	CreatedAt time.Time `json:"created_at" gorm:"index"`
	UpdatedAt time.Time `json:"updated_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### SubtitlePreprocessTask

```go
{
	ID         string  `json:"id" gorm:"primaryKey;type:text"`
	MediaID    string  `json:"media_id" gorm:"index;type:text;not null"`
	Status     string  `json:"status" gorm:"type:text;default:pending"` // pending / running / completed / failed / cancelled / skipped
	Phase      string  `json:"phase" gorm:"type:text"`                  // check / extract / generate / clean / translate / done
	Progress   float64 `json:"progress"`                                // 0-100 总体进度
	Message    string  `json:"message" gorm:"type:text"`                // 当前状态描述
	Error      string  `json:"error" gorm:"type:text"`                  // 错误信息
	MediaTitle string  `json:"media_title" gorm:"type:text"`            // 媒体标题（冗余，方便展示）
	// 配置
	SourceLang      string `json:"source_lang" gorm:"type:text;default:auto"` // 源语言（auto 自动检测）
	TargetLangs     string `json:"target_langs" gorm:"type:text"`             // 目标翻译语言列表（逗号分隔: zh,en,ja）
	ForceRegenerate bool   `json:"force_regenerate"`                          // 是否强制重新生成
	// 结果
	OriginalVTTPath  string `json:"original_vtt_path" gorm:"type:text"` // 原始字幕 VTT 路径
	TranslatedPaths  string `json:"translated_paths" gorm:"type:text"`  // 翻译字幕路径（格式: lang=path|lang=path）
	SubtitleSource   string `json:"subtitle_source" gorm:"type:text"`   // 字幕来源: ai_cached / external_vtt / extracted / ai_generated
	DetectedLanguage string `json:"detected_language" gorm:"type:text"` // 检测到的源语言
	CueCount         int    `json:"cue_count"`                          // 字幕条目数
	// 增强字段
	FailedLangs     string `json:"failed_langs" gorm:"type:text"`      // 翻译失败的语言列表（逗号分隔），用于前端展示
	CleanReportJSON string `json:"clean_report_json" gorm:"type:text"` // 清洗详细报告（JSON 字符串）
	// 性能统计
	StartedAt   *time.Time `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at"`
	ElapsedSec  float64    `json:"elapsed_sec"` // 总耗时（秒）
	// 时间戳
	CreatedAt time.Time `json:"created_at" gorm:"index"`
	UpdatedAt time.Time `json:"updated_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### FileOperationLog

```go
{
	ID        string    `json:"id" gorm:"primaryKey;type:text"`
	Action    string    `json:"action" gorm:"index;type:text"`   // import / edit / delete / scrape / rename / batch_scrape / batch_rename / reclassify / create_folder / rename_folder / delete_folder
	MediaID   string    `json:"media_id" gorm:"index;type:text"` // 关联的媒体ID（如适用）
	Detail    string    `json:"detail" gorm:"type:text"`         // 操作详情
	OldValue  string    `json:"old_value" gorm:"type:text"`      // 旧值（用于回滚）
	NewValue  string    `json:"new_value" gorm:"type:text"`      // 新值
	UserID    string    `json:"user_id" gorm:"index;type:text"`  // 操作者
	CreatedAt time.Time `json:"created_at" gorm:"index"`         // 操作时间
}
```

### MediaClassification

```go
{
	ID        string `json:"id" gorm:"primaryKey;type:text"`
	MediaID   string `json:"media_id" gorm:"uniqueIndex;type:text;not null"`
	LibraryID string `json:"library_id" gorm:"index;type:text"`

	// =========== 阶段 1：识别（来自 filename_parser + 可选 AI Fallback） ===========
	ParsedTitle    string  `json:"parsed_title" gorm:"type:text"`
	ParsedTitleAlt string  `json:"parsed_title_alt" gorm:"type:text"`
	ParsedYear     int     `json:"parsed_year"`
	ParsedTMDbID   int     `json:"parsed_tmdb_id" gorm:"index"`
	ParsedIMDbID   string  `json:"parsed_imdb_id" gorm:"index;type:text"`
	Confidence     float64 `json:"confidence"`                       // 综合置信度（0-1）
	AIInvoked      bool    `json:"ai_invoked"`                       // 是否调用了 AI Fallback
	AIProvider     string  `json:"ai_provider" gorm:"type:text"`     // AI 服务商（来自 AI 配置当前生效项，例如 openai/deepseek/anthropic）
	AIModel        string  `json:"ai_model" gorm:"type:text"`        // AI 模型名（如 gpt-4o-mini / deepseek-chat）
	AIRawResponse  string  `json:"ai_raw_response" gorm:"type:text"` // AI 原始响应（JSON 字符串）

	// =========== 阶段 2：虚拟归类（按规则推导，仅 DB 标签） ===========
	Category    string `json:"category" gorm:"index;type:text"`     // movie/tvshow/anime/documentary/variety/music/adult/other
	Region      string `json:"region" gorm:"index;type:text"`       // CN/HK/TW/JP/KR/US/EU/IN/OTHER
	Decade      string `json:"decade" gorm:"index;type:text"`       // 2020s/2010s/2000s/1990s/...
	GenreTags   string `json:"genre_tags" gorm:"type:text"`         // 规范化后的逗号分隔类型
	LanguageTag string `json:"language_tag" gorm:"type:text"`       // zh/ja/en/...
	QualityTier string `json:"quality_tier" gorm:"type:text"`       // 4K/1080p/720p/SD
	VirtualPath string `json:"virtual_path" gorm:"index;type:text"` // 虚拟路径，如 "电影/华语/2020s/科幻"

	// =========== 阶段 3：Jellyfin/Emby 风格命名建议（仅记录） ===========
	SuggestedName     string `json:"suggested_name" gorm:"type:text"`      // 例：流浪地球 (2019) [tmdbid-12345].mkv
	SuggestedDir      string `json:"suggested_dir" gorm:"type:text"`       // 例：流浪地球 (2019)
	SuggestedFullPath string `json:"suggested_full_path" gorm:"type:text"` // libraryRoot/SuggestedDir/SuggestedName
	NamingStyle       string `json:"naming_style" gorm:"type:text"`        // jellyfin/plex

	// =========== 流程状态 ===========
	Status      string     `json:"status" gorm:"index;type:text;default:pending"`
	ErrorMsg    string     `json:"error_msg" gorm:"type:text"`
	ProcessedAt *time.Time `json:"processed_at"`

	CreatedAt time.Time      `json:"created_at" gorm:"index"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}
```

### RenamePlan

```go
{
	ID        string `json:"id" gorm:"primaryKey;type:text"`
	LibraryID string `json:"library_id" gorm:"index;type:text"`

	// 描述：扫描的根目录（绝对路径）
	RootPath string `json:"root_path" gorm:"type:text"`
	// 命名模板风格："jellyfin" / "plex"（默认 jellyfin）
	NamingStyle string `json:"naming_style" gorm:"type:text;default:jellyfin"`
	// 用户实际选用的模板表达式（可空，空则用默认）
	Template string `json:"template" gorm:"type:text"`
	// 是否启用 AI Fallback
	EnableAIFallback bool `json:"enable_ai_fallback" gorm:"default:true"`
	// AI 介入触发阈值（0~1，规则评分低于该值才调 AI）
	AIConfidenceThreshold float64 `json:"ai_confidence_threshold" gorm:"default:0.7"`

	// 状态
	Status RenamePlanStatus `json:"status" gorm:"type:text;default:draft;index"`
	// 是否仅 dry-run（强制只生成 plan 不落盘）
	DryRun bool `json:"dry_run" gorm:"default:true"`

	// 统计快照
	TotalItems    int `json:"total_items"`
	NeedRename    int `json:"need_rename"`    // 真正需要改名的条目数
	SkippedItems  int `json:"skipped_items"`  // 命中目标格式或被忽略
	UnsafeItems   int `json:"unsafe_items"`   // 安全检测拦截
	ExecutedItems int `json:"executed_items"` // 已落盘
	FailedItems   int `json:"failed_items"`   // 执行失败
	AIInvocations int `json:"ai_invocations"` // AI 调用次数（成本观测）

	// 创建者（用户 ID）
	CreatedBy string `json:"created_by" gorm:"type:text"`

	CreatedAt   time.Time      `json:"created_at" gorm:"index"`
	UpdatedAt   time.Time      `json:"updated_at"`
	ExecutedAt  *time.Time     `json:"executed_at"`
	CompletedAt *time.Time     `json:"completed_at"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`

	// 关联条目（延迟加载）
	Items []RenamePlanItem `json:"items,omitempty" gorm:"foreignKey:PlanID"`
}
```

### RenamePlanItem

```go
{
	ID     string `json:"id" gorm:"primaryKey;type:text"`
	PlanID string `json:"plan_id" gorm:"index;type:text;not null"`

	// 关联媒体（可空：若文件在 DB 里没匹配上 Media）
	MediaID string `json:"media_id" gorm:"index;type:text"`

	// 源路径（绝对路径）
	SourcePath string `json:"source_path" gorm:"type:text;not null"`
	// 源文件名（含扩展名，无目录）
	SourceName string `json:"source_name" gorm:"type:text"`

	// 目标路径（绝对路径，含新文件名）
	TargetPath string `json:"target_path" gorm:"type:text"`
	// 目标文件名（含扩展名）
	TargetName string `json:"target_name" gorm:"type:text"`
	// 目标目录是否需要新建
	NeedMkdir bool `json:"need_mkdir"`

	// 识别结果
	ParsedTitle    string `json:"parsed_title" gorm:"type:text"`
	ParsedTitleAlt string `json:"parsed_title_alt" gorm:"type:text"`
	ParsedYear     int    `json:"parsed_year"`
	ParsedTMDbID   int    `json:"parsed_tmdb_id"`
	ParsedIMDbID   string `json:"parsed_imdb_id" gorm:"type:text"`
	// MediaType: movie / episode / unknown
	MediaType  string `json:"media_type" gorm:"type:text"`
	SeasonNum  int    `json:"season_num"`
	EpisodeNum int    `json:"episode_num"`

	// 识别置信度（0~1，1 表示完全可信）
	Confidence float64 `json:"confidence"`
	// 是否调用了 AI Fallback
	AIInvoked bool `json:"ai_invoked" gorm:"default:false"`
	// AI 原始回复（debug 用，JSON 字符串）
	AIRawResponse string `json:"ai_raw_response" gorm:"type:text"`

	// 附属（相关）资源：和主视频一同迁移的文件（.nfo / .srt / -poster.jpg ...）
	// JSON 数组：[{"source":"...","target":"...","kind":"nfo|subtitle|poster|fanart|thumb|other"}]
	RelatedFilesJSON string `json:"related_files_json" gorm:"type:text"`

	// 安全检测
	SafetyJSON string `json:"safety_json" gorm:"type:text"` // 详细 JSON
	SafetyOK   bool   `json:"safety_ok"`                    // 总判定
	SafetyNote string `json:"safety_note" gorm:"type:text"` // 单行简述

	// 状态
	Status   RenameItemStatus `json:"status" gorm:"type:text;default:pending;index"`
	ErrorMsg string           `json:"error_msg" gorm:"type:text"`

	// 用户手动调整的目标名（若用户编辑过，优先取这里）
	OverrideName string `json:"override_name" gorm:"type:text"`
	// 用户排除标记
	Excluded bool `json:"excluded" gorm:"default:false"`

	CreatedAt time.Time      `json:"created_at" gorm:"index"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}
```

### RenameJournal

```go
{
	ID     uint64 `json:"id" gorm:"primaryKey;autoIncrement"`
	PlanID string `json:"plan_id" gorm:"index;type:text;not null"`
	ItemID string `json:"item_id" gorm:"index;type:text"`

	Op       RenameJournalOp `json:"op" gorm:"type:text;not null"`
	FromPath string          `json:"from_path" gorm:"type:text"`
	ToPath   string          `json:"to_path" gorm:"type:text"`

	// 是否已成功执行
	Success bool   `json:"success"`
	Error   string `json:"error" gorm:"type:text"`

	// 是否已回滚
	Reverted   bool       `json:"reverted" gorm:"default:false"`
	RevertedAt *time.Time `json:"reverted_at"`

	CreatedAt time.Time `json:"created_at" gorm:"index"`
}
```

### SystemLog

```go
{
	ID      string `json:"id" gorm:"primaryKey;type:text"`
	Type    string `json:"type" gorm:"index;type:text;not null"`  // api / playback / system
	Level   string `json:"level" gorm:"index;type:text;not null"` // debug / info / warn / error
	Message string `json:"message" gorm:"type:text"`
	Detail  string `json:"detail" gorm:"type:text"` // JSON 格式的详细信息

	// API 请求相关字段
	Method     string `json:"method,omitempty" gorm:"type:text"`        // GET / POST / PUT / DELETE
	Path       string `json:"path,omitempty" gorm:"index;type:text"`    // 请求路径
	StatusCode int    `json:"status_code,omitempty" gorm:"index"`       // HTTP 状态码
	LatencyMs  int64  `json:"latency_ms,omitempty"`                     // 响应时间（毫秒）
	ClientIP   string `json:"client_ip,omitempty" gorm:"type:text"`     // 客户端 IP
	UserAgent  string `json:"user_agent,omitempty" gorm:"type:text"`    // User-Agent
	UserID     string `json:"user_id,omitempty" gorm:"index;type:text"` // 操作用户 ID
	Username   string `json:"username,omitempty" gorm:"type:text"`      // 操作用户名

	// 播放错误相关字段
	MediaID    string `json:"media_id,omitempty" gorm:"index;type:text"` // 关联媒体 ID
	MediaTitle string `json:"media_title,omitempty" gorm:"type:text"`    // 媒体标题

	// 系统事件相关字段
	Source string `json:"source,omitempty" gorm:"type:text"` // 事件来源（service / scheduler / startup 等）

	CreatedAt time.Time `json:"created_at" gorm:"index"`
}
```

### VideoChapter

```go
{
	ID          string    `json:"id" gorm:"primaryKey;type:text"`
	MediaID     string    `json:"media_id" gorm:"index;type:text;not null"`
	Title       string    `json:"title" gorm:"type:text;not null"`    // 章节标题
	StartTime   float64   `json:"start_time"`                         // 开始时间（秒）
	EndTime     float64   `json:"end_time"`                           // 结束时间（秒）
	Description string    `json:"description" gorm:"type:text"`       // 章节描述
	SceneType   string    `json:"scene_type" gorm:"type:text"`        // 场景类型: action/dialogue/landscape/credits 等
	Confidence  float64   `json:"confidence"`                         // AI识别置信度 0-1
	Source      string    `json:"source" gorm:"type:text;default:ai"` // 来源: ai / manual
	Thumbnail   string    `json:"thumbnail" gorm:"type:text"`         // 章节缩略图路径
	CreatedAt   time.Time `json:"created_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### VideoHighlight

```go
{
	ID        string    `json:"id" gorm:"primaryKey;type:text"`
	MediaID   string    `json:"media_id" gorm:"index;type:text;not null"`
	Title     string    `json:"title" gorm:"type:text;not null"`    // 片段标题
	StartTime float64   `json:"start_time"`                         // 开始时间（秒）
	EndTime   float64   `json:"end_time"`                           // 结束时间（秒）
	Score     float64   `json:"score"`                              // 精彩程度评分 0-10
	Tags      string    `json:"tags" gorm:"type:text"`              // 标签，逗号分隔
	Thumbnail string    `json:"thumbnail" gorm:"type:text"`         // 精彩片段缩略图
	GifPath   string    `json:"gif_path" gorm:"type:text"`          // GIF预览路径
	Source    string    `json:"source" gorm:"type:text;default:ai"` // 来源: ai / manual
	CreatedAt time.Time `json:"created_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### AIAnalysisTask

```go
{
	ID          string     `json:"id" gorm:"primaryKey;type:text"`
	MediaID     string     `json:"media_id" gorm:"index;type:text;not null"`
	TaskType    string     `json:"task_type" gorm:"type:text;not null"`     // scene_detect / highlight / cover_select / chapter_gen
	Status      string     `json:"status" gorm:"type:text;default:pending"` // pending / running / completed / failed
	Progress    float64    `json:"progress"`                                // 0-100
	Result      string     `json:"result" gorm:"type:text"`                 // JSON格式的分析结果
	Error       string     `json:"error" gorm:"type:text"`
	StartedAt   *time.Time `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}
```

### ApiKey

```go
{
	ID           string     `json:"id" gorm:"primaryKey;type:text"`
	UserID       string     `json:"user_id" gorm:"index;type:text;not null"`
	Name         string     `json:"name" gorm:"type:text;not null"`           // 用户备注名
	KeyPrefix    string     `json:"key_prefix" gorm:"type:text;not null"`     // "nk_xxxx" 前 11 位
	KeySHA256    []byte     `json:"-" gorm:"type:bytea;uniqueIndex;not null"` // SHA-256(full_key)，O(1) 认证
	KeyEncrypted string     `json:"-" gorm:"type:text;not null"`              // AES-GCM(full_key)，解密展示
	LastUsedAt   *time.Time `json:"last_used_at"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	IsRevoked    bool       `json:"is_revoked" gorm:"default:false"`
	CreatedAt    time.Time  `json:"created_at"`
}
```

### CoverCandidate

```go
{
	ID          string    `json:"id" gorm:"primaryKey;type:text"`
	MediaID     string    `json:"media_id" gorm:"index;type:text;not null"`
	FrameTime   float64   `json:"frame_time"`                           // 帧时间点（秒）
	ImagePath   string    `json:"image_path" gorm:"type:text;not null"` // 候选图片路径
	Score       float64   `json:"score"`                                // AI评分 0-10
	Brightness  float64   `json:"brightness"`                           // 亮度评分
	Sharpness   float64   `json:"sharpness"`                            // 清晰度评分
	Composition float64   `json:"composition"`                          // 构图评分
	FaceCount   int       `json:"face_count"`                           // 检测到的人脸数量
	IsSelected  bool      `json:"is_selected" gorm:"default:false"`     // 是否被选为封面
	CreatedAt   time.Time `json:"created_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### VideoAnalysisTask

```go
{
	ID      string `json:"id" gorm:"primaryKey;type:text"`
	MediaID string `json:"media_id" gorm:"index;type:text;not null"`
	// ActiveKey is media_id for queued/running tasks and NULL for terminal tasks.
	// The unique index closes the race between concurrent submissions.
	ActiveKey       *string `json:"-" gorm:"uniqueIndex;type:text"`
	LibraryID       string  `json:"library_id" gorm:"index;type:text;not null"`
	MediaTitle      string  `json:"media_title" gorm:"type:text"`
	VideoPath       string  `json:"video_path" gorm:"type:text;not null"`
	MappedVideoPath string  `json:"mapped_video_path" gorm:"type:text;not null"`
	FileSize        int64   `json:"file_size"`
	FileMTime       int64   `json:"file_mtime"`
	Trigger         string  `json:"trigger" gorm:"type:text;not null"`
	Status          string  `json:"status" gorm:"index;type:text;not null;default:queued"`
	Stage           string  `json:"stage" gorm:"type:text;not null;default:detect"`
	Progress        float64 `json:"progress"`

	DetectJobID    string `json:"detect_job_id" gorm:"type:text"`
	StructureJobID string `json:"structure_job_id" gorm:"type:text"`
	DescribeJobID  string `json:"describe_job_id" gorm:"type:text"`
	VideoHash      string `json:"video_hash" gorm:"index;type:text"`
	ResultJSON     string `json:"-" gorm:"type:text"`
	ErrorCode      string `json:"error_code" gorm:"type:text"`
	ErrorMessage   string `json:"error_message" gorm:"type:text"`
	// MissingModel describe 阶段因 V-Scheduler 模型仓库缺少模型而失败时记录缺失的模型名
	// （如 model-hub/minicpm-v4.6:latest），供前端展示下载入口。
	MissingModel string `json:"missing_model" gorm:"type:text"`
	Attempt      int    `json:"attempt" gorm:"default:0"`

	// StageTimings 各阶段实际耗时（秒），由编排层在阶段状态流转时记录，JSON 序列化存储。
	StageTimings map[string]float64 `json:"stage_timings,omitempty" gorm:"serializer:json;type:text"`

	IncludeDescriptions bool `json:"include_descriptions" gorm:"default:false"`
	Force               bool `json:"force" gorm:"default:false"`
	FallbackUsed        bool `json:"fallback_used" gorm:"default:false"`

	// 各阶段独立状态（用于分阶段 workflow 控制）
	// 取值: ""(未开始) / "running" / "succeeded" / "failed" / "skipped"
	DetectStatus    string `json:"detect_status" gorm:"type:text;default:''"`
	StructureStatus string `json:"structure_status" gorm:"type:text;default:''"`
	DescribeStatus  string `json:"describe_status" gorm:"type:text;default:''"`

	// Seq 该任务在媒体全部执行历史中的序号（按创建时间升序，最新一次最大），
	// 由查询侧计算，不落库。
	Seq int `json:"seq" gorm:"-"`

	// stageStartedAt/stageStartedStage 当前计时阶段的起点（非持久化，进程重启后丢失，
	// 阶段耗时按尽力而为记录）。
	stageStartedAt    time.Time
	stageStartedStage string

	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	CreatedAt  time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt  time.Time  `json:"updated_at"`

	Media Media `json:"-" gorm:"foreignKey:MediaID;constraint:OnDelete:CASCADE"`
}
```

### Scene

```go
{
	ID                  string  `json:"id" gorm:"primaryKey;type:text"`
	VideoAnalysisTaskID string  `json:"video_analysis_task_id" gorm:"index;type:text;not null"`
	SceneIndex          int     `json:"scene_index" gorm:"not null"`
	StartTime           float64 `json:"start_time"`
	EndTime             float64 `json:"end_time"`
	ImagePath           string  `json:"image_path" gorm:"type:text"`
	// Embedding 场景图片的 CLIP 视觉 embedding（ViT-B-16-SigLIP2, 768 维）
	Embedding *pgvector.Vector `json:"embedding" gorm:"type:vector(768)"`
	// Description 场景描述文本（由 VL 模型生成）
	Description string `json:"description" gorm:"type:text"`
	// DescriptionEmbedding 场景描述的 CLIP 文本 embedding（ViT-B-16-SigLIP2, 768 维）
	DescriptionEmbedding *pgvector.Vector `json:"description_embedding" gorm:"type:vector(768)"`
	// Status 场景状态：ok / error
	Status string `json:"status" gorm:"type:text;default:ok"`
	// Error 错误信息
	Error string `json:"error" gorm:"type:text"`

	CreatedAt time.Time `json:"created_at"`

	VideoAnalysisTask VideoAnalysisTask `json:"-" gorm:"foreignKey:VideoAnalysisTaskID;constraint:OnDelete:CASCADE"`
}
```
