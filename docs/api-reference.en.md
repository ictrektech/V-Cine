# V-Cine API

## Addresses and protocols

Container: `http://nowen-video:8080`; host default: `http://HOST:38085`; VOS same-origin prefix: `/app/com.ictrek.v-cine`. Append the `/api/*` paths below. Host 8900 → container 9090 is monitoring, not the business API. Personal API Keys are managed in Profile. The sidebar API guide provides navigation, search and expandable native field details.

## Identity, permissions and API Keys

V-Cine `nk_` Keys, V-Scheduler Keys and provider credentials are separate. Business routes accept the application's JWT or `Authorization: Bearer nk_...`. A Key carries its owner's library access but the fallback middleware sets no administrator role; admin routes still require an admin JWT. `POST /api/auth/vos-oidc` exchanges a VOS identity for an application session; arbitrary routes do not automatically accept a raw VOS token.

- `POST /api/users/me/api-keys`: JSON `{ "name": "external-agent", "expires_at": "2027-01-01T00:00:00Z" }`. Name is required. The optional expiry is RFC3339 or null. HTTP 201 returns `{data: {..., key, raw_key}}`.
- `GET /api/users/me/api-keys`: HTTP 200 `{data: [...]}`. Fields: id, name, key_prefix, key, last_used_at, expires_at, is_revoked, created_at. Timestamps are RFC3339; nullable timestamps may be null. **The list can return the decrypted complete key again**. Only the additional raw_key field is create-only; the secret itself is not strictly one-time display.
- `DELETE /api/users/me/api-keys/:id`: HTTP 200 `{message: ...}`. Revoke access while retaining the record.
- `DELETE /api/users/me/api-keys/:id/hard`: HTTP 200 `{message: ...}`. Permanently remove the owner's record. There is no rename or replacement-secret update endpoint. Rotate by creating a new Key, updating clients and revoking the old Key.

Keep Keys out of logs and screenshots. Prefer Authorization headers over compatibility token query parameters on media URLs. Public health does not imply private media access. `/internal/video-analysis/source/:id` has a separate source_token (empty configuration relies on network isolation). Federation and Emby routes have their own protocol/authentication contracts.

## Copyable examples

```bash
BASE=http://HOST:38085
# Use an existing V-Cine session JWT to create a personal Key.
curl "$BASE/api/users/me/api-keys" -H "Authorization: Bearer $VCINE_JWT" -H 'Content-Type: application/json' --data '{"name":"external-agent"}'
# Read data.raw_key from that response; keep actual credentials in environment variables.
curl "$BASE/api/media?page=1&size=20" -H "Authorization: Bearer $VCINE_KEY"
curl --get "$BASE/api/search" --data-urlencode 'q=space' -H "Authorization: Bearer $VCINE_KEY"
```

## Pagination, tasks, cancellation and errors

Native response envelopes differ. Media lists commonly return `{data,total,page,size}`, details `{data}`, and streaming routes binary data or HLS rather than JSON. Apply each route's pagination contract: media pages start at 1 and size is 1–100, with invalid sizes falling back to 20. HTTP 400 means invalid input, 401 missing/invalid credentials, 403 role/library denial, 404 missing resource and 500 server-side processing failure. Errors commonly contain `{error: string}`; retain the response body when diagnosing failures.

Preprocessing, subtitle and video analysis operations can create asynchronous jobs. Poll the returned ID and wait for completion before consuming results. Cancel, retry and delete are separate actions; DELETE may remove database records or actual media files, so inspect the endpoint's fields first. Batch operations can partially succeed. HTTP 200 does not prove every item completed. `/api/ws` is an authenticated WebSocket; refetch state on reconnect, without assuming replay. AI requests use saved provider/model configuration. A V-Cine Key does not bypass V-Scheduler visibility, budgets or task priority.

## Complete native contract

The following catalogue is generated from actual Gin registrations and handlers. It preserves parameter names, defaults, request declarations and native response expressions. Go declarations show real field names/types; service variables in response expressions are **not literal JSON to copy into a request**. Dynamic service results are not assigned invented schemas. Shared JSON declarations follow the endpoint catalogue. Emby/Infuse case aliases and dual prefixes are maintained by `internal/handler/emby/router.go`; that compatibility protocol is separate from the standard JSON API.

## Endpoint catalogue

### POST /api/auth/login

