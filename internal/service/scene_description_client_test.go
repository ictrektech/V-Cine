package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenAIVisionClientSendsImageAndReturnsDescription(t *testing.T) {
	var gotAuth string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"  夜晚雨中的街道  "}}]}`))
	}))
	defer server.Close()

	dir := t.TempDir()
	imagePath := filepath.Join(dir, "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}

	client := newOpenAIVisionClient(openAIVisionConfig{
		BaseURL: server.URL + "/v1",
		Model:   "model-hub/test-vlm",
		APIKey:  "test-key",
	})
	description, err := client.DescribeImage(context.Background(), imagePath)
	if err != nil {
		t.Fatal(err)
	}
	if description != "夜晚雨中的街道" {
		t.Fatalf("description = %q", description)
	}
	if gotAuth != "Bearer test-key" {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotBody["model"] != "model-hub/test-vlm" {
		t.Fatalf("model = %v", gotBody["model"])
	}
	messages, _ := gotBody["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("messages = %v", messages)
	}
	userContent, _ := messages[1].(map[string]any)["content"].([]any)
	if len(userContent) != 2 {
		t.Fatalf("user content parts = %v", userContent)
	}
	imagePart, _ := userContent[1].(map[string]any)
	if imagePart["type"] != "image_url" {
		t.Fatalf("image part = %v", imagePart)
	}
	imageURL, _ := imagePart["image_url"].(map[string]any)
	if !strings.HasPrefix(fmt.Sprint(imageURL["url"]), "data:image/jpeg;base64,") {
		t.Fatalf("image url = %v", imageURL["url"])
	}
}

func TestOpenAIVisionClientClassifiesRetryableStatus(t *testing.T) {
	cases := []struct {
		name      string
		status    int
		body      string
		retryable bool
	}{
		{name: "rate limited", status: http.StatusTooManyRequests, body: "slow down", retryable: true},
		{name: "server error", status: http.StatusInternalServerError, body: "boom", retryable: true},
		{name: "unknown model", status: http.StatusBadRequest, body: "unknown model: model-hub/minicpm-v4.6", retryable: false},
		{name: "unauthorized", status: http.StatusUnauthorized, body: "invalid key", retryable: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			dir := t.TempDir()
			imagePath := filepath.Join(dir, "scene_000.jpg")
			if err := os.WriteFile(imagePath, []byte("jpeg-bytes"), 0o600); err != nil {
				t.Fatal(err)
			}
			client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
			_, err := client.DescribeImage(context.Background(), imagePath)
			if err == nil {
				t.Fatal("expected error")
			}
			var describeErr *sceneDescribeError
			if !errors.As(err, &describeErr) {
				t.Fatalf("err type = %T, want *sceneDescribeError", err)
			}
			if describeErr.Retryable != tc.retryable {
				t.Fatalf("retryable = %v, want %v (err: %v)", describeErr.Retryable, tc.retryable, err)
			}
			// 上游原文必须保留：extractMissingModel 依赖它识别缺失模型。
			if !strings.Contains(describeErr.Error(), tc.body) {
				t.Fatalf("error %q must contain upstream body %q", describeErr.Error(), tc.body)
			}
		})
	}
}

func TestOpenAIVisionClientMissingModelIsExtractable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"unknown model: model-hub/minicpm-v4.6:latest"}}`))
	}))
	defer server.Close()

	dir := t.TempDir()
	imagePath := filepath.Join(dir, "scene_000.jpg")
	if err := os.WriteFile(imagePath, []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: server.URL, Model: "m"})
	_, err := client.DescribeImage(context.Background(), imagePath)
	if err == nil {
		t.Fatal("expected error")
	}
	if got := extractMissingModel(err.Error()); got != "model-hub/minicpm-v4.6:latest" {
		t.Fatalf("extractMissingModel = %q, want model-hub/minicpm-v4.6:latest", got)
	}
}

func TestOpenAIVisionClientRequiresImagePath(t *testing.T) {
	client := newOpenAIVisionClient(openAIVisionConfig{BaseURL: "http://example.invalid", Model: "m"})
	if _, err := client.DescribeImage(context.Background(), ""); err == nil {
		t.Fatal("expected error for empty image path")
	}
	if _, err := client.DescribeImage(context.Background(), filepath.Join(t.TempDir(), "missing.jpg")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestNewOpenAIVisionClientRequiresBaseURLAndModel(t *testing.T) {
	if c := newOpenAIVisionClient(openAIVisionConfig{Model: "m"}); c != nil {
		t.Fatal("client without base url must be nil")
	}
	if c := newOpenAIVisionClient(openAIVisionConfig{BaseURL: "http://x"}); c != nil {
		t.Fatal("client without model must be nil")
	}
}
