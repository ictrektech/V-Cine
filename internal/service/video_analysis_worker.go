package service

import (
	"context"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
)

type VideoAnalysisWorker struct {
	service     *VideoAnalysisService
	tasks       *repository.VideoAnalysisTaskRepo
	logger      *zap.SugaredLogger
	workerCount int
	wake        chan struct{}
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

func NewVideoAnalysisWorker(service *VideoAnalysisService, tasks *repository.VideoAnalysisTaskRepo, logger *zap.SugaredLogger, workerCount int) *VideoAnalysisWorker {
	if workerCount < 1 {
		workerCount = 1
	}
	return &VideoAnalysisWorker{
		service: service, tasks: tasks, logger: logger, workerCount: workerCount,
		wake: make(chan struct{}, 1),
	}
}

func (w *VideoAnalysisWorker) Start() {
	if w == nil || w.service == nil || w.tasks == nil || w.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	w.cancel = cancel

	running, err := w.tasks.ListRunning()
	if err != nil {
		w.logError("load running video analysis tasks", err)
		running = nil
	}

	// Register every goroutine before any can race with Stop/Wait. Persisted
	// running tasks recover independently while queue workers can accept new work.
	w.wg.Add(w.workerCount + len(running))
	executionSlots := make(chan struct{}, w.workerCount)
	for i := 0; i < w.workerCount; i++ {
		go w.run(ctx, executionSlots)
	}
	for i := range running {
		go w.resume(ctx, running[i].ID, executionSlots)
	}
	w.Notify()
}

func (w *VideoAnalysisWorker) Stop() {
	if w == nil || w.cancel == nil {
		return
	}
	w.cancel()
	w.wg.Wait()
	w.cancel = nil
}

func (w *VideoAnalysisWorker) Notify() {
	if w == nil {
		return
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *VideoAnalysisWorker) resume(ctx context.Context, taskID string, slots chan struct{}) {
	defer w.wg.Done()
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	case <-ctx.Done():
		return
	}
	if err := w.service.ResumeRunningTask(ctx, taskID); err != nil && ctx.Err() == nil {
		w.logError("resume video analysis task "+taskID, err)
	}
}

func (w *VideoAnalysisWorker) run(ctx context.Context, slots chan struct{}) {
	defer w.wg.Done()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if err := w.drain(ctx, slots); err != nil {
			w.logError("process video analysis queue", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-w.wake:
		case <-ticker.C:
		}
	}
}

func (w *VideoAnalysisWorker) drain(ctx context.Context, slots chan struct{}) error {
	for {
		tasks, err := w.tasks.ListPending(1)
		if err != nil || len(tasks) == 0 {
			return err
		}
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			return ctx.Err()
		}
		err = w.service.ProcessTask(ctx, tasks[0].ID)
		<-slots
		if err != nil && ctx.Err() == nil {
			w.logError("process video analysis task "+tasks[0].ID, err)
		}
	}
}

func (w *VideoAnalysisWorker) logError(message string, err error) {
	if w.logger != nil {
		w.logger.Errorf("%s: %v", message, err)
	}
}