Access boundary: `separate/public`. [Auth.Login](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/auth.go#L46)

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

Access boundary: `separate/public`. [Auth.Status](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/auth.go#L69)

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

Access boundary: `separate/public`. [Auth.Register](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/auth.go#L96)

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

Access boundary: `separate/public`. Inline health, static resource or preflight handler; see main router.

### GET /api/capabilities

Access boundary: `separate/public`. [Capability.List](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/capability.go#L26)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{"items": service.BuildCapabilities(h.cfg, ai, va)},
	})
```

### POST /api/auth/vos-oidc

Access boundary: `separate/public`. [Auth.LoginWithVOSOIDC](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/auth.go#L17)

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

Access boundary: `user`. [Auth.RefreshToken](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/auth.go#L122)

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未提供有效的认证信息"})
JSON(http.StatusUnauthorized, gin.H{"error": "认证信息无效"})
JSON(http.StatusUnauthorized, gin.H{"error": "令牌刷新失败"})
JSON(http.StatusOK, token)
```

### PUT /api/auth/password

Access boundary: `user`. [Auth.ChangePassword](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/auth.go#L145)

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

Access boundary: `separate/public`. Inline health, static resource or preflight handler; see main router.

### GET /sw.js

Access boundary: `separate/public`. Inline health, static resource or preflight handler; see main router.

### GET /api/ws

Access boundary: `user`. [WS.HandleWebSocket](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ws.go#L28)

### GET /api/libraries

Access boundary: `user`. [Library.List](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L100)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库列表失败"})
JSON(http.StatusOK, gin.H{"data": libs})
```

### GET /api/libraries/scan-status

Access boundary: `admin`. [Library.ScanStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L247)

```go
JSON(http.StatusOK, gin.H{"data": h.libService.ActiveScanPhases()})
```

### POST /api/libraries

Access boundary: `admin`. [Library.Create](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L116)

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

Access boundary: `admin`. [Library.Update](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L279)

Parameters: `Param id`

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

Access boundary: `admin`. [Library.Scan](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L211)

Parameters: `Param id`

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

Access boundary: `admin`. [Library.Reindex](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L262)

Parameters: `Param id`

```go
JSON(http.StatusAccepted, gin.H{
				"message": "扫描已在进行中",
				"data":    h.libService.ActiveScanPhases(),
			})
JSON(http.StatusOK, gin.H{"message": "重建索引已启动"})
```

### DELETE /api/libraries/:id

Access boundary: `admin`. [Library.Delete](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L252)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除媒体库失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/media

Access boundary: `user`. [Media.List](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L28)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id`

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

Access boundary: `user`. [Media.Detail](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L55)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{"data": media})
```

### GET /api/media/:id/enhanced

Access boundary: `user`. [Media.DetailEnhanced](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L83)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{"data": enhanced})
```

### GET /api/media/:id/versions

Access boundary: `user`. [Media.Versions](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L69)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{
		"data":  versions,
		"total": len(versions),
	})
```

### GET /api/media/recent

Access boundary: `user`. [Media.Recent](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L94)

Parameters: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取最近媒体失败"})
JSON(http.StatusOK, gin.H{"data": media})
```

### GET /api/media/recent/aggregated

Access boundary: `user`. [Media.RecentAggregated](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L105)

Parameters: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取最近媒体失败"})
JSON(http.StatusOK, gin.H{
		"media":  media,
		"series": series,
	})
```

### GET /api/media/recent/mixed

Access boundary: `user`. [Media.RecentMixed](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L186)

Parameters: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取最近媒体失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/media/aggregated

Access boundary: `user`. [Media.ListAggregated](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L119)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id`

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

Access boundary: `user`. [Media.ListMixed](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L146)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; Query year_from; Query year_to; Query library_id; Query type; Query genre; Query q; Query sort; Query order`

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

Access boundary: `user`. [Media.Continue](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L197)

Parameters: `DefaultQuery limit = 10`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取续播列表失败"})
JSON(http.StatusOK, gin.H{"data": histories})
```

### GET /api/series

Access boundary: `user`. [Series.List](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/series.go#L27)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id`

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

Access boundary: `user`. [Series.Detail](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/series.go#L54)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "剧集不存在"})
JSON(http.StatusOK, gin.H{"data": series})
```

### GET /api/series/:id/seasons

Access boundary: `user`. [Series.Seasons](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/series.go#L65)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取季列表失败"})
JSON(http.StatusOK, gin.H{"data": seasons})
```

### GET /api/series/:id/seasons/:season

Access boundary: `user`. [Series.SeasonEpisodes](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/series.go#L76)

Parameters: `Param id; Param season`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取剧集列表失败"})
JSON(http.StatusOK, gin.H{"data": episodes})
```

### GET /api/series/:id/next

Access boundary: `user`. [Series.NextEpisode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/series.go#L89)

Parameters: `Param id; Query season; Query episode`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取下一集失败"})
JSON(http.StatusOK, gin.H{"data": nil, "message": "已是最后一集"})
JSON(http.StatusOK, gin.H{"data": next})
```

### GET /api/stream/:id/info

Access boundary: `user`. [Stream.MediaInfo](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L193)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": info})
```

### GET /api/stream/:id/direct

Access boundary: `user`. [Stream.Direct](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L31)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusBadGateway, gin.H{"error": "远程流播放失败: " + err.Error()})
```

### GET /api/stream/:id/remux

Access boundary: `user`. [Stream.Remux](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L182)

Parameters: `Param id`

### GET /api/stream/:id/master.m3u8

Access boundary: `user`. [Stream.Master](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L86)

Parameters: `Param id; Query maxBitrate`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
String(http.StatusOK, playlist)
```

### GET /api/stream/:id/:quality/:segment

Access boundary: `user`. [Stream.Segment](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L113)

Parameters: `Param id; Param quality; Param segment`

```go
String(http.StatusOK, playlist)
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
```

### POST /api/stream/:id/playback

Access boundary: `user`. [Stream.Playback](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L213)

Parameters: `Param id; Query position; PostForm position`

```go
JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
JSON(http.StatusBadRequest, gin.H{"error": "invalid position"})
JSON(http.StatusOK, gin.H{"ok": true})
```

### POST /api/stream/:id/bandwidth

Access boundary: `user`. [Stream.Bandwidth](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L249)

Parameters: `Param id; Query bitrate; PostForm bitrate`

```go
JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
JSON(http.StatusBadRequest, gin.H{"error": "invalid bitrate"})
JSON(http.StatusOK, resp)
```

### GET /api/stream/:id/throttle

Access boundary: `user`. [Stream.ThrottleStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L285)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
JSON(http.StatusOK, gin.H{"data": gin.H{"media_id": id, "running": false}})
JSON(http.StatusOK, gin.H{"data": h.transcodeService.GetMediaThrottleStatus(id)})
```

### GET /api/stream/:id/strm-seg

Access boundary: `user`. [Stream.STRMSegment](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L304)

Parameters: `Param id; Query u; Query target`

```go
JSON(http.StatusBadRequest, gin.H{"error": "missing target url"})
JSON(http.StatusBadGateway, gin.H{"error": "远程子资源拉取失败: " + err.Error()})
```

### GET /api/stream/:id/strm-check

Access boundary: `user`. [Stream.STRMCheck](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L322)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/audio-track/:id/:trackIdx

Access boundary: `user`. [Stream.AudioPlaylist](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L145)

Parameters: `Param id; Param trackIdx`

```go
JSON(http.StatusBadRequest, gin.H{"error": "invalid track index"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
String(http.StatusOK, playlist)
```

### GET /api/audio-track/:id/:trackIdx/:seg

Access boundary: `user`. [Stream.AudioSegment](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L167)

Parameters: `Param id; Param trackIdx; Param seg`

```go
JSON(http.StatusBadRequest, gin.H{"error": "invalid track index"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
```

### GET /api/media/:id/poster

Access boundary: `user`. [Stream.Poster](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/imagery.go#L46)

Parameters: `Param id`

### GET /api/media/:id/backdrop

Access boundary: `user`. [Stream.Backdrop](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/imagery.go#L174)

Parameters: `Param id`

### GET /api/series/:id/poster

Access boundary: `user`. [Series.Poster](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/series.go#L107)

Parameters: `Param id`

```go
String(http.StatusOK, posterPlaceholderSVG)
String(http.StatusOK, posterPlaceholderSVG)
Status(http.StatusNotModified)
File(posterPath)
```

### GET /api/series/:id/backdrop

Access boundary: `user`. [Series.Backdrop](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/series.go#L155)

Parameters: `Param id`

```go
String(http.StatusOK, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect fill="#1e1e2e" width="1280" height="720"/></svg>`)
String(http.StatusOK, `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect fill="#1e1e2e" width="1280" height="720"/></svg>`)
Status(http.StatusNotModified)
File(series.BackdropPath)
```

### GET /api/series/:id/persons

Access boundary: `user`. [Series.GetPersons](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/series.go#L206)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusOK, gin.H{"data": deduped})
```

### GET /api/media/:id/persons

Access boundary: `user`. [Media.GetPersons](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L299)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusOK, gin.H{"data": persons})
```

### GET /api/persons/:id

Access boundary: `user`. [Media.GetPersonDetail](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L311)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "person not found"})
JSON(http.StatusOK, gin.H{"data": person})
```

### GET /api/persons/:id/media

Access boundary: `user`. [Media.GetPersonMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L323)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{
		"media":  media,
		"series": series,
	})
```

### GET /api/persons/:id/profile

Access boundary: `user`. [Media.PersonProfile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L346)

Parameters: `Param id`

```go
Status(http.StatusNotModified)
File(person.ProfileURL)
```

### GET /api/subtitle/:id/tracks

Access boundary: `user`. [Subtitle.ListTracks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L24)

Parameters: `Param id`

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

Access boundary: `user`. [Subtitle.ExtractTrack](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L64)

Parameters: `Param id; Param index`

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

Access boundary: `user`. [Subtitle.ServeExternal](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L114)

Parameters: `Query path; Query format`

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

Access boundary: `user`. [Subtitle.ExtractAll](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L424)

Parameters: `Param id`

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

Access boundary: `user`. [Subtitle.ExtractAllAsync](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L485)

Parameters: `Param id`

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

Access boundary: `user`. [Subtitle.DownloadExtracted](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L520)

Parameters: `Query path`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少文件路径"})
JSON(http.StatusBadRequest, gin.H{"error": "不支持的文件格式"})
JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
File(filePath)
```

### GET /api/subtitle/:id/search

Access boundary: `user`. [SubtitleSearch.SearchSubtitles](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L60)

Parameters: `Param id; DefaultQuery language = zh-cn,en; Query title; Query year; DefaultQuery type = movie`

```go
JSON(http.StatusNotFound, gin.H{"error": "媒体不存在"})
JSON(http.StatusOK, gin.H{"data": results})
```

### POST /api/subtitle/:id/download

Access boundary: `user`. [SubtitleSearch.DownloadSubtitle](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L96)

Parameters: `Param id`

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

Access boundary: `user`. [Subtitle.GenerateAISubtitle](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L203)

Parameters: `Param id`

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

Access boundary: `user`. [Subtitle.GetAISubtitleStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L230)

Parameters: `Param id`

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

Access boundary: `user`. [Subtitle.ServeAISubtitle](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L269)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusNotFound, gin.H{"error": "AI 字幕不存在，请先生成"})
File(vttPath)
```

### DELETE /api/subtitle/:id/ai

Access boundary: `user`. [Subtitle.DeleteAISubtitle](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L289)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusOK, gin.H{"message": "AI 字幕已删除"})
```

### POST /api/subtitle/:id/translate

Access boundary: `user`. [Subtitle.TranslateSubtitle](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L308)

Parameters: `Param id`

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

Access boundary: `user`. [Subtitle.GetTranslateStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L337)

Parameters: `Param id; Query lang`

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

Access boundary: `user`. [Subtitle.ServeTranslatedSubtitle](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L391)

Parameters: `Param id; Param lang`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 字幕服务未启用"})
JSON(http.StatusNotFound, gin.H{"error": "翻译字幕不存在"})
File(vttPath)
```

### GET /api/asr/status

Access boundary: `user`. [Subtitle.GetASRStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle.go#L412)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false}})
JSON(http.StatusOK, gin.H{"data": h.asrService.GetStatus()})
```

### GET /api/subtitle-preprocess/media/:id/status

Access boundary: `user`. [SubtitlePreprocess.GetMediaStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L247)

Parameters: `Param id`

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

Access boundary: `user`. [Preprocess.GetMediaTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L113)

Parameters: `Param id`

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

Access boundary: `user`. [Preprocess.ServePreprocessedMaster](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L512)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
String(http.StatusOK, playlist)
```

### GET /api/preprocess/media/:id/:quality/:segment

Access boundary: `user`. [Preprocess.ServePreprocessedSegment](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L527)

Parameters: `Param id; Param quality; Param segment`

```go
JSON(http.StatusNotFound, gin.H{"error": "预处理未完成"})
File(filePath)
```

### GET /api/preprocess/media/:id/thumbnail

Access boundary: `user`. [Preprocess.ServeThumbnail](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L553)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "封面不存在"})
File(task.ThumbnailPath)
```

### GET /api/preprocess/media/:id/keyframe/:index

Access boundary: `user`. [Preprocess.ServeKeyframe](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L568)

Parameters: `Param id; Param index`

```go
JSON(http.StatusNotFound, gin.H{"error": "关键帧不存在"})
File(filePath)
```

### GET /api/preprocess/media/:id/sprite.jpg

Access boundary: `user`. [Preprocess.ServeSprite](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L585)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "雪碧图不存在"})
File(task.SpritePath)
```

### GET /api/preprocess/media/:id/sprite.vtt

Access boundary: `user`. [Preprocess.ServeSpriteVTT](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L600)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "WebVTT 索引不存在"})
File(task.SpriteVTTPath)
```

### POST /api/media/:id/scrape

Access boundary: `admin`. [Metadata.ScrapeMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/metadata.go#L18)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"message": "元数据刮削成功"})
```

### GET /api/media/:id/video-analysis

Access boundary: `user`. [VideoAnalysis.GetMediaResult](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L411)

Parameters: `Param id; Query task_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusNotFound, gin.H{"error": "未找到可展示的视频分析结果"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询视频分析结果失败"})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/media/:id/video-analysis/scenes/:sceneIndex/grid

Access boundary: `user`. [VideoAnalysis.ServeSceneGrid](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L431)

Parameters: `Param sceneIndex; Param id; Query task_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusBadRequest, gin.H{"error": "sceneIndex 必须是非负整数"})
JSON(http.StatusNotFound, gin.H{"error": "九宫格图片不存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "读取九宫格图片失败"})
```

### GET /api/video-analysis/scenes/search

Access boundary: `user`. [VideoAnalysis.SearchScenes](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L495)

Parameters: `Query q; DefaultQuery limit = 20; DefaultQuery mode = text; Query library_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "缺少查询参数 q（文本查询）"})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("media_ids 数量超过上限 %d", sceneSearchMaxMediaIDs)})
JSON(http.StatusOK, gin.H{"data": results})
```

### GET /api/video-analysis/tasks/:id/scenes

Access boundary: `user`. [VideoAnalysis.ListScenesByTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L535)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "taskId 是必填参数"})
JSON(http.StatusOK, gin.H{"scenes": items})
```

### GET /api/video-analysis/tasks/:id/workflow

Access boundary: `user`. [VideoAnalysis.GetWorkflow](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L582)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"data": workflow})
```

### POST /api/video-analysis/tasks/:id/run-stage

Access boundary: `user`. [VideoAnalysis.RunStage](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L596)

Parameters: `Param id`

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

Access boundary: `user`. [VideoAnalysis.RunAll](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L616)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"message": "任务已全部执行完成"})
```

### POST /api/video-analysis/tasks/:id/run-missing

Access boundary: `user`. [VideoAnalysis.RunMissing](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L629)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"message": "缺失阶段已补齐"})
```

### GET /api/video-analysis/models/status

Access boundary: `user`. [VideoAnalysis.ModelHubStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L243)

Parameters: `Query model`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 model 参数（如 v-scheduler/ollama-qa/minicpm-v4.6:latest）"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "未配置 V-Scheduler 模型仓库地址（video_analysis.model_hub_api_url）"})
JSON(http.StatusOK, gin.H{"data": status})
```

### GET /api/users/me

Access boundary: `user`. [User.Profile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L24)

```go
JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
JSON(http.StatusOK, gin.H{"data": user})
```

### PUT /api/users/me

Access boundary: `user`. [User.UpdateProfile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L36)

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

Access boundary: `user`. [User.LoginLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L68)

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": logs})
```

### PUT /api/users/me/progress/:mediaId

Access boundary: `user`. [User.UpdateProgress](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L90)

Parameters: `Param mediaId`

```go
UpdateProgressRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "更新进度失败"})
JSON(http.StatusOK, gin.H{"message": "已更新"})
```

### GET /api/users/me/favorites

Access boundary: `user`. [User.Favorites](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L109)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20`

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

Access boundary: `user`. [User.AddFavorite](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L129)

Parameters: `Param mediaId`

```go
JSON(http.StatusConflict, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "收藏失败"})
JSON(http.StatusCreated, gin.H{"message": "已收藏"})
```

### DELETE /api/users/me/favorites/:mediaId

Access boundary: `user`. [User.RemoveFavorite](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L146)

Parameters: `Param mediaId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "取消收藏失败"})
JSON(http.StatusOK, gin.H{"message": "已取消收藏"})
```

### GET /api/users/me/favorites/:mediaId/check

Access boundary: `user`. [User.CheckFavorite](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L159)

Parameters: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"data": favorited})
```

### GET /api/users/me/progress/:mediaId

Access boundary: `user`. [User.GetProgress](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L168)

Parameters: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"data": nil})
JSON(http.StatusOK, gin.H{"data": progress})
```

### GET /api/users/me/history

Access boundary: `user`. [User.History](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L182)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20`

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

Access boundary: `user`. [User.DeleteHistory](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L209)

Parameters: `Param mediaId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除观看记录失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### DELETE /api/users/me/history

Access boundary: `user`. [User.ClearHistory](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/user.go#L222)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "清空观看历史失败"})
JSON(http.StatusOK, gin.H{"message": "已清空"})
```

### GET /api/users/me/api-keys

