package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"
)

// chatTransportRequest 一次 OpenAI 兼容 /chat/completions 的传输参数。
type chatTransportRequest struct {
	URL           string
	Authorization string
	// BuildBody 每次尝试前重建请求体。
	BuildBody func() ([]byte, error)
	// OnClientError 处理 400 等客户端错误；返回 true 表示已降级、需要再试一次。
	OnClientError func(statusCode int, body []byte) bool
	// MaxAttempts 总尝试次数（含首次），<=0 时按 1 处理。
	MaxAttempts int
	// MaxBody 响应体字节上限（0 = 不限制）。
	MaxBody int
	// RateLimit 每次尝试前的限流钩子（可为 nil）。
	RateLimit func()
	// OnRetry 可重试失败后的等待钩子（如写入全局冷却闸）。
	// 非 nil 时由调用方负责等待；nil 时传输层按退避时长自行等待（受 ctx 取消控制）。
	OnRetry func(wait time.Duration, reason string)
	// NewNetworkError / NewReadError 把底层错误转换为调用方语义。
	NewNetworkError func(err error) error
	NewReadError    func(err error) error
	Logger          *zap.SugaredLogger
	// LogFields 追加到传输层日志的键值对（如 provider/model/credential）。
	LogFields []any
}

// chatTransportResponse 传输层返回的最终响应（2xx，或不可重试的非 2xx）。
type chatTransportResponse struct {
	StatusCode int
	Body       []byte
	Attempt    int
}

// chatTransportBodyLimitError 响应体超过调用方上限。
type chatTransportBodyLimitError struct{ Limit int }

func (e *chatTransportBodyLimitError) Error() string {
	return fmt.Sprintf("响应体超过 %d 字节上限", e.Limit)
}

// chatTransportStatusError 可降级的 400 在重试次数耗尽后仍失败。
type chatTransportStatusError struct {
	StatusCode int
	Body       []byte
}

func (e *chatTransportStatusError) Error() string {
	return fmt.Sprintf("AI API 返回 HTTP %d", e.StatusCode)
}

// doChatTransport 发送聊天补全请求并按统一策略重试：
//   - 网络错误 / 读取响应失败：指数退避重试（1s -> 2s -> 4s -> 8s）
//   - 429 / 5xx：读取 Retry-After 退避重试
//   - 400：交给 OnClientError 判断是否降级重试（response_format / reasoning_effort）
//   - 其他 4xx：直接返回响应，由调用方分类
func doChatTransport(ctx context.Context, client *http.Client, request chatTransportRequest) (*chatTransportResponse, error) {
	maxAttempts := request.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if request.RateLimit != nil {
			request.RateLimit()
		}
		body, err := request.BuildBody()
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, request.URL, bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("chat transport: create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		if request.Authorization != "" {
			req.Header.Set("Authorization", request.Authorization)
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = request.NewNetworkError(err)
			if attempt < maxAttempts {
				wait := backoffDuration(attempt, "")
				request.warn("Chat completion network error",
					"attempt", attempt, "max_attempts", maxAttempts, "wait", wait.String(), "error", err)
				if err := request.waitBeforeRetry(ctx, wait, fmt.Sprintf("network err: %v", err)); err != nil {
					return nil, err
				}
				continue
			}
			return nil, lastErr
		}

		respBody, readErr := readChatTransportBody(resp.Body, request.MaxBody)
		_ = resp.Body.Close()
		if readErr != nil {
			var limitErr *chatTransportBodyLimitError
			if errors.As(readErr, &limitErr) {
				return nil, limitErr
			}
			lastErr = request.NewReadError(readErr)
			if attempt < maxAttempts {
				wait := backoffDuration(attempt, "")
				request.warn("Chat completion read body failed",
					"attempt", attempt, "max_attempts", maxAttempts, "wait", wait.String(), "error", readErr)
				if err := request.waitBeforeRetry(ctx, wait, "read body err"); err != nil {
					return nil, err
				}
				continue
			}
			return nil, lastErr
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return &chatTransportResponse{StatusCode: resp.StatusCode, Body: respBody, Attempt: attempt}, nil
		}

		lastErr = &chatTransportStatusError{StatusCode: resp.StatusCode, Body: respBody}
		if resp.StatusCode == http.StatusBadRequest && request.OnClientError != nil &&
			request.OnClientError(resp.StatusCode, respBody) {
			request.warn("Chat completion HTTP 400, unsupported field stripped, retrying",
				"attempt", attempt, "max_attempts", maxAttempts,
				"response", truncateForLog(string(respBody), 200))
			// 降级请求同样受 maxAttempts 约束；耗尽后由调用方按 400 处理。
			continue
		}

		if chatStatusRetryable(resp.StatusCode) && attempt < maxAttempts {
			wait := backoffDuration(attempt, resp.Header.Get("Retry-After"))
			request.warn("Chat completion HTTP status, retrying",
				"status", resp.StatusCode, "attempt", attempt, "max_attempts", maxAttempts,
				"wait", wait.String(), "response", truncateForLog(string(respBody), 200))
			if err := request.waitBeforeRetry(ctx, wait, fmt.Sprintf("HTTP %d", resp.StatusCode)); err != nil {
				return nil, err
			}
			continue
		}
		return &chatTransportResponse{StatusCode: resp.StatusCode, Body: respBody, Attempt: attempt}, nil
	}

	if lastErr == nil {
		lastErr = errors.New("chat transport: unknown failure")
	}
	return nil, lastErr
}

// readChatTransportBody 读取响应体；设置上限时超限返回 chatTransportBodyLimitError。
func readChatTransportBody(body io.Reader, maxBody int) ([]byte, error) {
	if maxBody <= 0 {
		return io.ReadAll(body)
	}
	data, err := io.ReadAll(io.LimitReader(body, int64(maxBody)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBody {
		return nil, &chatTransportBodyLimitError{Limit: maxBody}
	}
	return data, nil
}

// rejectsRequestField 判断 400 是否由某个请求字段引起：
// 响应体提及该字段，或响应体为空无法判断。
func rejectsRequestField(body []byte, field string) bool {
	lower := strings.ToLower(string(body))
	return strings.Contains(lower, strings.ToLower(field)) || strings.TrimSpace(lower) == ""
}

// chatStatusRetryable 429/5xx 视为瞬时错误，可退避重试。
func chatStatusRetryable(status int) bool {
	return status == http.StatusTooManyRequests ||
		status == http.StatusServiceUnavailable ||
		status == http.StatusBadGateway ||
		status == http.StatusGatewayTimeout ||
		(status >= 500 && status < 600)
}

// waitBeforeRetry 执行重试等待：调用方提供了 OnRetry（如全局冷却闸）时由它负责，
// 否则传输层直接按退避时长等待。
func (r chatTransportRequest) waitBeforeRetry(ctx context.Context, wait time.Duration, reason string) error {
	if r.OnRetry != nil {
		r.OnRetry(wait, reason)
		return nil
	}
	if wait <= 0 {
		return nil
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// warn 输出带公共字段的传输层日志；Logger 为空时跳过（测试/未注入日志的场景）。
func (r chatTransportRequest) warn(message string, kv ...any) {
	if r.Logger == nil {
		return
	}
	fields := make([]any, 0, len(r.LogFields)+len(kv))
	fields = append(fields, r.LogFields...)
	fields = append(fields, kv...)
	r.Logger.Warnw(message, fields...)
}
