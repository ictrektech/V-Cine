package service

import (
	"context"
	"testing"
	"time"

	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/testutil"
)

var testCtx = context.Background()

func setupApiKeyService(t *testing.T) *ApiKeyService {
	t.Helper()
	db := testutil.NewTestDB(t)
	repos := repository.NewRepositories(db)
	svc := NewApiKeyService(repos.ApiKey, testLogger())
	return svc
}

func createTestUser(t *testing.T, svc *ApiKeyService) string {
	t.Helper()
	// 大部分测试只关心 userID 隔离，不需要完整的用户记录，
	// 直接在连接上下文使用一个唯一 userID
	return "test-user-" + t.Name()
}

// ────────────────────────────── Create ──────────────────────────────

func TestApiKeyService_Create_Success(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	result, err := svc.Create(testCtx, userID, "测试 Key", nil)
	if err != nil {
		t.Fatalf("Create 失败: %v", err)
	}

	// 返回了原始 key
	if result.RawKey == "" {
		t.Fatal("RawKey 不应为空")
	}
	if len(result.RawKey) < 67 {
		t.Fatalf("RawKey 长度不足: %d", len(result.RawKey))
	}
	if result.RawKey[:3] != "nk_" {
		t.Fatalf("RawKey 前缀错误: %s", result.RawKey[:3])
	}

	// KeyPrefix = 前 11 位
	if result.KeyPrefix != result.RawKey[:11] {
		t.Errorf("KeyPrefix=%q 与 RawKey[:11]=%q 不一致", result.KeyPrefix, result.RawKey[:11])
	}

	// ID 已生成
	if result.ID == "" {
		t.Fatal("ID 不应为空")
	}

	// Name 一致
	if result.Name != "测试 Key" {
		t.Errorf("Name=%q, 期望 %q", result.Name, "测试 Key")
	}

	// 未撤销
	if result.IsRevoked {
		t.Error("新创建的 Key 不应为已撤销")
	}

	// CreatedAt 已设置
	if result.CreatedAt.IsZero() {
		t.Error("CreatedAt 不应为零值")
	}

	// Key 字段与 RawKey 一致（创建时相同）
	if result.Key != result.RawKey {
		t.Error("ApiKeyView.Key 应与 RawKey 一致")
	}
}

func TestApiKeyService_Create_WithExpiry(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	expiresAt := time.Now().Add(24 * time.Hour)
	result, err := svc.Create(testCtx, userID, "临时 Key", &expiresAt)
	if err != nil {
		t.Fatalf("Create 失败: %v", err)
	}

	if result.ExpiresAt == nil {
		t.Fatal("ExpiresAt 不应为 nil")
	}
	if !result.ExpiresAt.Equal(expiresAt) {
		t.Errorf("ExpiresAt=%v, 期望 %v", result.ExpiresAt, expiresAt)
	}
}

func TestApiKeyService_Create_UniquePerCall(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	r1, _ := svc.Create(testCtx, userID, "Key 1", nil)
	r2, _ := svc.Create(testCtx, userID, "Key 2", nil)

	if r1.RawKey == r2.RawKey {
		t.Error("两次创建的 RawKey 不应相同")
	}
	if r1.ID == r2.ID {
		t.Error("两次创建的 ID 不应相同")
	}
}

// ────────────────────────────── Validate ──────────────────────────────

func TestApiKeyService_Validate_ValidKey(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	created, err := svc.Create(testCtx, userID, "测试 Key", nil)
	if err != nil {
		t.Fatalf("Create 失败: %v", err)
	}

	gotUserID, err := svc.Validate(testCtx, created.RawKey)
	if err != nil {
		t.Fatalf("Validate 失败: %v", err)
	}
	if gotUserID != userID {
		t.Errorf("Validate 返回 userID=%q, 期望 %q", gotUserID, userID)
	}
}

func TestApiKeyService_Validate_InvalidFormat(t *testing.T) {
	svc := setupApiKeyService(t)

	_, err := svc.Validate(testCtx, "too-short")
	if err == nil {
		t.Fatal("过短 key 应返回错误")
	}

	_, err = svc.Validate(testCtx, "nk_too_short")
	if err == nil {
		t.Fatal("nk_ 前缀但过短也应返回错误")
	}

	_, err = svc.Validate(testCtx, "")
	if err == nil {
		t.Fatal("空 key 应返回错误")
	}
}

func TestApiKeyService_Validate_NonExistentKey(t *testing.T) {
	svc := setupApiKeyService(t)

	// 有效格式但数据库不存在的 key
	_, err := svc.Validate(testCtx, "nk_0000000000000000000000000000000000000000000000000000000000000000")
	if err == nil {
		t.Fatal("不存在的 key 应返回错误")
	}
}