Access boundary: `user`. [ApiKey.List](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/api_key.go#L53)

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": keys})
```

### POST /api/users/me/api-keys

Access boundary: `user`. [ApiKey.Create](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/api_key.go#L28)

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

Access boundary: `user`. [ApiKey.Revoke](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/api_key.go#L74)

Parameters: `Param id`

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
JSON(http.StatusBadRequest, gin.H{"error": "缺少 Key ID"})
JSON(http.StatusInternalServerError, gin.H{"error": "撤销失败"})
JSON(http.StatusOK, gin.H{"message": "已撤销"})
```

### DELETE /api/users/me/api-keys/:id/hard

Access boundary: `user`. [ApiKey.Delete](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/api_key.go#L98)

Parameters: `Param id`

```go
JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
JSON(http.StatusBadRequest, gin.H{"error": "缺少 Key ID"})
JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/playlists

Access boundary: `user`. [Playlist.List](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/playlist.go#L24)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取播放列表失败"})
JSON(http.StatusOK, gin.H{"data": playlists})
```

### POST /api/playlists

Access boundary: `user`. [Playlist.Create](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/playlist.go#L35)

```go
CreatePlaylistRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "创建播放列表失败"})
JSON(http.StatusCreated, gin.H{"data": playlist})
```

### GET /api/playlists/:id

Access boundary: `user`. [Playlist.Detail](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/playlist.go#L53)

Parameters: `Param id`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权访问该播放列表"})
JSON(http.StatusNotFound, gin.H{"error": "播放列表不存在"})
JSON(http.StatusOK, gin.H{"data": playlist})
```

### DELETE /api/playlists/:id

Access boundary: `user`. [Playlist.Delete](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/playlist.go#L69)

Parameters: `Param id`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权操作"})
JSON(http.StatusInternalServerError, gin.H{"error": "删除播放列表失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### POST /api/playlists/:id/items/:mediaId

Access boundary: `user`. [Playlist.AddItem](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/playlist.go#L85)

Parameters: `Param id; Param mediaId`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权操作"})
JSON(http.StatusInternalServerError, gin.H{"error": "添加失败"})
JSON(http.StatusCreated, gin.H{"message": "已添加"})
```

### DELETE /api/playlists/:id/items/:mediaId

Access boundary: `user`. [Playlist.RemoveItem](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/playlist.go#L102)

Parameters: `Param id; Param mediaId`

```go
JSON(http.StatusForbidden, gin.H{"error": "无权操作"})
JSON(http.StatusInternalServerError, gin.H{"error": "移除失败"})
JSON(http.StatusOK, gin.H{"message": "已移除"})
```

### GET /api/search

Access boundary: `user`. [Media.Search](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L210)

Parameters: `Query q; DefaultQuery page = 1; DefaultQuery size = 20`

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

Access boundary: `user`. [Media.SearchAdvanced](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L236)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; DefaultQuery year_min = 0; DefaultQuery year_max = 0; DefaultQuery min_rating = 0; Query q; Query type; Query genre; DefaultQuery sort_by = created_at; DefaultQuery sort_order = desc`

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

Access boundary: `user`. [Media.SearchMixed](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/media.go#L272)

Parameters: `Query q; DefaultQuery page = 1; DefaultQuery size = 20`

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

Access boundary: `user`. [Recommend.GetRecommendations](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/recommend.go#L19)

Parameters: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取推荐失败"})
JSON(http.StatusOK, gin.H{"data": recommendations})
```

### GET /api/recommend/similar/:mediaId

Access boundary: `user`. [Recommend.GetSimilarMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/recommend.go#L38)

Parameters: `Param mediaId; DefaultQuery limit = 12`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取相关推荐失败"})
JSON(http.StatusOK, gin.H{"data": recommendations})
```

### GET /api/ai/search

Access boundary: `user`. [AI.SmartSearch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L29)

Parameters: `Query q`

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

Access boundary: `user`. [Cast.ListDevices](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/cast.go#L18)

```go
JSON(http.StatusOK, gin.H{"data": devices})
```

### POST /api/cast/devices/refresh

Access boundary: `user`. [Cast.RefreshDevices](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/cast.go#L24)

```go
JSON(http.StatusOK, gin.H{"message": "已触发设备发现，请稍后刷新列表"})
```

### POST /api/cast/start

Access boundary: `user`. [Cast.CastMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/cast.go#L36)

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

Access boundary: `user`. [Cast.ListSessions](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/cast.go#L101)

```go
JSON(http.StatusOK, gin.H{"data": sessions})
```

### GET /api/cast/sessions/:sessionId

Access boundary: `user`. [Cast.GetSession](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/cast.go#L88)

Parameters: `Param sessionId`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": session})
```

### POST /api/cast/sessions/:sessionId/control

Access boundary: `user`. [Cast.ControlCast](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/cast.go#L69)

Parameters: `Param sessionId`

```go
ControlRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{"message": "操作成功"})
```

### DELETE /api/cast/sessions/:sessionId

Access boundary: `user`. [Cast.StopSession](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/cast.go#L107)

Parameters: `Param sessionId`

```go
JSON(http.StatusOK, gin.H{"message": "已停止投屏"})
```

### POST /api/bookmarks

Access boundary: `user`. [Bookmark.Create](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/bookmark.go#L27)

```go
CreateBookmarkRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusCreated, gin.H{"data": bookmark})
```

### GET /api/bookmarks

Access boundary: `user`. [Bookmark.ListByUser](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/bookmark.go#L60)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取书签失败"})
JSON(http.StatusOK, gin.H{"data": bookmarks, "total": total, "page": page, "size": size})
```

### GET /api/bookmarks/media/:mediaId

Access boundary: `user`. [Bookmark.ListByMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/bookmark.go#L46)

Parameters: `Param mediaId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取书签失败"})
JSON(http.StatusOK, gin.H{"data": bookmarks})
```

### PUT /api/bookmarks/:id

Access boundary: `user`. [Bookmark.Update](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/bookmark.go#L94)

Parameters: `Param id`

```go
UpdateBookmarkRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "更新书签失败"})
JSON(http.StatusOK, gin.H{"message": "已更新"})
```

### DELETE /api/bookmarks/:id

Access boundary: `user`. [Bookmark.Delete](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/bookmark.go#L75)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除书签失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/media/:id/comments

Access boundary: `user`. [Comment.ListByMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/comment.go#L45)

Parameters: `Param id; DefaultQuery page = 1; DefaultQuery size = 20`

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

Access boundary: `user`. [Comment.Create](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/comment.go#L25)

Parameters: `Param id`

```go
CreateCommentRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusCreated, gin.H{"data": comment})
```

### DELETE /api/comments/:id

Access boundary: `user`. [Comment.Delete](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/comment.go#L70)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除评论失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/media/:id/danmaku

Access boundary: `user`. [Danmaku.ListByMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/danmaku.go#L18)

Parameters: `Param id; DefaultQuery limit = 200`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取弹幕失败"})
JSON(http.StatusOK, gin.H{
		"data":  items,
		"total": len(items),
	})
```

### POST /api/stats/playback

Access boundary: `user`. [Stats.RecordPlayback](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stats.go#L18)

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

Access boundary: `user`. [Stats.GetUserStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stats.go#L40)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取统计失败"})
JSON(http.StatusOK, gin.H{"data": overview})
```

### POST /api/logs/playback-error

Access boundary: `user`. [SystemLog.ReportPlaybackError](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/system_log.go#L166)

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

Access boundary: `user`. [Music.ListTracks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L301)

Parameters: `Query library_id; DefaultQuery page = 1; DefaultQuery size = 50; DefaultQuery sort = artist`

```go
JSON(http.StatusOK, gin.H{"data": tracks, "total": total, "page": page, "size": size})
```

### GET /api/music/albums

Access boundary: `user`. [Music.ListAlbums](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L315)

Parameters: `Query library_id; DefaultQuery page = 1; DefaultQuery size = 30`

```go
JSON(http.StatusOK, gin.H{"data": albums, "total": total, "page": page, "size": size})
```

### GET /api/music/albums/:id

Access boundary: `user`. [Music.GetAlbum](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L328)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "专辑不存在"})
JSON(http.StatusOK, gin.H{"data": album})
```

### GET /api/music/search

Access boundary: `user`. [Music.SearchMusic](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L338)

Parameters: `Query q; DefaultQuery limit = 20`

```go
JSON(http.StatusOK, gin.H{"data": tracks})
```

### GET /api/music/tracks/:id/lyrics

Access boundary: `user`. [Music.GetLyrics](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L349)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": lyrics})
```

### POST /api/music/tracks/:id/love

Access boundary: `user`. [Music.ToggleLove](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L359)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"loved": loved})
```

### GET /api/music/playlists

Access boundary: `user`. [Music.ListPlaylists](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L386)

```go
JSON(http.StatusOK, gin.H{"data": playlists})
```

### POST /api/music/playlists

Access boundary: `user`. [Music.CreatePlaylist](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L396)

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

Access boundary: `user`. [Music.GetPlaylist](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L413)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "播放列表不存在"})
JSON(http.StatusOK, gin.H{"data": playlist})
```

### POST /api/music/playlists/:id/tracks

Access boundary: `user`. [Music.AddToPlaylist](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L423)

Parameters: `Param id`

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

Access boundary: `user`. [Photo.ListPhotos](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L446)

Parameters: `Query library_id; DefaultQuery page = 1; DefaultQuery size = 50; DefaultQuery sort = date_desc; Query album_id; Query tag; Query scene; Query favorite`

```go
JSON(http.StatusOK, gin.H{"data": photos, "total": total, "page": page, "size": size})
```

### GET /api/photos/:id

Access boundary: `user`. [Photo.GetPhoto](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L467)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "照片不存在"})
JSON(http.StatusOK, gin.H{"data": photo})
```

### GET /api/photos/albums

Access boundary: `user`. [Photo.ListAlbums](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L477)

```go
JSON(http.StatusOK, gin.H{"data": albums})
```

### POST /api/photos/albums

Access boundary: `user`. [Photo.CreateAlbum](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L487)

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

Access boundary: `user`. [Photo.AddPhotosToAlbum](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L505)

Parameters: `Param id`

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

Access boundary: `user`. [Photo.ToggleFavorite](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L521)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"is_favorite": fav})
```

### POST /api/photos/:id/rating

Access boundary: `user`. [Photo.SetRating](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L531)

Parameters: `Param id`

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

Access boundary: `user`. [Photo.SearchPhotos](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L547)

Parameters: `Query q; DefaultQuery limit = 50`

```go
JSON(http.StatusOK, gin.H{"data": photos})
```

### GET /api/photos/stats

Access boundary: `user`. [Photo.GetStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L558)

Parameters: `Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/federation/search

Access boundary: `user`. [Federation.SearchSharedMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L636)

Parameters: `Query q; DefaultQuery page = 1; DefaultQuery size = 20`

```go
JSON(http.StatusOK, gin.H{"data": media, "total": total})
```

### GET /api/federation/stream/:id

Access boundary: `user`. [Federation.GetSharedMediaStream](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L648)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"stream_url": streamURL})
```

### POST /api/media/:id/ai/chapters

Access boundary: `user`. [AIScene.GenerateChapters](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L18)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": task, "message": "章节生成任务已启动"})
```

### GET /api/media/:id/collection

Access boundary: `user`. [Collection.GetMediaCollection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L25)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少媒体ID"})
JSON(http.StatusOK, gin.H{"data": nil})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/collections

Access boundary: `user`. [Collection.ListCollections](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L62)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; DefaultQuery sort = created_desc; Query auto; Query library_id`

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

Access boundary: `user`. [Collection.SearchCollections](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L96)

Parameters: `Query keyword; DefaultQuery limit = 10`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少搜索关键词"})
JSON(http.StatusInternalServerError, gin.H{"error": "搜索失败"})
JSON(http.StatusOK, gin.H{"data": colls})
```

### GET /api/collections/:id

Access boundary: `user`. [Collection.GetCollectionDetail](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L44)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少合集ID"})
JSON(http.StatusNotFound, gin.H{"error": "合集不存在"})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/collections/:id/poster

Access boundary: `user`. [Collection.Poster](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L209)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少合集ID"})
String(http.StatusOK, collectionPosterPlaceholderSVG)
```

### GET /api/media/:id/chapters

Access boundary: `user`. [AIScene.GetChapters](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L31)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取章节失败"})
JSON(http.StatusOK, gin.H{"data": chapters})
```

### POST /api/media/:id/ai/highlights

Access boundary: `user`. [AIScene.ExtractHighlights](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L44)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": task, "message": "精彩片段提取任务已启动"})
```

### GET /api/media/:id/highlights

Access boundary: `user`. [AIScene.GetHighlights](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L57)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取精彩片段失败"})
JSON(http.StatusOK, gin.H{"data": highlights})
```

### POST /api/media/:id/ai/covers

Access boundary: `user`. [AIScene.GenerateCoverCandidates](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L70)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": task, "message": "封面候选生成任务已启动"})
```

### GET /api/media/:id/covers

Access boundary: `user`. [AIScene.GetCoverCandidates](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L83)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取封面候选失败"})
JSON(http.StatusOK, gin.H{"data": candidates})
```

### POST /api/media/:id/covers/:candidateId/select

Access boundary: `user`. [AIScene.SelectCover](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L96)

Parameters: `Param id; Param candidateId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "选择封面失败"})
JSON(http.StatusOK, gin.H{"message": "封面已选择"})
```

### POST /api/media/:id/covers/apply

Access boundary: `user`. [AIScene.ApplyCover](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L109)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"message": "封面已应用"})
```

### GET /api/media/:id/ai/tasks

Access boundary: `user`. [AIScene.GetAnalysisTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L121)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取分析任务失败"})
JSON(http.StatusOK, gin.H{"data": tasks})
```

### GET /api/ai/tasks/:taskId

Access boundary: `user`. [AIScene.GetAnalysisTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_scene.go#L134)

Parameters: `Param taskId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取任务失败"})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /internal/video-analysis/source/:id

Access boundary: `separate/public`. [Stream.AnalysisSource](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stream.go#L24)

### OPTIONS /api/admin/settings/douban/import

Access boundary: `separate/public`. Inline health, static resource or preflight handler; see main router.

### POST /api/admin/settings/douban/import

Access boundary: `separate/public`. [Admin.ImportDoubanCookie](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L768)

Parameters: `Query token`

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

Access boundary: `admin`. [Admin.ListUsers](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L44)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取用户列表失败"})
JSON(http.StatusOK, gin.H{"data": users})
```

### POST /api/admin/users

Access boundary: `admin`. [Admin.CreateUser](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L54)

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

Access boundary: `admin`. [Admin.UpdateUser](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L76)

Parameters: `Param id`

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

Access boundary: `admin`. [Admin.SetUserDisabled](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L101)

Parameters: `Param id`

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

Access boundary: `admin`. [Admin.DeleteUser](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L137)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "不能删除自己"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusInternalServerError, gin.H{"error": "删除用户失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### PUT /api/admin/users/:id/password

Access boundary: `admin`. [Admin.ResetUserPassword](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L163)

Parameters: `Param id`

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

Access boundary: `admin`. [Admin.ListLoginLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L196)

Parameters: `Query only_failed`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}, "total": 0})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": logs, "total": total, "page": page, "size": size})
```

### GET /api/admin/audit-logs

Access boundary: `admin`. [Admin.ListAuditLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L212)

Parameters: `Query action`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}, "total": 0})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": logs, "total": total, "page": page, "size": size})
```

