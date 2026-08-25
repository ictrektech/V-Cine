package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSubmitStructureJobSendsVideoPathAndDetectJobID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v2/video/structure/jobs" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		var request StructureJobRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.VideoPath != "/photos/movie.mp4" || request.DetectJobID != "detect-1" {
			t.Fatalf("unexpected request: %+v", request)
		}
		writeAnalysisResponse(t, w, http.StatusOK, 0, "操作成功", map[string]any{
			"job_id": "structure-1", "status": "queued", "poll_url": "/api/v2/video/structure/jobs/structure-1",
		})
	}))
	defer server.Close()

	client, err := NewVideoAnalysisClient(server.URL, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	job, err := client.SubmitStructureJob(context.Background(), StructureJobRequest{
		VideoPath: "/photos/movie.mp4", DetectJobID: "detect-1", FrameGrid: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if job.JobID != "structure-1" {
		t.Fatalf("job ID = %q", job.JobID)
	}
}

func TestSubmitStructureJobValidatesInput(t *testing.T) {
	client, err := NewVideoAnalysisClient("http://scene.test", "http://structure.test", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []StructureJobRequest{
		{DetectJobID: "detect-1"},
		{VideoPath: "/photos/movie.mp4"},
	} {
		if _, err := client.SubmitStructureJob(context.Background(), request); err == nil {
			t.Fatalf("SubmitStructureJob(%+v) should fail", request)
		}
	}
}

func TestSubmitDescribeJobSendsStructureJobID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v2/video/describe/jobs" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		var request DescribeJobRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.StructureJobID != "structure-1" || !request.Force {
			t.Fatalf("unexpected request: %+v", request)
		}
		writeAnalysisResponse(t, w, http.StatusOK, 0, "操作成功", map[string]any{
			"job_id": "describe-1", "status": "queued", "poll_url": "/api/v2/video/describe/jobs/describe-1",
		})
	}))
	defer server.Close()

	client, err := NewVideoAnalysisClient(server.URL, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	job, err := client.SubmitDescribeJob(context.Background(), DescribeJobRequest{StructureJobID: "structure-1", Force: true})
	if err != nil {
		t.Fatal(err)
	}
	if job.JobID != "describe-1" {
		t.Fatalf("job ID = %q", job.JobID)
	}
}

func TestSubmitDescribeJobValidatesInput(t *testing.T) {
	client, err := NewVideoAnalysisClient("http://scene.test", "http://structure.test", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.SubmitDescribeJob(context.Background(), DescribeJobRequest{}); err == nil {
		t.Fatal("SubmitDescribeJob should require video_hash")
	}
}

func TestVideoAnalysisClientChecksHTTPAndBusinessStatus(t *testing.T) {
	tests := []struct {
		name       string
		httpStatus int
		code       int
	}{
		{name: "http error", httpStatus: http.StatusBadGateway, code: 0},
		{name: "business error", httpStatus: http.StatusOK, code: 70101},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				writeAnalysisResponse(t, w, tc.httpStatus, tc.code, "failed", map[string]any{"status": "ok"})
			}))
			defer server.Close()
			client, err := NewVideoAnalysisClient(server.URL, server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.CheckSceneHealth(context.Background())
			var apiErr *VideoAnalysisAPIError
			if !errors.As(err, &apiErr) || apiErr.HTTPStatus != tc.httpStatus || apiErr.Code != tc.code {
				t.Fatalf("error = %#v", err)
			}
		})
	}
}

func TestVideoAnalysisClientRejectsCrossOriginPollURL(t *testing.T) {
	for _, pollURL := range []string{
		"https://attacker.example/jobs/detect-1",
		"//attacker.example/jobs/detect-1",
	} {
		t.Run(pollURL, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				writeAnalysisResponse(t, w, http.StatusOK, 0, "ok", map[string]any{
					"job_id": "detect-1", "status": "queued", "poll_url": pollURL,
				})
			}))
			defer server.Close()
			client, err := NewVideoAnalysisClient(server.URL, server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.SubmitDetectJob(context.Background(), DetectJobRequest{VideoPath: "/photos/movie.mp4"}); err == nil {
				t.Fatal("SubmitDetectJob should reject a cross-origin poll_url")
			}
		})
	}
}

