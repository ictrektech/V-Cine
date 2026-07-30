package repository

import (
	"context"
	"time"

	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/gorm"
)

// ApiKeyRepo API Key 数据仓库
type ApiKeyRepo struct {
	db *gorm.DB
}

func NewApiKeyRepo(db *gorm.DB) *ApiKeyRepo {
	return &ApiKeyRepo{db: db}
}

// Create 插入一条 API Key
func (r *ApiKeyRepo) Create(ctx context.Context, key *model.ApiKey) error {
	return r.db.WithContext(ctx).Create(key).Error
}

// FindBySHA256 通过 SHA-256 查找活跃（未撤销、未过期）的 Key
func (r *ApiKeyRepo) FindBySHA256(ctx context.Context, hash []byte) (*model.ApiKey, error) {
	var key model.ApiKey
	err := r.db.WithContext(ctx).
		Where("key_sha256 = ? AND is_revoked = ? AND (expires_at IS NULL OR expires_at > ?)", hash, false, time.Now()).
		First(&key).Error
	if err != nil {
		return nil, err
	}
	return &key, nil
}

// ListByUser 列出用户的所有 Key（按创建时间倒序）
func (r *ApiKeyRepo) ListByUser(ctx context.Context, userID string) ([]model.ApiKey, error) {
	var keys []model.ApiKey
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&keys).Error
	return keys, err
}

// Revoke 撤销一条 Key（软删除，校验归属）
func (r *ApiKeyRepo) Revoke(ctx context.Context, id, userID string) error {
	return r.db.WithContext(ctx).
		Model(&model.ApiKey{}).
		Where("id = ? AND user_id = ?", id, userID).
		Update("is_revoked", true).Error
}

// Delete 物理删除一条 Key（校验归属）
func (r *ApiKeyRepo) Delete(ctx context.Context, id, userID string) error {
	return r.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		Delete(&model.ApiKey{}).Error
}

// TouchLastUsed 更新最近使用时间
func (r *ApiKeyRepo) TouchLastUsed(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).
		Model(&model.ApiKey{}).
		Where("id = ?", id).
		Update("last_used_at", time.Now()).Error
}