### GET /api/admin/invite-codes

Access boundary: `admin`. [Admin.ListInviteCodes](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L230)

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
JSON(http.StatusOK, gin.H{"data": codes})
```

### POST /api/admin/invite-codes

Access boundary: `admin`. [Admin.CreateInviteCode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L244)

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

Access boundary: `admin`. [Admin.DeleteInviteCode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L288)

Parameters: `Param id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
JSON(http.StatusOK, gin.H{"message": "已删除"})
```

### GET /api/admin/system

Access boundary: `admin`. [Admin.SystemInfo](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L333)

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

Access boundary: `admin`. [Admin.TranscodeStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L368)

```go
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/admin/transcode/throttle

Access boundary: `admin`. [Admin.TranscodeThrottleStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L392)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### POST /api/admin/transcode/:taskId/cancel

Access boundary: `admin`. [Admin.CancelTranscode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L398)

Parameters: `Param taskId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "任务ID不能为空"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "转码任务已取消"})
```

### GET /api/admin/transcode-tasks

Access boundary: `admin`. [Admin.ListTranscodeTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L424)

Parameters: `DefaultQuery page = 1; DefaultQuery page_size = 20; Query status`

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

Access boundary: `admin`. [Admin.GetTranscodeStatistics](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L452)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### POST /api/admin/transcode-tasks/batch-cancel

Access boundary: `admin`. [Admin.BatchCancelTranscodeTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L492)

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

Access boundary: `admin`. [Admin.BatchDeleteTranscodeTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L508)

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

Access boundary: `admin`. [Admin.BatchRetryTranscodeTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L528)

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

Access boundary: `admin`. [Admin.BatchSubmitTranscodeTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L554)

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

Access boundary: `admin`. [Admin.CancelTranscodeTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L458)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "任务ID不能为空"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已取消"})
```

### POST /api/admin/transcode-tasks/:id/retry

Access boundary: `admin`. [Admin.RetryTranscodeTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L472)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已重新提交"})
```

### DELETE /api/admin/transcode-tasks/:id

Access boundary: `admin`. [Admin.DeleteTranscodeTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin.go#L482)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已删除"})
```

### GET /api/admin/settings/tmdb

Access boundary: `admin`. [Admin.GetTMDbConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L17)

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

Access boundary: `admin`. [Admin.UpdateTMDbConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L41)

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

Access boundary: `admin`. [Admin.ClearTMDbConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L71)

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

Access boundary: `admin`. [Admin.ValidateTMDbConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L92)

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

Access boundary: `admin`. [Admin.TestTMDbAPIKey](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L122)

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

Access boundary: `admin`. [Admin.UpdateTMDbProxy](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_tmdb_proxy.go#L38)

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

Access boundary: `admin`. [Admin.ClearTMDbProxy](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_tmdb_proxy.go#L79)

```go
JSON(http.StatusOK, gin.H{"message": "已恢复 TMDb 官方直连", "data": gin.H{
		"api_proxy": "", "image_proxy": "", "network_proxy": "",
	}})
```

### POST /api/admin/settings/tmdb/proxy/test

Access boundary: `admin`. [Admin.TestTMDbProxy](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_tmdb_proxy.go#L97)

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

Access boundary: `admin`. [Admin.GetSystemSettings](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L181)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取系统设置失败"})
JSON(http.StatusOK, gin.H{"data": settings})
```

### PUT /api/admin/settings/system

Access boundary: `admin`. [Admin.UpdateSystemSettings](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L206)

```go
UpdateSystemSettingsRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": "未提供任何设置项"})
JSON(http.StatusInternalServerError, gin.H{"error": "保存设置失败"})
```

### PUT /api/admin/settings/observability/pprof

Access boundary: `admin`. [Admin.SetPprofEnabled](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L671)

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

Access boundary: `admin`. [Admin.GetSTRMConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_strm.go#L14)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "配置未加载"})
JSON(http.StatusOK, gin.H{"data": h.cfg.STRMSnapshot()})
```

### PUT /api/admin/strm/config

Access boundary: `admin`. [Admin.UpdateSTRMConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_strm.go#L37)

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

Access boundary: `admin`. [SystemLog.ListSystemLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/system_log.go#L25)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 50; Query type; Query level; Query keyword; Query method; Query path; Query user_id; Query media_id; Query start; Query end; Query min_status; Query max_status`

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

Access boundary: `admin`. [SystemLog.GetSystemLogStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/system_log.go#L73)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取统计失败"})
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/system-logs/export

Access boundary: `admin`. [SystemLog.ExportSystemLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/system_log.go#L84)

Parameters: `DefaultQuery max_rows = 5000; Query type; Query level; Query keyword; Query method; Query start; Query end`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "导出失败"})
```

### POST /api/admin/system-logs/clean

Access boundary: `admin`. [SystemLog.CleanSystemLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/system_log.go#L143)

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

Access boundary: `admin`. [Admin.BatchScan](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L26)

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

Access boundary: `admin`. [Admin.BatchScrape](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L56)

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

Access boundary: `admin`. [Admin.GetUserPermission](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L102)

Parameters: `Param userId`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取权限失败"})
JSON(http.StatusOK, gin.H{"data": perm})
```

### PUT /api/admin/permissions/:userId

Access boundary: `admin`. [Admin.UpdateUserPermission](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L120)

Parameters: `Param userId`

```go
UpdateUserPermissionRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "更新权限失败"})
JSON(http.StatusOK, gin.H{"message": "权限已更新"})
```

### GET /api/admin/rating/:mediaId

Access boundary: `admin`. [Admin.GetContentRating](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L161)

Parameters: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"media_id": mediaID, "level": ""}})
JSON(http.StatusOK, gin.H{"data": gin.H{"media_id": mediaID, "level": level}})
```

### PUT /api/admin/rating/:mediaId

Access boundary: `admin`. [Admin.SetContentRating](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L143)

Parameters: `Param mediaId`

```go
SetContentRatingRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "分级已设置"})
```

### GET /api/admin/metadata/search

Access boundary: `admin`. [Admin.SearchMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L156)

Parameters: `Query q; DefaultQuery type = movie; Query year`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供搜索关键词"})
JSON(http.StatusOK, gin.H{"data": results})
```

### POST /api/admin/media/:mediaId/match

Access boundary: `admin`. [Admin.MatchMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L180)

Parameters: `Param mediaId`

```go
MatchMetadataRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusOK, gin.H{"message": "元数据已关联"})
```

### POST /api/admin/media/:mediaId/unmatch

Access boundary: `admin`. [Admin.UnmatchMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L198)

Parameters: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"message": "已解除元数据匹配"})
```

### PUT /api/admin/media/:mediaId/metadata

Access boundary: `admin`. [Admin.UpdateMediaMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L151)

Parameters: `Param mediaId`

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

Access boundary: `admin`. [Admin.DeleteMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L17)

Parameters: `Param mediaId`

```go
JSON(http.StatusOK, gin.H{"message": "影片已删除"})
```

### GET /api/admin/media/:mediaId/strm

Access boundary: `admin`. [Admin.GetMediaSTRM](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L126)

Parameters: `Param mediaId`

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

Access boundary: `admin`. [Admin.UpdateMediaSTRM](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L61)

Parameters: `Param mediaId`

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

Access boundary: `admin`. [Admin.MatchSeriesMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L212)

Parameters: `Param seriesId`

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

Access boundary: `admin`. [Admin.UnmatchSeriesMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L232)

Parameters: `Param seriesId`

```go
JSON(http.StatusOK, gin.H{"message": "已解除元数据匹配"})
```

### POST /api/admin/series/:seriesId/scrape

Access boundary: `admin`. [Admin.ScrapeSeriesMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L244)

Parameters: `Param seriesId`

```go
JSON(http.StatusOK, gin.H{"message": "元数据已刷新"})
```

### PUT /api/admin/series/:seriesId/metadata

Access boundary: `admin`. [Admin.UpdateSeriesMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L222)

Parameters: `Param seriesId`

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

Access boundary: `admin`. [Admin.DeleteSeries](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L274)

Parameters: `Param seriesId`

```go
JSON(http.StatusOK, gin.H{"message": "剧集已删除"})
```

### POST /api/admin/series/merge

Access boundary: `admin`. [Admin.MergeSeries](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L412)

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

Access boundary: `admin`. [Admin.AutoMergeSeries](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L439)

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

Access boundary: `admin`. [Admin.MergeCandidates](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L464)

```go
JSON(http.StatusOK, gin.H{
		"data":  groups,
		"total": len(groups),
	})
```

### GET /api/admin/images/tmdb

Access boundary: `admin`. [Admin.SearchTMDbImages](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L288)

Parameters: `DefaultQuery type = movie; Query tmdb_id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供有效的 tmdb_id"})
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/media/:mediaId/image/upload

Access boundary: `admin`. [Admin.UploadMediaImage](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L306)

Parameters: `Param mediaId; DefaultQuery type = poster`

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

Access boundary: `admin`. [Admin.SetMediaImageByURL](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L406)

Parameters: `Param mediaId`

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

Access boundary: `admin`. [Admin.SetMediaImageFromTMDb](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L466)

Parameters: `Param mediaId`

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

Access boundary: `admin`. [Admin.UploadSeriesImage](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L357)

Parameters: `Param seriesId; DefaultQuery type = poster`

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

Access boundary: `admin`. [Admin.SetSeriesImageByURL](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L436)

Parameters: `Param seriesId`

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

