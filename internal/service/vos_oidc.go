package service

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/nowen-video/nowen-video/internal/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type vosClaims struct {
	Subject, Username string
	Admin             bool
	ExpiresAt         time.Time
}

// VOS accessToken 内存存留：AI 调 V-Router 时转发做用量归属（Bearer <vos-token>）。
// 仅内存不落盘；全局单例存最近一次登录者的 token（多用户下用量归集到该用户）。
var (
	vosTokenMu      sync.Mutex
	lastVOSToken    string
	lastVOSTokenExp time.Time
)

// StoreVOSAccessToken 在 VOS OIDC 登录成功后记录 accessToken（仅内存）。
// exp 为 VOS token 的真实过期时间（从 JWT claims 提取）。
func StoreVOSAccessToken(token string, exp time.Time) {
	vosTokenMu.Lock()
	defer vosTokenMu.Unlock()
	lastVOSToken = token
	lastVOSTokenExp = exp
}

// LatestVOSAccessToken 返回最近一次 VOS 登录的 accessToken（空表示不可用）。
// 已过 VOS exp 时返回空——网关会拒绝过期 token。
func LatestVOSAccessToken() string {
	vosTokenMu.Lock()
	defer vosTokenMu.Unlock()
	if lastVOSToken == "" || time.Now().After(lastVOSTokenExp) {
		return ""
	}
	return lastVOSToken
}

