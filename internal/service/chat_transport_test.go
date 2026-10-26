package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadChatTransportBodyLimit(t *testing.T) {
	if _, err := readChatTransportBody(strings.NewReader("abcdef"), 3); err == nil {
		t.Fatal("expected body limit error")
	} else {
		var limitErr *chatTransportBodyLimitError
		if !errors.As(err, &limitErr) || limitErr.Limit != 3 {
			t.Fatalf("err = %v, want *chatTransportBodyLimitError with limit 3", err)
		}
	}

	data, err := readChatTransportBody(strings.NewReader("abc"), 3)
	if err != nil || string(data) != "abc" {
		t.Fatalf("body = %q, err = %v", data, err)
	}
}

func TestChatTransportRetriesServerError(t *testing.T) {
	// 503 属于瞬时错误：重试一次并在第二次成功。
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("busy"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	resp, err := doChatTransport(context.Background(), server.Client(), chatTransportRequest{
		URL:         server.URL,
		MaxAttempts: 2,
		BuildBody:   func() ([]byte, error) { return []byte(`{}`), nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 (503 must be retried)", calls)
	}
	if resp.StatusCode != http.StatusOK || resp.Attempt != 2 {
		t.Fatalf("resp = %d attempt=%d, want 200 on attempt 2", resp.StatusCode, resp.Attempt)
	}
}

func TestChatTransportReturnsNonRetryableStatusToCaller(t *testing.T) {
	// 404 不属于可重试/可降级错误：不重试，原样返回状态码与响应体，由调用方分类。
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("not found"))
	}))
	defer server.Close()

	resp, err := doChatTransport(context.Background(), server.Client(), chatTransportRequest{
		URL:         server.URL,
		MaxAttempts: 2,
		BuildBody:   func() ([]byte, error) { return []byte(`{}`), nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 (404 must not be retried)", calls)
	}
	if resp.StatusCode != http.StatusNotFound || string(resp.Body) != "not found" {
		t.Fatalf("resp = %d %q", resp.StatusCode, resp.Body)
	}
}

func TestChatTransportRetriesWhenOnClientErrorDegrades(t *testing.T) {
	// OnClientError 返回 true 表示已降级：下一次尝试必须重新构建请求体。
	var calls int
	var secondBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("bad field"))
			return
		}
		raw, _ := io.ReadAll(r.Body)
		secondBody = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer server.Close()

	builds := 0
	resp, err := doChatTransport(context.Background(), server.Client(), chatTransportRequest{
		URL:         server.URL,
		MaxAttempts: 2,
		BuildBody: func() ([]byte, error) {
			builds++
			if builds == 1 {
				return []byte(`{"reasoning_effort":"none"}`), nil
			}
			return []byte(`{}`), nil
		},
		OnClientError: func(status int, _ []byte) bool {
			return status == http.StatusBadRequest
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || builds != 2 {
		t.Fatalf("calls = %d, builds = %d, want 2/2", calls, builds)
	}
	if resp.StatusCode != http.StatusOK || string(resp.Body) == "" {
		t.Fatalf("resp = %d %q", resp.StatusCode, resp.Body)
	}
	if secondBody != `{}` {
		t.Fatalf("retry body = %q, want rebuilt body", secondBody)
	}
}