Access boundary: `admin`. [Admin.SetSeriesImageFromTMDb](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_media.go#L492)

Parameters: `Param seriesId`

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

Access boundary: `admin`. [Admin.BrowseFS](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L261)

Parameters: `DefaultQuery path = /; Query include_files`

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

Access boundary: `admin`. [Storage.GetWebDAVConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage.go#L37)

```go
JSON(http.StatusOK, gin.H{"data": response})
```

### PUT /api/admin/storage/webdav

Access boundary: `admin`. [Storage.UpdateWebDAVConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage.go#L76)

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

Access boundary: `admin`. [Storage.TestWebDAVConnection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage.go#L142)

```go
TestWebDAVConnectionRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "连接测试失败: " + err.Error()})
JSON(http.StatusOK, gin.H{"message": "WebDAV 连接测试成功"})
```

### GET /api/admin/storage/webdav/status

Access boundary: `admin`. [Storage.GetWebDAVStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage.go#L172)

```go
JSON(http.StatusOK, gin.H{"data": status})
```

### GET /api/admin/storage/browse

Access boundary: `admin`. [Storage.BrowseRemoteDir](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage.go#L178)

Parameters: `Query type; DefaultQuery path = /`

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

Access boundary: `admin`. [Storage.GetAlistConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage_remote.go#L24)

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

Access boundary: `admin`. [Storage.UpdateAlistConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage_remote.go#L57)

```go
UpdateAlistConfigRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "启用 Alist 时必须提供服务器地址"})
JSON(http.StatusOK, gin.H{"message": "Alist 配置已更新"})
```

### POST /api/admin/storage/alist/test

Access boundary: `admin`. [Storage.TestAlistConnection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage_remote.go#L125)

```go
TestAlistRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "连接测试失败: " + err.Error()})
JSON(http.StatusOK, gin.H{"message": "Alist 连接测试成功"})
```

### GET /api/admin/storage/alist/status

Access boundary: `admin`. [Storage.GetAlistStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage_remote.go#L107)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false, "connected": false}})
JSON(http.StatusOK, gin.H{"data": h.remoteStorageService.GetAlistStatus()})
```

### GET /api/admin/storage/s3

Access boundary: `admin`. [Storage.GetS3Config](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage_remote.go#L157)

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

Access boundary: `admin`. [Storage.UpdateS3Config](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage_remote.go#L194)

```go
UpdateS3ConfigRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效: " + err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": "启用 S3 时必须提供 Endpoint 和 Bucket"})
JSON(http.StatusOK, gin.H{"message": "S3 配置已更新"})
```

### POST /api/admin/storage/s3/test

Access boundary: `admin`. [Storage.TestS3Connection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage_remote.go#L264)

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

Access boundary: `admin`. [Storage.GetS3Status](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/storage_remote.go#L244)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false, "connected": false}})
JSON(http.StatusOK, gin.H{"data": h.remoteStorageService.GetS3Status()})
```

### POST /api/admin/system/clear-data

Access boundary: `admin`. [Admin.ClearAllData](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_system.go#L518)

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

Access boundary: `admin`. [Admin.SearchBangumi](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L358)

Parameters: `Query q; DefaultQuery type = 2; Query year`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供搜索关键词"})
JSON(http.StatusOK, gin.H{"data": results})
```

### GET /api/admin/metadata/bangumi/subject/:subjectId

Access boundary: `admin`. [Admin.GetBangumiSubject](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L382)

Parameters: `Param subjectId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供有效的 Bangumi 条目 ID"})
JSON(http.StatusOK, gin.H{"data": subject})
```

### POST /api/admin/media/:mediaId/match/bangumi

Access boundary: `admin`. [Admin.MatchMediaBangumi](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L399)

Parameters: `Param mediaId`

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

Access boundary: `admin`. [Admin.MatchSeriesBangumi](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L419)

Parameters: `Param seriesId`

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

Access boundary: `admin`. [Admin.GetBangumiConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L439)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"configured":   configured,
			"masked_token": maskedToken,
		},
	})
```

### PUT /api/admin/settings/bangumi

Access boundary: `admin`. [Admin.UpdateBangumiConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L460)

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

Access boundary: `admin`. [Admin.ClearBangumiConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L485)

```go
JSON(http.StatusOK, gin.H{
		"message": "Bangumi Access Token 已清除",
		"data": gin.H{
			"configured": false,
		},
	})
```

### GET /api/admin/metadata/douban/search

Access boundary: `admin`. [Admin.SearchDouban](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L258)

Parameters: `Query q; Query year`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供搜索关键词"})
JSON(http.StatusOK, gin.H{"data": results})
```

### POST /api/admin/media/:mediaId/match/douban

Access boundary: `admin`. [Admin.MatchMediaDouban](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L276)

Parameters: `Param mediaId`

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

Access boundary: `admin`. [Admin.MatchSeriesDouban](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L296)

Parameters: `Param seriesId`

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

Access boundary: `admin`. [Admin.GetDoubanConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L504)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"configured":    configured,
			"masked_cookie": maskedCookie,
		},
	})
```

### PUT /api/admin/settings/douban

Access boundary: `admin`. [Admin.UpdateDoubanConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L522)

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

Access boundary: `admin`. [Admin.ClearDoubanConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L559)

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

Access boundary: `admin`. [Admin.ValidateDoubanConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L577)

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

Access boundary: `admin`. [Admin.CreateDoubanImportToken](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L668)

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

Access boundary: `admin`. [Admin.GetDoubanImportTokenStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L715)

Parameters: `Query token`

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

Access boundary: `admin`. [Admin.SearchTheTVDB](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L318)

Parameters: `Query q; Query year`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供搜索关键词"})
JSON(http.StatusOK, gin.H{"data": results})
```

### POST /api/admin/series/:seriesId/match/thetvdb

Access boundary: `admin`. [Admin.MatchSeriesTheTVDB](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/admin_metadata.go#L336)

Parameters: `Param seriesId`

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

Access boundary: `admin`. [AI.GetAIStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L52)

```go
JSON(http.StatusOK, gin.H{"data": status})
```

### PUT /api/admin/ai/config

Access boundary: `admin`. [AI.UpdateAIConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L58)

```go
map
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "AI 配置已更新", "data": status})
```

### POST /api/admin/ai/auto-pilot

Access boundary: `admin`. [AI.EnableAutoPilot](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L147)

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

Access boundary: `admin`. [AI.TestAIConnection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L75)

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

Access boundary: `admin`. [AI.TestDesensitizeConnection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L90)

```go
JSON(http.StatusOK, gin.H{"data": result})
```

### DELETE /api/admin/ai/cache

Access boundary: `admin`. [AI.ClearAICache](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L96)

```go
JSON(http.StatusOK, gin.H{
		"message": "AI 缓存已清空",
		"data":    gin.H{"cleared": count},
	})
```

### GET /api/admin/ai/cache

Access boundary: `admin`. [AI.GetAICacheStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L105)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/ai/errors

Access boundary: `admin`. [AI.GetAIErrorLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L111)

```go
JSON(http.StatusOK, gin.H{"data": logs})
```

### POST /api/admin/ai/test/search

Access boundary: `admin`. [AI.TestSmartSearch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L117)

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

Access boundary: `admin`. [AI.TestRecommendReason](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L191)

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

Access boundary: `admin`. [AICost.ListModels](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_cost.go#L35)

Parameters: `Query provider`

```go
JSON(http.StatusOK, gin.H{"data": models, "total": len(models)})
```

### GET /api/admin/ai/cost/estimate

Access boundary: `admin`. [AICost.Estimate](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_cost.go#L45)

Parameters: `Query model; Query provider; DefaultQuery prompt_tokens = 1000; DefaultQuery completion_tokens = 500`

```go
JSON(http.StatusBadRequest, gin.H{"error": "model 必填"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": est})
```

### GET /api/admin/ai/cost/summary

Access boundary: `admin`. [AICost.Summary](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_cost.go#L64)

```go
JSON(http.StatusOK, gin.H{"data": sum})
```

### GET /api/admin/ai/router

Access boundary: `admin`. [AI.GetRouterSnapshot](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L215)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{
			"failover_enabled":   false,
			"current_active":     "",
			"preferred_provider": "",
		}})
JSON(http.StatusOK, gin.H{"data": h.router.GetSnapshot()})
```

### POST /api/admin/ai/router/switch

Access boundary: `admin`. [AI.ForceSwitchProvider](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L230)

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

Access boundary: `admin`. [AI.RestoreProvider](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L254)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "AIRouter 未启用"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "已恢复到主 provider",
		"data":    h.router.GetSnapshot(),
	})
```

### GET /api/admin/ai/router/logs

Access boundary: `admin`. [AI.ListFailoverLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L273)

Parameters: `Query limit`

```go
JSON(http.StatusOK, gin.H{"data": []interface{}{}})
JSON(http.StatusOK, gin.H{"data": logs})
```

### GET /api/admin/ai/usage

Access boundary: `admin`. [AI.GetUsageBuckets](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L297)

Parameters: `DefaultQuery range = month; Query provider`

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

Access boundary: `admin`. [AI.ListProviders](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L338)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"providers": providers}})
```

### POST /api/admin/ai/providers

Access boundary: `admin`. [AI.AddProvider](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L348)

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

Access boundary: `admin`. [AI.UpdateProvider](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L396)

Parameters: `Param id`

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

Access boundary: `admin`. [AI.DeleteProvider](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L457)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少供应商 ID"})
JSON(http.StatusBadRequest, gin.H{"error": "内置 V-Scheduler 供应商不可删除"})
JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
JSON(http.StatusNotFound, gin.H{"error": "供应商不存在"})
JSON(http.StatusOK, gin.H{"message": "供应商已删除"})
```

### POST /api/admin/ai/set-active

Access boundary: `admin`. [AI.SetActive](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L505)

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

Access boundary: `admin`. [AI.FetchModels](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai.go#L540)

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

Access boundary: `admin`. [Stats.GetUserStatsAdmin](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/stats.go#L53)

Parameters: `Param userId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "用户ID不能为空"})
JSON(http.StatusInternalServerError, gin.H{"error": "获取统计失败"})
JSON(http.StatusOK, gin.H{"data": overview})
```

### POST /api/admin/smart-rename/scan

Access boundary: `admin`. [SmartRename.Scan](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/smart_rename.go#L50)

```go
scanRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": plan})
```

### POST /api/admin/smart-rename/execute

Access boundary: `admin`. [SmartRename.Execute](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/smart_rename.go#L80)

```go
executeRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": plan, "dry_run": !req.Confirm})
```

### POST /api/admin/smart-rename/rollback/:planId

Access boundary: `admin`. [SmartRename.Rollback](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/smart_rename.go#L100)

Parameters: `Param planId`

```go
JSON(http.StatusOK, gin.H{"data": plan})
```

### POST /api/admin/smart-rename/cancel/:planId

Access boundary: `admin`. [SmartRename.Cancel](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/smart_rename.go#L111)

Parameters: `Param planId`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "ok"})
```

### GET /api/admin/smart-rename/plans

Access boundary: `admin`. [SmartRename.ListPlans](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/smart_rename.go#L121)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": gin.H{
		"items": plans,
		"total": total,
		"page":  page,
		"size":  size,
	}})
```

### GET /api/admin/smart-rename/plans/:planId

Access boundary: `admin`. [SmartRename.GetPlan](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/smart_rename.go#L139)

Parameters: `Param planId`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": plan})
```

### DELETE /api/admin/smart-rename/plans/:planId

Access boundary: `admin`. [SmartRename.DeletePlan](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/smart_rename.go#L150)

Parameters: `Param planId`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "ok"})
```

### PUT /api/admin/smart-rename/items/:itemId

Access boundary: `admin`. [SmartRename.UpdateItem](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/smart_rename.go#L162)

Parameters: `Param itemId`

```go
updateItemRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": it})
```

### GET /api/admin/scan-classify

Access boundary: `admin`. [ScanPostProcess.List](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/scan_postprocess.go#L56)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 50; DefaultQuery min_score = 0; Query library_id; Query status; Query category; Query region; Query decade; Query keyword`

```go
JSON(http.StatusOK, gin.H{"data": gin.H{
		"items": items,
		"total": total,
		"page":  page,
		"size":  size,
	}})
```

### GET /api/admin/scan-classify/stats

Access boundary: `admin`. [ScanPostProcess.Stats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/scan_postprocess.go#L193)

Parameters: `Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/scan-classify/:mediaId

Access boundary: `admin`. [ScanPostProcess.Get](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/scan_postprocess.go#L86)

Parameters: `Param mediaId`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": item})
```

### POST /api/admin/scan-classify/reprocess

Access boundary: `admin`. [ScanPostProcess.Reprocess](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/scan_postprocess.go#L103)

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

Access boundary: `admin`. [ScanPostProcess.Cancel](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/scan_postprocess.go#L209)

Parameters: `Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": res})
```

### POST /api/admin/scan-classify/correct

Access boundary: `admin`. [ScanPostProcess.Correct](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/scan_postprocess.go#L149)

```go
correctRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": out})
```

### DELETE /api/admin/scan-classify

Access boundary: `admin`. [ScanPostProcess.Clear](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/scan_postprocess.go#L175)

Parameters: `Query library_id`

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": count}})
```

### POST /api/admin/ingest/submit

Access boundary: `admin`. [LazyIngest.Submit](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ingest_lazy.go#L44)

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

Access boundary: `admin`. [LazyIngest.ListJobs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ingest_lazy.go#L95)

Parameters: `DefaultQuery limit = 50`

```go
JSON(http.StatusOK, gin.H{"data": jobs})
```

### GET /api/admin/ingest/jobs/:id

Access boundary: `admin`. [LazyIngest.GetJob](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ingest_lazy.go#L82)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": job})
```

### GET /api/admin/ingest/jobs/:id/items

Access boundary: `admin`. [LazyIngest.GetJobItems](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ingest_lazy.go#L121)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": items, "total": len(items)})
```

### POST /api/admin/ingest/jobs/:id/cancel

Access boundary: `admin`. [LazyIngest.CancelJob](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ingest_lazy.go#L108)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "ok"})
```

### POST /api/admin/ingest/jobs/:id/rollback

Access boundary: `admin`. [LazyIngest.RollbackJob](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ingest_lazy.go#L134)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": res})
```

### GET /api/admin/adult-scraper/config

Access boundary: `admin`. [AdultScraper.GetConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper.go#L62)

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

Access boundary: `admin`. [AdultScraper.UpdateConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper.go#L141)

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

Access boundary: `admin`. [AdultScraper.ScrapeByCode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper.go#L260)

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

Access boundary: `admin`. [AdultScraper.BrowserMediaStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_browser.go#L11)

Parameters: `Query path; Query video_path`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 path 参数"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": status})
```

### POST /api/admin/adult-scraper/browser/import

Access boundary: `admin`. [AdultScraper.ImportBrowserMetadata](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_browser.go#L30)

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

Access boundary: `admin`. [AdultScraper.ParseCode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper.go#L279)

Parameters: `Query input`

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

Access boundary: `admin`. [AdultScraper.PythonServiceHealth](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper.go#L309)

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

Access boundary: `admin`. [AdultScraper.ScrapeAggregated](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p2.go#L19)

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

Access boundary: `admin`. [AdultScraper.TestAllSources](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p2.go#L46)

Parameters: `Query code`

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

Access boundary: `admin`. [AdultScraper.GetMappings](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p2.go#L96)

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

Access boundary: `admin`. [AdultScraper.AddMappings](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p2.go#L113)

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

Access boundary: `admin`. [AdultScraper.TestNormalize](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p2.go#L151)

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

Access boundary: `admin`. [AdultScraper.UpdateConfigExtended](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p2.go#L189)

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

Access boundary: `admin`. [AdultScraper.GetLazyStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L220)

Parameters: `Query days`

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

Access boundary: `admin`. [AdultScraper.StartLazyScrape](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L140)

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

Access boundary: `admin`. [AdultScraper.RetryLazyFailed](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L358)

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

Access boundary: `admin`. [AdultScraper.StartBatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L462)

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

Access boundary: `admin`. [AdultScraper.PauseBatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L497)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "已暂停"})
```

### POST /api/admin/adult-scraper/batch/:id/resume

Access boundary: `admin`. [AdultScraper.ResumeBatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L507)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "已恢复"})
```

### POST /api/admin/adult-scraper/batch/:id/cancel

Access boundary: `admin`. [AdultScraper.CancelBatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L517)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "已取消"})
```

### GET /api/admin/adult-scraper/batch/:id

Access boundary: `admin`. [AdultScraper.GetBatchStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L527)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": t})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /api/admin/adult-scraper/batch

Access boundary: `admin`. [AdultScraper.ListBatchTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L546)

```go
JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"active":  active,
			"history": history,
		},
	})
```

### GET /api/admin/adult-scraper/mirrors

Access boundary: `admin`. [AdultScraper.ListMirrors](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L567)

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

Access boundary: `admin`. [AdultScraper.HealthCheckMirrors](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L590)

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

Access boundary: `admin`. [AdultScraper.SetMirrors](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L607)

Parameters: `Param source`

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

Access boundary: `admin`. [AdultScraper.GetCacheStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L624)

```go
JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": false}})
JSON(http.StatusOK, gin.H{"data": h.cache.Stats()})
```

### DELETE /api/admin/adult-scraper/cache

Access boundary: `admin`. [AdultScraper.ClearCache](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L634)

```go
JSON(http.StatusOK, gin.H{"message": "缓存未启用"})
JSON(http.StatusOK, gin.H{"message": "缓存已清空"})
```

### DELETE /api/admin/adult-scraper/cache/:code

Access boundary: `admin`. [AdultScraper.InvalidateCache](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L645)

Parameters: `Param code`

```go
JSON(http.StatusOK, gin.H{"message": "已失效: " + code})
```

### GET /api/admin/adult-scraper/scheduler

Access boundary: `admin`. [AdultScraper.GetSchedulerConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L657)

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

Access boundary: `admin`. [AdultScraper.UpdateSchedulerConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L673)

```go
service.AdultSchedulerConfig
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "参数无效"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "调度器未初始化"})
JSON(http.StatusOK, gin.H{"message": "调度器配置已更新"})
```

### POST /api/admin/adult-scraper/scheduler/run

Access boundary: `admin`. [AdultScraper.TriggerScheduler](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L689)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "调度器未初始化"})
JSON(http.StatusOK, gin.H{"data": gin.H{"task_id": taskID}})
```

### GET /api/admin/adult-scraper/report

Access boundary: `admin`. [AdultScraper.GetReport](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L706)

Parameters: `Query days`

```go
JSON(http.StatusOK, gin.H{"data": service.BuildReport(nil, days)})
JSON(http.StatusOK, gin.H{"data": report})
```

### GET /api/admin/adult-scraper/failed-items

Access boundary: `admin`. [AdultScraper.GetFailedItems](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L723)

Parameters: `Query days`

```go
JSON(http.StatusOK, gin.H{"data": []any{}, "count": 0})
JSON(http.StatusOK, gin.H{"data": items, "count": len(items)})
```

### POST /api/admin/adult-scraper/retry-failed

Access boundary: `admin`. [AdultScraper.RetryFailed](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_p3.go#L741)

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

Access boundary: `admin`. [AdultScraper.ScanFolder](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_folder.go#L17)

Parameters: `Query path; DefaultQuery recursive = true; DefaultQuery max_depth = 0`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供 path 参数"})
JSON(http.StatusServiceUnavailable, gin.H{"error": "番号刮削服务未初始化"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/adult-scraper/folder/batch/start

Access boundary: `admin`. [AdultScraper.StartFolderBatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_folder.go#L43)

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

Access boundary: `admin`. [AdultScraper.ListFolderBatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_folder.go#L91)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "文件夹刮削服务未初始化"})
JSON(http.StatusOK, gin.H{"data": gin.H{"active": active, "history": history}})
```

### GET /api/admin/adult-scraper/folder/batch/:id

Access boundary: `admin`. [AdultScraper.GetFolderBatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_folder.go#L75)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "文件夹刮削服务未初始化"})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusOK, gin.H{"data": task})
```

### POST /api/admin/adult-scraper/folder/batch/:id/cancel

Access boundary: `admin`. [AdultScraper.CancelFolderBatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_folder.go#L102)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "文件夹刮削服务未初始化"})
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "已取消"})
```

### GET /api/admin/adult-scraper/cookie/test

Access boundary: `admin`. [AdultScraper.TestCookie](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/adult_scraper_folder.go#L119)

Parameters: `Query site`

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

Access boundary: `admin`. [FileManager.ListFiles](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L34)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; Query library_id; Query media_type; Query keyword; DefaultQuery sort_by = created_at; DefaultQuery sort_order = desc; Query scraped`

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

Access boundary: `admin`. [FileManager.GetFolderTree](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L84)

Parameters: `Query library_id`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取文件夹树失败"})
JSON(http.StatusOK, gin.H{"data": tree})
```

### GET /api/admin/files/by-folder

Access boundary: `admin`. [FileManager.ListFilesByFolder](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L97)

Parameters: `Query path; DefaultQuery page = 1; DefaultQuery size = 20; Query library_id; Query media_type; Query keyword; DefaultQuery sort_by = created_at; DefaultQuery sort_order = desc; Query scraped`

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

Access boundary: `admin`. [FileManager.CreateFolder](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L143)

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

Access boundary: `admin`. [FileManager.RenameFolder](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L161)

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

Access boundary: `admin`. [FileManager.DeleteFolder](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L179)

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

Access boundary: `admin`. [FileManager.GetFileDetail](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L73)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "文件不存在"})
JSON(http.StatusOK, gin.H{"data": media})
```

### POST /api/admin/files/import

Access boundary: `admin`. [FileManager.ImportFile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L199)

```go
service.FileImportRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": media, "message": "文件导入成功"})
```

### PUT /api/admin/files/:id

Access boundary: `admin`. [FileManager.UpdateFile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L219)

Parameters: `Param id`

```go
map
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": media, "message": "更新成功"})
```

### DELETE /api/admin/files/:id

Access boundary: `admin`. [FileManager.DeleteFile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L240)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "文件记录已删除（原始文件未受影响）"})
```

### POST /api/admin/files/batch/delete

Access boundary: `admin`. [FileManager.BatchDeleteFiles](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L253)

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

Access boundary: `admin`. [FileManager.ScrapeFile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L275)

Parameters: `Param id`

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

Access boundary: `admin`. [FileManager.BatchScrapeFiles](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L292)

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

Access boundary: `admin`. [FileManager.PreviewRename](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L315)

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

Access boundary: `admin`. [FileManager.ExecuteRename](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L339)

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

Access boundary: `admin`. [FileManager.AIGenerateRenames](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L364)

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

Access boundary: `admin`. [FileManager.GetRenameTemplates](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L384)

```go
JSON(http.StatusOK, gin.H{"data": templates})
```

### GET /api/admin/files/stats

Access boundary: `admin`. [FileManager.GetStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L392)

Parameters: `Query library_id; Query folder_path`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取统计失败"})
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/files/logs

Access boundary: `admin`. [FileManager.GetOperationLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/file_manager.go#L404)

Parameters: `DefaultQuery limit = 50`

```go
JSON(http.StatusOK, gin.H{"data": logs})
```

### POST /api/admin/assistant/chat

Access boundary: `admin`. [AIAssistant.Chat](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_assistant.go#L19)

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

Access boundary: `admin`. [AIAssistant.ExecuteAction](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_assistant.go#L42)

```go
service.ExecuteRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": resp})
```

### POST /api/admin/assistant/undo/:opId

Access boundary: `admin`. [AIAssistant.UndoOperation](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_assistant.go#L60)

Parameters: `Param opId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "操作ID不能为空"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": resp})
```

### GET /api/admin/assistant/session/:sessionId

Access boundary: `admin`. [AIAssistant.GetSession](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_assistant.go#L78)

Parameters: `Param sessionId`

```go
JSON(http.StatusNotFound, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": session})
```

### DELETE /api/admin/assistant/session/:sessionId

Access boundary: `admin`. [AIAssistant.DeleteSession](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_assistant.go#L90)

Parameters: `Param sessionId`

```go
JSON(http.StatusOK, gin.H{"message": "会话已删除"})
```

### GET /api/admin/assistant/history

Access boundary: `admin`. [AIAssistant.GetOperationHistory](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_assistant.go#L97)

Parameters: `DefaultQuery limit = 20`

```go
JSON(http.StatusOK, gin.H{"data": history})
```

### GET /api/admin/assistant/misclassification

Access boundary: `admin`. [AIAssistant.AnalyzeMisclassification](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_assistant.go#L109)

```go
JSON(http.StatusOK, gin.H{"data": report})
```

### POST /api/admin/assistant/reclassify

Access boundary: `admin`. [AIAssistant.ReclassifyFiles](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/ai_assistant.go#L120)

```go
service.ReclassifyRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数无效"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/admin/notification/config

Access boundary: `admin`. [Notification.GetConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L19)

```go
JSON(http.StatusOK, gin.H{"data": cfg})
```

### PUT /api/admin/notification/config

Access boundary: `admin`. [Notification.UpdateConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L25)

```go
service.NotificationConfig
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的配置参数"})
JSON(http.StatusOK, gin.H{"message": "通知配置已更新", "data": cfg})
```

### POST /api/admin/notification/test

Access boundary: `admin`. [Notification.TestNotification](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L37)

Parameters: `Query channel`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请指定通知渠道"})
JSON(http.StatusOK, gin.H{"message": "测试通知已发送"})
```

### POST /api/admin/batch/metadata/media

Access boundary: `admin`. [BatchMetadata.BatchUpdateMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L134)

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

Access boundary: `admin`. [BatchMetadata.BatchUpdateSeries](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L154)

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

Access boundary: `admin`. [BatchMetadata.TestImportConnection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L177)

```go
service.ImportSource
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "连接成功"})
```

### POST /api/admin/import/libraries

Access boundary: `admin`. [BatchMetadata.FetchImportLibraries](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L193)

```go
service.ImportSource
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"data": libraries})
```

### POST /api/admin/import/external

Access boundary: `admin`. [BatchMetadata.ImportFromExternal](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L210)

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

Access boundary: `admin`. [BatchMetadata.ExportLibrary](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L234)

Parameters: `Query library_id`

```go
JSON(http.StatusOK, gin.H{
		"message": "导出成功",
		"data":    data,
	})
```

### POST /api/admin/import/data

Access boundary: `admin`. [BatchMetadata.ImportFromExportData](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/notification.go#L250)

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

Access boundary: `admin`. [ImportTarget.List](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/import_target.go#L35)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库列表失败"})
JSON(http.StatusOK, gin.H{
		"data": service.BuildImportLocations(libs, mediaHostPath, exposedRoot),
	})
```

### POST /api/admin/import/ensure-library

Access boundary: `admin`. [ImportTarget.EnsureLibrary](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/import_target.go#L66)

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

Access boundary: `admin`. [EmbyCompat.DetectEmbyFormat](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/emby_compat.go#L18)

Parameters: `Query path`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供目录路径"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/emby/import

Access boundary: `admin`. [EmbyCompat.ImportEmbyLibrary](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/emby_compat.go#L35)

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

Access boundary: `admin`. [EmbyCompat.GetEmbyCompatInfo](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/emby_compat.go#L69)

```go
JSON(http.StatusOK, gin.H{"data": info})
```

### GET /api/admin/emby/nfo/:mediaId

Access boundary: `admin`. [EmbyCompat.GenerateEmbyNFO](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/emby_compat.go#L75)

Parameters: `Param mediaId`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供媒体 ID"})
JSON(http.StatusOK, gin.H{
		"message":  "NFO 生成功能已就绪",
		"media_id": mediaID,
	})
```

### GET /api/admin/profiles

Access boundary: `admin`. [UserProfile.ListProfiles](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L19)

```go
JSON(http.StatusOK, gin.H{"data": profiles})
```

### POST /api/admin/profiles

Access boundary: `admin`. [UserProfile.CreateProfile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L29)

```go
service.UserProfile
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "配置文件已创建", "data": profile})
```

### GET /api/admin/profiles/:id

Access boundary: `admin`. [UserProfile.GetProfile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L43)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "配置文件不存在"})
JSON(http.StatusOK, gin.H{"data": profile})
```

### PUT /api/admin/profiles/:id

Access boundary: `admin`. [UserProfile.UpdateProfile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L53)

Parameters: `Param id`

```go
map
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"message": "配置文件已更新"})
```

### DELETE /api/admin/profiles/:id

Access boundary: `admin`. [UserProfile.DeleteProfile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L67)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "配置文件已删除"})
```

### POST /api/admin/profiles/:id/switch

Access boundary: `admin`. [UserProfile.SwitchProfile](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L76)

Parameters: `Param id`

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

Access boundary: `admin`. [UserProfile.GetWatchLogs](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L90)

Parameters: `Param id; DefaultQuery days = 7`

```go
JSON(http.StatusOK, gin.H{"data": logs})
```

### GET /api/admin/profiles/:id/usage

Access boundary: `admin`. [UserProfile.GetDailyUsage](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L101)

Parameters: `Param id; DefaultQuery days = 30`

```go
JSON(http.StatusOK, gin.H{"data": usage})
```

### GET /api/admin/profiles/:id/stats

Access boundary: `admin`. [UserProfile.GetProfileStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L112)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### POST /api/admin/downloads

Access boundary: `admin`. [OfflineDownload.CreateDownload](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L125)

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

Access boundary: `admin`. [OfflineDownload.BatchDownload](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L146)

```go
service.BatchDownloadRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
JSON(http.StatusOK, gin.H{"data": tasks, "errors": errors})
```

### GET /api/admin/downloads

Access boundary: `admin`. [OfflineDownload.ListDownloads](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L157)

Parameters: `Query status`

```go
JSON(http.StatusOK, gin.H{"data": tasks})
```

### GET /api/admin/downloads/queue

Access boundary: `admin`. [OfflineDownload.GetQueueInfo](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L168)

```go
JSON(http.StatusOK, gin.H{"data": info})
```

### POST /api/admin/downloads/:id/cancel

Access boundary: `admin`. [OfflineDownload.CancelDownload](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L178)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载已取消"})
```

### POST /api/admin/downloads/:id/pause

Access boundary: `admin`. [OfflineDownload.PauseDownload](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L188)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载已暂停"})
```

### POST /api/admin/downloads/:id/resume

Access boundary: `admin`. [OfflineDownload.ResumeDownload](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L198)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载已恢复"})
```

### DELETE /api/admin/downloads/:id

Access boundary: `admin`. [OfflineDownload.DeleteDownload](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L208)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "下载已删除"})
```

### GET /api/admin/abr/status

Access boundary: `admin`. [ABR.GetStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L699)

```go
JSON(http.StatusOK, gin.H{"data": status})
```

### GET /api/admin/abr/gpu

Access boundary: `admin`. [ABR.GetGPUInfo](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L704)

```go
JSON(http.StatusOK, gin.H{"data": info})
```

### DELETE /api/admin/abr/cache

Access boundary: `admin`. [ABR.CleanCache](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L709)

Parameters: `Query media_id`

```go
JSON(http.StatusOK, gin.H{"message": "ABR 缓存已清理"})
JSON(http.StatusOK, gin.H{"message": "所有 ABR 缓存已清理", "freed_bytes": size})
```

### GET /api/admin/plugins

Access boundary: `admin`. [Plugin.ListPlugins](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L225)

```go
JSON(http.StatusOK, gin.H{"data": plugins})
```

### GET /api/admin/plugins/:id

Access boundary: `admin`. [Plugin.GetPlugin](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L234)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "插件不存在"})
JSON(http.StatusOK, gin.H{"data": info, "manifest": manifest})
```

### POST /api/admin/plugins/:id/enable

Access boundary: `admin`. [Plugin.EnablePlugin](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L244)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "插件已启用"})
```

### POST /api/admin/plugins/:id/disable

Access boundary: `admin`. [Plugin.DisablePlugin](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L253)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "插件已禁用"})
```

### DELETE /api/admin/plugins/:id

Access boundary: `admin`. [Plugin.UninstallPlugin](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L262)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "插件已卸载"})
```

### PUT /api/admin/plugins/:id/config

Access boundary: `admin`. [Plugin.UpdatePluginConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L271)

Parameters: `Param id`

```go
map
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "无效的配置"})
JSON(http.StatusOK, gin.H{"message": "插件配置已更新"})
```

### POST /api/admin/plugins/scan

Access boundary: `admin`. [Plugin.ScanPlugins](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L285)

```go
JSON(http.StatusOK, gin.H{"data": discovered})
```

### POST /api/admin/music/scan

Access boundary: `admin`. [Music.ScanLibrary](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L369)

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

Access boundary: `admin`. [Photo.ScanLibrary](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L564)

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

Access boundary: `admin`. [Federation.ListNodes](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L588)

```go
JSON(http.StatusOK, gin.H{"data": nodes})
```

### POST /api/admin/federation/nodes

Access boundary: `admin`. [Federation.RegisterNode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L597)

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

Access boundary: `admin`. [Federation.RemoveNode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L616)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "节点已移除"})
```

### POST /api/admin/federation/nodes/:id/sync

Access boundary: `admin`. [Federation.SyncNode](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L625)

Parameters: `Param id; DefaultQuery type = full`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "同步已开始", "data": task})
```

### GET /api/admin/federation/stats

Access boundary: `admin`. [Federation.GetStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L658)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/federation/sync-tasks

Access boundary: `admin`. [Federation.GetSyncTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L667)

Parameters: `Query node_id`

```go
JSON(http.StatusOK, gin.H{"data": tasks})
```

### POST /api/admin/media/batch-move

Access boundary: `admin`. [Library.BatchMoveMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v4_features.go#L13)

```go
service.BatchMoveMediaRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": "请求参数错误"})
JSON(http.StatusBadRequest, gin.H{"error": "media_ids 和 target_library_id 不能为空"})
JSON(http.StatusOK, gin.H{"data": result})
```

### GET /api/admin/duplicates

Access boundary: `admin`. [Library.DetectAllDuplicates](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L421)

```go
JSON(http.StatusOK, gin.H{
		"data":  groups,
		"total": len(groups),
	})
