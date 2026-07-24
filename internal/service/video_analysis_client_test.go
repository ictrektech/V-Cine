package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
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

func writeAnalysisResponse(t *testing.T, w http.ResponseWriter, status, code int, message string, data any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]any{"code": code, "msg": message, "data": data}); err != nil {
		t.Fatal(err)
	}
}