func TestApiKeyService_Validate_RevokedKey(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	created, _ := svc.Create(testCtx, userID, "待撤销 Key", nil)

	// 撤销
	if err := svc.Revoke(testCtx, created.ID, userID); err != nil {
		t.Fatalf("Revoke 失败: %v", err)
	}

	// 验证应失败
	_, err := svc.Validate(testCtx, created.RawKey)
	if err == nil {
		t.Fatal("已撤销的 Key 应验证失败")
	}
}

func TestApiKeyService_Validate_ExpiredKey(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	// 过期时间设置为过去
	past := time.Now().Add(-1 * time.Hour)
	created, err := svc.Create(testCtx, userID, "已过期 Key", &past)
	if err != nil {
		t.Fatalf("Create 失败: %v", err)
	}

	_, err = svc.Validate(testCtx, created.RawKey)
	if err == nil {
		t.Fatal("已过期的 Key 应验证失败")
	}
}

func TestApiKeyService_Validate_NotExpiredKey(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	future := time.Now().Add(24 * time.Hour)
	created, _ := svc.Create(testCtx, userID, "未过期 Key", &future)

	_, err := svc.Validate(testCtx, created.RawKey)
	if err != nil {
		t.Fatalf("未过期的 Key 验证应成功: %v", err)
	}
}

func TestApiKeyService_Validate_TouchesLastUsedAt(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	created, _ := svc.Create(testCtx, userID, "测试 Key", nil)

	// 验证前 LastUsedAt 应为 nil
	if created.LastUsedAt != nil {
		t.Fatal("新创建 Key 的 LastUsedAt 应为 nil")
	}

	// 验证（触发异步 TouchLastUsed）
	_, err := svc.Validate(testCtx, created.RawKey)
	if err != nil {
		t.Fatalf("Validate 失败: %v", err)
	}

	// 等待异步 goroutine 完成
	time.Sleep(100 * time.Millisecond)

	// 通过 ListByUser 检查 LastUsedAt 已更新
	keys, err := svc.ListByUser(testCtx, userID)
	if err != nil {
		t.Fatalf("ListByUser 失败: %v", err)
	}
	var updated bool
	for _, k := range keys {
		if k.ID == created.ID {
			if k.LastUsedAt != nil {
				updated = true
			}
			break
		}
	}
	if !updated {
		t.Error("Validate 后 LastUsedAt 应被更新")
	}
}

// ────────────────────────────── ListByUser ──────────────────────────────

func TestApiKeyService_ListByUser_Empty(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	keys, err := svc.ListByUser(testCtx, userID)
	if err != nil {
		t.Fatalf("ListByUser 失败: %v", err)
	}
	if len(keys) != 0 {
		t.Errorf("新用户应有 0 条 Key，实际 %d", len(keys))
	}
}

func TestApiKeyService_ListByUser_AfterCreate(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	svc.Create(testCtx, userID, "Key 1", nil)
	svc.Create(testCtx, userID, "Key 2", nil)

	keys, err := svc.ListByUser(testCtx, userID)
	if err != nil {
		t.Fatalf("ListByUser 失败: %v", err)
	}
	if len(keys) != 2 {
		t.Errorf("应有 2 条 Key，实际 %d", len(keys))
	}

	// 按创建时间倒序（最新的在前）
	if len(keys) >= 2 {
		if keys[0].CreatedAt.Before(keys[1].CreatedAt) {
			t.Error("列表应按创建时间倒序")
		}
	}
}

func TestApiKeyService_ListByUser_IncludesRevoked(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	r1, _ := svc.Create(testCtx, userID, "待撤销 Key", nil)
	svc.Revoke(testCtx, r1.ID, userID)

	keys, _ := svc.ListByUser(testCtx, userID)
	if len(keys) != 1 {
		t.Fatalf("应有 1 条 Key（含已撤销），实际 %d", len(keys))
	}
	if !keys[0].IsRevoked {
		t.Error("已撤销 Key 的 IsRevoked 应为 true")
	}
}

func TestApiKeyService_ListByUser_KeyDecrypted(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	created, _ := svc.Create(testCtx, userID, "测试 Key", nil)

	keys, _ := svc.ListByUser(testCtx, userID)
	if len(keys) == 0 {
		t.Fatal("列表不应为空")
	}
	if keys[0].Key == "" {
		t.Fatal("返回的 Key 字段应为解密后的明文，不应为空")
	}
	if keys[0].Key != created.RawKey {
		t.Error("ListByUser 返回的 Key 应与创建时的 RawKey 一致")
	}
}