```

### GET /api/admin/libraries/:id/duplicates

Access boundary: `admin`. [Library.DetectDuplicates](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L406)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{
		"data":  groups,
		"total": len(groups),
	})
```

### POST /api/admin/libraries/:id/mark-duplicates

Access boundary: `admin`. [Library.MarkDuplicates](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/library.go#L435)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已标记 %d 个重复文件", count),
		"marked":  count,
	})
```

### GET /api/admin/pulse/dashboard

Access boundary: `admin`. [Pulse.GetDashboard](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L21)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取仪表盘数据失败"})
JSON(http.StatusOK, gin.H{"data": data})
```

### GET /api/admin/pulse/dashboard/trends

Access boundary: `admin`. [Pulse.GetPlayTrends](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L31)

Parameters: `DefaultQuery days = 30`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取播放趋势失败"})
JSON(http.StatusOK, gin.H{"data": trends})
```

### GET /api/admin/pulse/dashboard/top-content

Access boundary: `admin`. [Pulse.GetTopContent](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L42)

Parameters: `DefaultQuery days = 30; DefaultQuery limit = 10`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取热门内容失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/dashboard/top-users

Access boundary: `admin`. [Pulse.GetTopUsers](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L54)

Parameters: `DefaultQuery days = 30; DefaultQuery limit = 10`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取用户排行失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/dashboard/recent

Access boundary: `admin`. [Pulse.GetRecentPlays](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L66)

Parameters: `DefaultQuery limit = 20`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取最近播放失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/analytics

Access boundary: `admin`. [Pulse.GetAnalytics](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L79)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体分析失败"})
JSON(http.StatusOK, gin.H{"data": data})
```

