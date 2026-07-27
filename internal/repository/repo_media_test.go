package repository

import (
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/model"

	"github.com/nowen-video/nowen-video/internal/testutil")

func setupMediaRepo(t *testing.T) *MediaRepo {
	t.Helper()
	db := testutil.NewTestDB(t)
	if err := db.AutoMigrate(&model.Media{}); err != nil {
		t.Fatal(err)
	}
	return &MediaRepo{db: db}
}

func TestMediaRepoListByLibraryCreatedSince(t *testing.T) {
	repo := setupMediaRepo(t)
	oldMedia := &model.Media{LibraryID: "library-1", Title: "Old", FilePath: "/tmp/old.mp4"}
	if err := repo.Create(oldMedia); err != nil {
		t.Fatal(err)
	}
	since := time.Now()
	time.Sleep(10 * time.Millisecond)
	newMedia := &model.Media{LibraryID: "library-1", Title: "New", FilePath: "/tmp/new.mp4"}
	if err := repo.Create(newMedia); err != nil {
		t.Fatal(err)
	}
	otherLibrary := &model.Media{LibraryID: "library-2", Title: "Other", FilePath: "/tmp/other.mp4"}
	if err := repo.Create(otherLibrary); err != nil {
		t.Fatal(err)
	}

	list, err := repo.ListByLibraryCreatedSince("library-1", since)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("list len = %d, want 1", len(list))
	}
	if list[0].ID != newMedia.ID {
		t.Fatalf("media id = %q, want %q", list[0].ID, newMedia.ID)
	}
}
