package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	secretcrypto "github.com/nowen-video/nowen-video/internal/crypto"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
)

// ApiKeyService API Key 管理服务
type ApiKeyService struct {
	repo   *repository.ApiKeyRepo
	logger *zap.SugaredLogger
}

func NewApiKeyService(repo *repository.ApiKeyRepo, logger *zap.SugaredLogger) *ApiKeyService {
	return &ApiKeyService{repo: repo, logger: logger}
}

// ApiKeyView 返回给前端的 API Key 视图（包含解密后的完整 key）
type ApiKeyView struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	KeyPrefix  string     `json:"key_prefix"`
	Key        string     `json:"key"`          // 解密后的完整 key
	LastUsedAt *time.Time `json:"last_used_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	IsRevoked  bool       `json:"is_revoked"`
	CreatedAt  time.Time  `json:"created_at"`
}

// CreateResult 创建结果（包含原始 key，仅创建时返回）
type CreateResult struct {
	ApiKeyView
	RawKey string `json:"raw_key"` // 未加密的完整 key，仅创建时返回一次
}

// modelToView 将 model.ApiKey 转为前端视图（注入完整的明文 key）
func modelToView(k model.ApiKey, fullKey string) ApiKeyView {
	return ApiKeyView{
		ID:         k.ID,
		Name:       k.Name,
		KeyPrefix:  k.KeyPrefix,
		Key:        fullKey,
		LastUsedAt: k.LastUsedAt,
		ExpiresAt:  k.ExpiresAt,
		IsRevoked:  k.IsRevoked,
		CreatedAt:  k.CreatedAt,
	}
}

// Create 创建新 API Key
func (s *ApiKeyService) Create(ctx context.Context, userID, name string, expiresAt *time.Time) (*CreateResult, error) {
	// 生成随机 key
	rawBytes := make([]byte, 32)
	if _, err := rand.Read(rawBytes); err != nil {
		return nil, fmt.Errorf("generate api key: %w", err)
	}
	rawKey := "nk_" + hex.EncodeToString(rawBytes)

	// 派生字段
	hash := sha256.Sum256([]byte(rawKey))
	encrypted, err := secretcrypto.Encrypt(rawKey)
	if err != nil {
		return nil, fmt.Errorf("encrypt api key: %w", err)
	}

	key := &model.ApiKey{
		UserID:       userID,
		Name:         name,
		KeyPrefix:    rawKey[:11], // "nk_" + 前 8 位 hex
		KeySHA256:    hash[:],
		KeyEncrypted: encrypted,
		ExpiresAt:    expiresAt,
	}

	if err := s.repo.Create(ctx, key); err != nil {
		return nil, fmt.Errorf("save api key: %w", err)
	}

	return &CreateResult{
		ApiKeyView: modelToView(*key, rawKey),
		RawKey:     rawKey,
	}, nil
}

// Validate 验证 API Key，返回 userID
func (s *ApiKeyService) Validate(ctx context.Context, key string) (string, error) {
	if len(key) < 20 || key[:3] != "nk_" {
		return "", fmt.Errorf("invalid api key format")
	}

	hash := sha256.Sum256([]byte(key))
	record, err := s.repo.FindBySHA256(ctx, hash[:])
	if err != nil {
		return "", fmt.Errorf("api key not found or revoked")
	}

	// 异步更新 last_used_at（使用请求 context 的 detached 副本，避免请求结束后被取消）
	go func() {
		if err := s.repo.TouchLastUsed(context.WithoutCancel(ctx), record.ID); err != nil && s.logger != nil {
			s.logger.Warnw("Failed to update api key last_used_at", "key_id", record.ID, "error", err)
		}
	}()

	return record.UserID, nil
}

// ListByUser 列出用户的所有 Key（解密完整 key）
func (s *ApiKeyService) ListByUser(ctx context.Context, userID string) ([]ApiKeyView, error) {
	keys, err := s.repo.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	views := make([]ApiKeyView, 0, len(keys))
	for _, k := range keys {
		fullKey, _ := secretcrypto.Decrypt(k.KeyEncrypted) // 解密失败时 key 为空字符串
		views = append(views, modelToView(k, fullKey))
	}
	return views, nil
}

// Revoke 撤销 Key（软删除，保留记录，不可再用）
func (s *ApiKeyService) Revoke(ctx context.Context, id, userID string) error {
	return s.repo.Revoke(ctx, id, userID)
}

// Delete 物理删除 Key（彻底移除）
func (s *ApiKeyService) Delete(ctx context.Context, id, userID string) error {
	return s.repo.Delete(ctx, id, userID)
}