### GET /api/admin/pulse/analytics/hourly

Access boundary: `admin`. [Pulse.GetHourlyDistribution](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L89)

Parameters: `DefaultQuery days = 30`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取时段分布失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/analytics/libraries

Access boundary: `admin`. [Pulse.GetLibraryStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L100)

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取媒体库统计失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### GET /api/admin/pulse/analytics/growth

Access boundary: `admin`. [Pulse.GetMediaGrowth](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/pulse.go#L110)

Parameters: `DefaultQuery months = 12`

```go
JSON(http.StatusInternalServerError, gin.H{"error": "获取增长趋势失败"})
JSON(http.StatusOK, gin.H{"data": items})
```

### POST /api/admin/preprocess/submit

Access boundary: `admin`. [Preprocess.SubmitMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L25)

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

Access boundary: `admin`. [Preprocess.BatchSubmit](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L51)

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

Access boundary: `admin`. [Preprocess.SubmitLibrary](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L78)

Parameters: `Param id`

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

Access boundary: `admin`. [Preprocess.ListTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L132)

Parameters: `DefaultQuery page = 1; DefaultQuery page_size = 20; Query status`

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

Access boundary: `admin`. [Preprocess.GetTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L100)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusOK, gin.H{"data": task})
```

### POST /api/admin/preprocess/tasks/:id/pause

Access boundary: `admin`. [Preprocess.PauseTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L161)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已暂停"})
```

### POST /api/admin/preprocess/tasks/:id/resume

Access boundary: `admin`. [Preprocess.ResumeTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L171)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已恢复"})
```

### POST /api/admin/preprocess/tasks/:id/cancel

Access boundary: `admin`. [Preprocess.CancelTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L181)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已取消"})
```

### POST /api/admin/preprocess/tasks/:id/retry

