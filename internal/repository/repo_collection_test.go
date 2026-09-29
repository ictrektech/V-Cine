package repository

import (
	"testing"

	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/testutil"
)

func setupCollectionRepo(t *testing.T) (*MovieCollectionRepo, *MediaRepo) {
	t.Helper()
	db := testutil.NewTestDB(t)
	return &MovieCollectionRepo{db: db}, &MediaRepo{db: db}
}

// 成员被删光时重算计数并删除空壳合集
func TestRecountAndPruneIfEmpty(t *testing.T) {
	collRepo, mediaRepo := setupCollectionRepo(t)

	coll := &model.MovieCollection{Name: "速度与激情"}
	if err := collRepo.Create(coll); err != nil {
		t.Fatal(err)
	}
	first := &model.Media{LibraryID: "lib-1", Title: "速度与激情", FilePath: "/tmp/1.mkv", CollectionID: coll.ID}
	second := &model.Media{LibraryID: "lib-1", Title: "速度与激情2", FilePath: "/tmp/2.mkv", CollectionID: coll.ID}
	for _, m := range []*model.Media{first, second} {
		if err := mediaRepo.Create(m); err != nil {
			t.Fatal(err)
		}
	}
	if err := collRepo.UpdateMediaCount(coll.ID); err != nil {
		t.Fatal(err)
	}
	got, err := collRepo.FindByID(coll.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.MediaCount != 2 {
		t.Fatalf("初始计数应为 2, got %d", got.MediaCount)
	}

	// 删掉一部：合集仍有成员，只降计数
	if err := mediaRepo.DeleteByID(first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := collRepo.RecountAndPruneIfEmpty(coll.ID); err != nil {
		t.Fatal(err)
	}
	got, err = collRepo.FindByID(coll.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.MediaCount != 1 {
		t.Fatalf("计数应降为 1, got %d", got.MediaCount)
	}

	// 删掉最后一部：空壳合集应被清掉
	if err := mediaRepo.DeleteByID(second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := collRepo.RecountAndPruneIfEmpty(coll.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := collRepo.FindByID(coll.ID); err == nil {
		t.Fatal("合集应已不存在")
	}
}