func TestNewVideoAnalysisClientRejectsUnsafeBaseURL(t *testing.T) {
	for _, raw := range []string{"", "localhost:8910", "ftp://localhost:8910", "http://user:pass@localhost:8910"} {
		if _, err := NewVideoAnalysisClient(raw, "http://localhost:8911", nil); err == nil {
			t.Fatalf("NewVideoAnalysisClient(%q) should fail", raw)
		}
	}
}

func TestVideoAnalysisClientRejectsMalformedJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":0,"msg":"ok","data":`))
	}))
	defer server.Close()

	client, err := NewVideoAnalysisClient(server.URL, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.CheckSceneHealth(context.Background()); err == nil {
		t.Fatal("CheckSceneHealth should reject malformed JSON")
	}
}

func TestVideoAnalysisClientRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		// Exceed maxVideoAnalysisResponseBytes (4 MiB) with a single write.
		payload := make([]byte, maxVideoAnalysisResponseBytes+2)
		for i := range payload {
			payload[i] = 'x'
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	client, err := NewVideoAnalysisClient(server.URL, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.CheckSceneHealth(context.Background())
	if err == nil || !strings.Contains(err.Error(), "exceeds size limit") {
		t.Fatalf("error = %v, want size limit error", err)
	}
}

func TestVideoAnalysisClientSurfacesRequestTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(2 * time.Second):
			writeAnalysisResponse(t, w, http.StatusOK, 0, "ok", map[string]any{"status": "ok", "service": "scene"})
		}
	}))
	defer server.Close()

	httpClient := &http.Client{Timeout: 50 * time.Millisecond}
	client, err := NewVideoAnalysisClient(server.URL, server.URL, httpClient)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.CheckSceneHealth(context.Background())
	if err == nil {
		t.Fatal("CheckSceneHealth should surface request timeout")
	}
	if !errors.Is(err, context.DeadlineExceeded) && !strings.Contains(strings.ToLower(err.Error()), "timeout") && !strings.Contains(strings.ToLower(err.Error()), "deadline") {
		t.Fatalf("error = %v, want timeout/deadline error", err)
	}
}

func TestVideoAnalysisClientSetBaseURLs(t *testing.T) {
	client, err := NewVideoAnalysisClient("http://old-scene:8910", "http://old-structure:8911", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}

	if err := client.SetBaseURLs("http://new-scene:8910", "http://new-structure:8911"); err != nil {
		t.Fatal(err)
	}
	if got := client.sceneBase.Load().String(); got != "http://new-scene:8910" {
		t.Fatalf("scene base = %q, want %q", got, "http://new-scene:8910")
	}
	if got := client.structureBase.Load().String(); got != "http://new-structure:8911" {
		t.Fatalf("structure base = %q, want %q", got, "http://new-structure:8911")
	}
}

func TestVideoAnalysisClientSetBaseURLsRejectsInvalid(t *testing.T) {
	client, err := NewVideoAnalysisClient("http://old-scene:8910", "http://old-structure:8911", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}

	if err := client.SetBaseURLs("://bad", "http://ok:8911"); err == nil {
		t.Fatal("expected invalid scene URL error")
	}
	if got := client.sceneBase.Load().String(); got != "http://old-scene:8910" {
		t.Fatalf("scene base should remain unchanged, got %q", got)
	}
}

func writeAnalysisResponse(t *testing.T, w http.ResponseWriter, status, code int, message string, data any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]any{"code": code, "msg": message, "data": data}); err != nil {
		t.Fatal(err)
	}
}