Access boundary: `admin`. [Preprocess.RetryTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L191)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已重新提交"})
```

### DELETE /api/admin/preprocess/tasks/:id

Access boundary: `admin`. [Preprocess.DeleteTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L201)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已删除"})
```

### GET /api/admin/preprocess/statistics

Access boundary: `admin`. [Preprocess.GetStatistics](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L277)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/preprocess/system-load

Access boundary: `admin`. [Preprocess.GetSystemLoad](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L283)

```go
JSON(http.StatusOK, gin.H{"data": load})
```

### POST /api/admin/preprocess/tasks/batch-delete

Access boundary: `admin`. [Preprocess.BatchDeleteTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L211)

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

Access boundary: `admin`. [Preprocess.BatchCancelTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L233)

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

Access boundary: `admin`. [Preprocess.BatchRetryTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L255)

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

Access boundary: `admin`. [Preprocess.CleanCache](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L289)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "预处理缓存已清理"})
```

### GET /api/admin/preprocess/storage-usage

Access boundary: `admin`. [Preprocess.GetStorageUsage](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L302)

Parameters: `DefaultQuery limit = 20`

```go
JSON(http.StatusOK, gin.H{"data": usage})
```

### POST /api/admin/preprocess/clean-orphan

Access boundary: `admin`. [Preprocess.CleanOrphanCache](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L320)

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

Access boundary: `admin`. [Preprocess.GetCacheUsage](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L339)

Parameters: `Query force; Query force`

```go
JSON(http.StatusOK, gin.H{"data": usage})
```

### POST /api/admin/cache/clean

Access boundary: `admin`. [Preprocess.CleanCacheCategory](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L356)

Parameters: `Query key; Query mode`

```go
JSON(http.StatusBadRequest, gin.H{"error": "缺少 key 参数"})
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{
		"message": "已清理",
		"data":    res,
	})
```

### POST /api/admin/cache/clean-all

Access boundary: `admin`. [Preprocess.CleanAllCache](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L375)

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

Access boundary: `admin`. [Preprocess.PreviewByFilter](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L426)

```go
preprocessFilterRequest
```

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"data": preview})
```

### POST /api/admin/preprocess/submit-by-filter

Access boundary: `admin`. [Preprocess.SubmitByFilter](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L447)

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

Access boundary: `admin`. [Preprocess.ListCandidateMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/preprocess.go#L486)

Parameters: `DefaultQuery page = 1; DefaultQuery size = 20; Query only_need_preprocess; Query keyword; Query library_id; Query media_type; Query video_codec; Query sort_by; Query sort_order`

```go
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/video-analysis/tasks

Access boundary: `admin`. [VideoAnalysis.SubmitMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L37)

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

Access boundary: `admin`. [VideoAnalysis.BatchSubmit](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L68)

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

Access boundary: `admin`. [VideoAnalysis.ListTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L130)

Parameters: `DefaultQuery page = 1; DefaultQuery page_size = 20; Query group_by_media; Query status; Query library_id; Query keyword; Query media_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询任务列表失败"})
JSON(http.StatusOK, gin.H{"data": gin.H{
		"tasks": tasks, "total": total, "page": page, "page_size": pageSize,
	}})
```

### GET /api/admin/video-analysis/tasks/latest

Access boundary: `admin`. [VideoAnalysis.GetLatestTaskByMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L108)

Parameters: `Query media_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusBadRequest, gin.H{"error": "请提供 media_id"})
JSON(http.StatusOK, gin.H{"data": nil})
JSON(http.StatusInternalServerError, gin.H{"error": "查询最新任务失败"})
JSON(http.StatusOK, gin.H{"data": task})
```

### GET /api/admin/video-analysis/tasks/:id

Access boundary: `admin`. [VideoAnalysis.GetTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L91)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询任务失败"})
JSON(http.StatusOK, gin.H{"data": task})
```

### POST /api/admin/video-analysis/tasks/:id/retry

Access boundary: `admin`. [VideoAnalysis.RetryTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L157)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusConflict, gin.H{"error": "该媒体已有进行中的视频分析任务", "data": task})
JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
JSON(http.StatusAccepted, gin.H{"data": task})
```

### DELETE /api/admin/video-analysis/tasks/:id

Access boundary: `admin`. [VideoAnalysis.DeleteTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L180)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusConflict, gin.H{"error": "分析中的任务不可删除，请等待完成后再删"})
JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已删除"})
```

### GET /api/admin/video-analysis/statistics

Access boundary: `admin`. [VideoAnalysis.Statistics](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L199)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询任务统计失败"})
JSON(http.StatusOK, gin.H{"data": counts})
```

### GET /api/admin/video-analysis/statistics/detailed

Access boundary: `admin`. [VideoAnalysis.DetailedStatistics](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L212)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusInternalServerError, gin.H{"error": "查询详细统计失败"})
JSON(http.StatusOK, gin.H{"data": stats})
```

### GET /api/admin/video-analysis/config

Access boundary: `admin`. [VideoAnalysis.GetConfig](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L226)

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用或配置无效"})
JSON(http.StatusOK, gin.H{"data": config})
```

### GET /api/admin/video-analysis/health

Access boundary: `admin`. [VideoAnalysis.GetHealth](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L237)

```go
JSON(http.StatusOK, gin.H{"data": h.service.GetHealth(c.Request.Context())})
```

### GET /api/admin/video-analysis/settings

Access boundary: `admin`. [VideoAnalysis.GetSettings](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L319)

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

Access boundary: `admin`. [VideoAnalysis.UpdateSettings](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L334)

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

Access boundary: `admin`. [VideoAnalysis.Cleanup](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L391)

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

Access boundary: `admin`. [VideoAnalysis.SearchScenes](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L495)

Parameters: `Query q; DefaultQuery limit = 20; DefaultQuery mode = text; Query library_id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "缺少查询参数 q（文本查询）"})
JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("media_ids 数量超过上限 %d", sceneSearchMaxMediaIDs)})
JSON(http.StatusOK, gin.H{"data": results})
```

### GET /api/admin/video-analysis/tasks/:id/scenes

Access boundary: `admin`. [VideoAnalysis.ListScenesByTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L535)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusBadRequest, gin.H{"error": "taskId 是必填参数"})
JSON(http.StatusOK, gin.H{"scenes": items})
```

### GET /api/admin/video-analysis/tasks/:id/workflow

Access boundary: `admin`. [VideoAnalysis.GetWorkflow](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L582)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"data": workflow})
```

### POST /api/admin/video-analysis/tasks/:id/run-stage

Access boundary: `admin`. [VideoAnalysis.RunStage](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L596)

Parameters: `Param id`

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

Access boundary: `admin`. [VideoAnalysis.RunAll](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L616)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"message": "任务已全部执行完成"})
```

### POST /api/admin/video-analysis/tasks/:id/run-missing

Access boundary: `admin`. [VideoAnalysis.RunMissing](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L629)

Parameters: `Param id`

```go
JSON(http.StatusServiceUnavailable, gin.H{"error": "视频分析服务未启用"})
JSON(http.StatusOK, gin.H{"message": "缺失阶段已补齐"})
```

### POST /api/admin/video-analysis/models/pull

Access boundary: `admin`. [VideoAnalysis.PullModelHubModel](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/video_analysis.go#L266)

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

Access boundary: `admin`. [SubtitlePreprocess.SubmitMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L22)

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

Access boundary: `admin`. [SubtitlePreprocess.BatchSubmit](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L46)

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

Access boundary: `admin`. [SubtitlePreprocess.SubmitLibrary](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L73)

Parameters: `Param id`

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

Access boundary: `admin`. [SubtitlePreprocess.ListTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L101)

Parameters: `DefaultQuery page = 1; DefaultQuery page_size = 20; Query status`

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

Access boundary: `admin`. [SubtitlePreprocess.GetTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L130)

Parameters: `Param id`

```go
JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
JSON(http.StatusOK, gin.H{"data": task})
```

### POST /api/admin/subtitle-preprocess/tasks/:id/cancel

Access boundary: `admin`. [SubtitlePreprocess.CancelTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L142)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已取消"})
```

### POST /api/admin/subtitle-preprocess/tasks/:id/retry

Access boundary: `admin`. [SubtitlePreprocess.RetryTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L153)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已重新提交"})
```

### DELETE /api/admin/subtitle-preprocess/tasks/:id

Access boundary: `admin`. [SubtitlePreprocess.DeleteTask](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L164)

Parameters: `Param id`

```go
JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
JSON(http.StatusOK, gin.H{"message": "任务已删除"})
```

### GET /api/admin/subtitle-preprocess/statistics

Access boundary: `admin`. [SubtitlePreprocess.GetStatistics](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L175)

```go
JSON(http.StatusOK, gin.H{"data": stats})
```

### POST /api/admin/subtitle-preprocess/tasks/batch-delete

Access boundary: `admin`. [SubtitlePreprocess.BatchDeleteTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L181)

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

Access boundary: `admin`. [SubtitlePreprocess.BatchCancelTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L203)

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

Access boundary: `admin`. [SubtitlePreprocess.BatchRetryTasks](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L225)

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

Access boundary: `admin`. [SubtitlePreprocess.RetryAllFailed](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L264)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已重试 %d 个失败任务", count),
		"data":    gin.H{"retried": count},
	})
```

### DELETE /api/admin/subtitle-preprocess/tasks/by-status/:status

Access boundary: `admin`. [SubtitlePreprocess.DeleteByStatus](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L278)

Parameters: `Param status`

```go
JSON(http.StatusBadRequest, gin.H{"error": "请提供状态参数"})
JSON(http.StatusBadRequest, gin.H{"error": "不允许删除运行中的任务"})
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("已删除 %d 个 %s 状态的任务", deleted, status),
		"data":    gin.H{"deleted": deleted},
	})
```

### GET /api/admin/subtitle-preprocess/asr-health

Access boundary: `admin`. [SubtitlePreprocess.CheckASRHealth](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/subtitle_preprocess.go#L302)

```go
JSON(http.StatusOK, gin.H{"data": result})
```

### POST /api/admin/collections

Access boundary: `admin`. [Collection.CreateCollection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L134)

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

Access boundary: `admin`. [Collection.AutoMatch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L119)

```go
JSON(http.StatusOK, gin.H{
		"message": "自动匹配完成",
		"created": count,
	})
```

### POST /api/admin/collections/rematch

Access boundary: `admin`. [Collection.Rematch](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L325)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("重新匹配完成，新建 %d 个合集", created),
		"created": created,
	})
```

### POST /api/admin/collections/merge-duplicates

Access boundary: `admin`. [Collection.MergeDuplicates](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L293)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("合并完成，共处理 %d 组同名合集", merged),
		"merged":  merged,
	})
```

### POST /api/admin/collections/cleanup-empty

Access boundary: `admin`. [Collection.CleanupEmpty](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L308)

```go
JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("清理完成，共删除 %d 个空壳合集", cleaned),
		"cleaned": cleaned,
	})
```

### GET /api/admin/collections/duplicate-stats

Access boundary: `admin`. [Collection.DuplicateStats](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L340)

```go
JSON(http.StatusOK, gin.H{
		"data":  stats,
		"count": len(stats),
	})
```

### PUT /api/admin/collections/:id

Access boundary: `admin`. [Collection.UpdateCollection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L155)

Parameters: `Param id`

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

Access boundary: `admin`. [Collection.DeleteCollection](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L176)

Parameters: `Param id`

```go
JSON(http.StatusOK, gin.H{"message": "删除成功"})
```

### POST /api/admin/collections/:id/media

Access boundary: `admin`. [Collection.AddMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L188)

Parameters: `Param id`

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

Access boundary: `admin`. [Collection.RemoveMedia](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/collection.go#L355)

Parameters: `Param id; Param mediaId`

```go
JSON(http.StatusOK, gin.H{"message": "移除成功"})
```

### GET /api/federation/health

Access boundary: `separate/public`. [Federation.Health](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L678)

```go
JSON(http.StatusOK, health)
```

### GET /api/federation/media

Access boundary: `separate/public`. [Federation.MediaList](https://github.com/ictrektech/V-Cine/blob/main/internal/handler/v2_handlers.go#L683)

```go
JSON(http.StatusOK, gin.H{"data": media})
```

## Shared field declarations

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