func TestApiKeyService_ListByUser_UserIsolation(t *testing.T) {
	svc := setupApiKeyService(t)
	userA := "user-a"
	userB := "user-b"

	svc.Create(testCtx, userA, "A 的 Key", nil)
	svc.Create(testCtx, userB, "B 的 Key", nil)

	keysA, _ := svc.ListByUser(testCtx, userA)
	keysB, _ := svc.ListByUser(testCtx, userB)

	if len(keysA) != 1 {
		t.Errorf("UserA 应有 1 条 Key，实际 %d", len(keysA))
	}
	if len(keysB) != 1 {
		t.Errorf("UserB 应有 1 条 Key，实际 %d", len(keysB))
	}
}

// ────────────────────────────── Revoke ──────────────────────────────

func TestApiKeyService_Revoke_Success(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	created, _ := svc.Create(testCtx, userID, "待撤销 Key", nil)

	if err := svc.Revoke(testCtx, created.ID, userID); err != nil {
		t.Fatalf("Revoke 失败: %v", err)
	}

	// 验证状态
	keys, _ := svc.ListByUser(testCtx, userID)
	for _, k := range keys {
		if k.ID == created.ID {
			if !k.IsRevoked {
				t.Error("Revoke 后 IsRevoked 应为 true")
			}
			return
		}
	}
	t.Error("撤销后列表仍应包含该 Key")
}

func TestApiKeyService_Revoke_WrongUser(t *testing.T) {
	svc := setupApiKeyService(t)

	created, _ := svc.Create(testCtx, "owner", "测试 Key", nil)

	// 其他用户撤销应失败
	err := svc.Revoke(testCtx, created.ID, "attacker")
	if err == nil {
		t.Fatal("非归属用户撤销应返回错误")
	}

	// Key 依然有效
	_, err = svc.Validate(testCtx, created.RawKey)
	if err != nil {
		t.Fatal("其他用户撤销失败后，Key 应仍然有效")
	}
}

func TestApiKeyService_Revoke_NonExistentKey(t *testing.T) {
	svc := setupApiKeyService(t)

	err := svc.Revoke(testCtx, "non-existent-id", "user")
	if err == nil {
		t.Error("不存在的 Key 撤销应返回错误")
	}
}

// ────────────────────────────── Delete ──────────────────────────────

func TestApiKeyService_Delete_Success(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	created, _ := svc.Create(testCtx, userID, "待删除 Key", nil)

	if err := svc.Delete(testCtx, created.ID, userID); err != nil {
		t.Fatalf("Delete 失败: %v", err)
	}

	// 列表中不再包含
	keys, _ := svc.ListByUser(testCtx, userID)
	for _, k := range keys {
		if k.ID == created.ID {
			t.Fatal("删除后的 Key 不应出现在列表中")
		}
	}

	// 验证失败
	_, err := svc.Validate(testCtx, created.RawKey)
	if err == nil {
		t.Fatal("删除后的 Key 应验证失败")
	}
}

func TestApiKeyService_Delete_WrongUser(t *testing.T) {
	svc := setupApiKeyService(t)

	created, _ := svc.Create(testCtx, "owner", "测试 Key", nil)

	// 其他用户删除应失败
	err := svc.Delete(testCtx, created.ID, "attacker")
	if err == nil {
		t.Fatal("非归属用户删除应返回错误")
	}

	// Key 依然有效
	_, err = svc.Validate(testCtx, created.RawKey)
	if err != nil {
		t.Fatal("其他用户删除失败后，Key 应仍然有效")
	}
}

// ────────────────────────────── 组合场景 ──────────────────────────────

func TestApiKeyService_FullLifecycle(t *testing.T) {
	svc := setupApiKeyService(t)
	userID := createTestUser(t, svc)

	// 1. Create
	created, err := svc.Create(testCtx, userID, "全生命周期 Key", nil)
	if err != nil {
		t.Fatalf("Create 失败: %v", err)
	}

	// 2. Validate
	uid, err := svc.Validate(testCtx, created.RawKey)
	if err != nil {
		t.Fatalf("Validate 失败: %v", err)
	}
	if uid != userID {
		t.Fatalf("userID 不匹配: %s != %s", uid, userID)
	}

	// 3. Revoke
	if err := svc.Revoke(testCtx, created.ID, userID); err != nil {
		t.Fatalf("Revoke 失败: %v", err)
	}

	// 4. Validate after revoke → fail
	if _, err := svc.Validate(testCtx, created.RawKey); err == nil {
		t.Fatal("撤销后 Validate 应失败")
	}

	// 5. Delete
	if err := svc.Delete(testCtx, created.ID, userID); err != nil {
		t.Fatalf("Delete 失败: %v", err)
	}

	// 6. List → empty
	keys, _ := svc.ListByUser(testCtx, userID)
	for _, k := range keys {
		if k.ID == created.ID {
			t.Fatal("删除后 Key 不应出现在列表中")
		}
	}
}