type vosJWKSet struct {
	Keys []struct {
		KID string `json:"kid"`
		KTY string `json:"kty"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

// LoginWithVOSOIDC validates an RS256 VOS access token and issues a local session.
func (s *AuthService) LoginWithVOSOIDC(token, ip, ua string) (*TokenResponse, error) {
	if !s.cfg.VOSOIDC.Enabled {
		return nil, errors.New("VOS OIDC is disabled")
	}
	claims, err := s.verifyVOSOIDC(token)
	if err != nil {
		return nil, err
	}
	user, err := s.userRepo.FindByVOSSubject(claims.Subject)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if existing, findErr := s.userRepo.FindByUsername(claims.Username); findErr == nil {
			// VOS has already verified the immutable subject.  Bind a legacy
			// local account with the same username so upgrading to VOS SSO does
			// not strand the default admin (or an existing user) at the login page.
			if existing.VOSSubject != nil && *existing.VOSSubject != claims.Subject {
				return nil, ErrVOSIdentityConflict
			}
			subject := claims.Subject
			if err := s.userRepo.UpdateFields(existing.ID, map[string]interface{}{"vos_subject": subject}); err != nil {
				return nil, err
			}
			existing.VOSSubject = &subject
			user = existing
		} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return nil, findErr
		} else {
			password, err := randomPasswordHash()
			if err != nil {
				return nil, err
			}
			role := "user"
			if claims.Admin {
				role = "admin"
			}
			subject := claims.Subject
			user = &model.User{Username: claims.Username, Password: password, Role: role, VOSSubject: &subject}
			if err := s.userRepo.Create(user); err != nil {
				return nil, err
			}
		}
	} else if err != nil {
		return nil, err
	}
	if user.Disabled {
		return nil, ErrUserDisabled
	}
	role := "user"
	if claims.Admin {
		role = "admin"
	}
	updates := map[string]interface{}{}
	if user.Role != role {
		updates["role"] = role
	}
	// VOS is the credential authority for this session.  Legacy local-password
	// onboarding must never force a VOS user to set or know a V-Cine password.
	if user.MustChangePwd {
		updates["must_change_pwd"] = false
	}
	if len(updates) > 0 {
		if err := s.userRepo.UpdateFields(user.ID, updates); err != nil {
			return nil, err
		}
		if err := s.userRepo.IncrTokenVersion(user.ID); err != nil {
			return nil, err
		}
		user.Role = role
		user.MustChangePwd = false
		user.TokenVersion++
	}
	_ = s.userRepo.UpdateLastLogin(user.ID, ip)
	s.recordLogin(user.ID, user.Username, ip, ua, "vos_oidc", true)
	// 登录成功后保留 accessToken（仅内存），供 AI 调 V-Router 时转发用量归属
	StoreVOSAccessToken(token, claims.ExpiresAt)
	return s.generateToken(user)
}

func randomPasswordHash() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(hex.EncodeToString(b)), bcrypt.DefaultCost)
	return string(hash), err
}

func (s *AuthService) verifyVOSOIDC(raw string) (*vosClaims, error) {
	keys, err := s.fetchVOSJWKS(false)
	if err != nil {
		return nil, err
	}
	claims, err := s.parseVOSJWT(raw, keys)
	if err != nil && errors.Is(err, errUnknownVOSSigningKey) {
		keys, err = s.fetchVOSJWKS(true)
		if err != nil {
			return nil, err
		}
		claims, err = s.parseVOSJWT(raw, keys)
	}
	if err != nil {
		return nil, err
	}
	return claims, nil
}

var errUnknownVOSSigningKey = errors.New("unknown VOS signing key")

func (s *AuthService) parseVOSJWT(raw string, keys map[string]*rsa.PublicKey) (*vosClaims, error) {
	claims := jwt.MapClaims{}
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}), jwt.WithIssuer(s.cfg.VOSOIDC.Issuer), jwt.WithAudience(s.cfg.VOSOIDC.ClientID))
	_, err := parser.ParseWithClaims(raw, claims, func(token *jwt.Token) (interface{}, error) {
		kid, _ := token.Header["kid"].(string)
		key := keys[kid]
		if key == nil {
			return nil, errUnknownVOSSigningKey
		}
		return key, nil
	})
	if err != nil {
		return nil, err
	}
	sub, _ := claims["sub"].(string)
	username, _ := claims["username"].(string)
	username = normalizeVOSUsername(username)
	if sub == "" || username == "" {
		return nil, errors.New("VOS token missing sub or username")
	}
	admin := claims["role_code"] == "system_admin"
	if roles, ok := claims["roles"].([]interface{}); ok {
		for _, r := range roles {
			if r == "system_admin" {
				admin = true
			}
		}
	}
	var expiresAt time.Time
	if exp, ok := claims["exp"].(float64); ok {
		expiresAt = time.Unix(int64(exp), 0)
	}
	return &vosClaims{Subject: sub, Username: username, Admin: admin, ExpiresAt: expiresAt}, nil
}

func (s *AuthService) fetchVOSJWKS(force bool) (map[string]*rsa.PublicKey, error) {
	s.vosJWKSMu.Lock()
	defer s.vosJWKSMu.Unlock()
	if !force && time.Now().Before(s.vosJWKSExp) && len(s.vosJWKS) > 0 {
		return s.vosJWKS, nil
	}
	resp, err := (&http.Client{Timeout: 8 * time.Second}).Get(s.cfg.VOSOIDC.JWKSURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("VOS JWKS status %d", resp.StatusCode)
	}
	var set vosJWKSet
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return nil, err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, jwk := range set.Keys {
		if jwk.KTY != "RSA" || jwk.KID == "" {
			continue
		}
		nb, err := base64.RawURLEncoding.DecodeString(jwk.N)
		if err != nil {
			continue
		}
		eb, err := base64.RawURLEncoding.DecodeString(jwk.E)
		if err != nil {
			continue
		}
		e := 0
		for _, b := range eb {
			e = e<<8 + int(b)
		}
		if e > 0 {
			keys[jwk.KID] = &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: e}
		}
	}
	if len(keys) == 0 {
		return nil, errors.New("VOS JWKS contains no RSA keys")
	}
	s.vosJWKS = keys
	s.vosJWKSExp = time.Now().Add(time.Hour)
	return s.vosJWKS, nil
}

func normalizeVOSUsername(username string) string { return strings.TrimSpace(username) }
