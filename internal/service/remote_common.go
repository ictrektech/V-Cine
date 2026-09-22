package service

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ==================== 远程存储公共逻辑 ====================
//
// WebDAV / Alist / S3 都通过 VFS 接口暴露给上层；这里放它们可以复用的
// 元数据缓存、递归遍历和带块缓存的 ReadAt，避免三份近似实现。

// metadataCache 远程 FS 共用的元数据缓存（Stat / ReadDir / 字符串 URL）。
type metadataCache struct {
	mu          sync.RWMutex
	statCache   map[string]*cacheEntry
	dirCache    map[string]*cacheEntry
	stringCache map[string]*cacheEntry
	enabled     bool
	ttl         time.Duration
}

func newMetadataCache(enabled bool, ttl time.Duration) *metadataCache {
	return &metadataCache{
		statCache:   make(map[string]*cacheEntry),
		dirCache:    make(map[string]*cacheEntry),
		stringCache: make(map[string]*cacheEntry),
		enabled:     enabled,
		ttl:         ttl,
	}
}

func (c *metadataCache) getStat(key string) (fs.FileInfo, bool) {
	if !c.enabled {
		return nil, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if e, ok := c.statCache[key]; ok && time.Now().Before(e.expiresAt) {
		if info, ok := e.data.(fs.FileInfo); ok {
			return info, true
		}
	}
	return nil, false
}

func (c *metadataCache) setStat(key string, info fs.FileInfo) {
	if !c.enabled {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.statCache[key] = &cacheEntry{data: info, expiresAt: time.Now().Add(c.ttl)}
}

func (c *metadataCache) getDir(key string) ([]fs.DirEntry, bool) {
	if !c.enabled {
		return nil, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if e, ok := c.dirCache[key]; ok && time.Now().Before(e.expiresAt) {
		if entries, ok := e.data.([]fs.DirEntry); ok {
			return entries, true
		}
	}
	return nil, false
}

func (c *metadataCache) setDir(key string, entries []fs.DirEntry) {
	if !c.enabled {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.dirCache[key] = &cacheEntry{data: entries, expiresAt: time.Now().Add(c.ttl)}
}

func (c *metadataCache) getString(key string) (string, bool) {
	if !c.enabled {
		return "", false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if e, ok := c.stringCache[key]; ok && time.Now().Before(e.expiresAt) {
		if s, ok := e.data.(string); ok {
			return s, true
		}
	}
	return "", false
}

func (c *metadataCache) setString(key, value string, ttl time.Duration) {
	if !c.enabled {
		return
	}
	if ttl <= 0 {
		ttl = c.ttl
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.stringCache[key] = &cacheEntry{data: value, expiresAt: time.Now().Add(ttl)}
}

func (c *metadataCache) deleteString(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.stringCache, key)
}

func (c *metadataCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.statCache = make(map[string]*cacheEntry)
	c.dirCache = make(map[string]*cacheEntry)
	c.stringCache = make(map[string]*cacheEntry)
}

// walkRemote 基于 VFS 接口的通用递归遍历，三个远程 FS 共用。
func walkRemote(vfs VFS, root string, fn filepath.WalkFunc) error {
	if root == "" {
		root = "/"
	}
	stat, err := vfs.Stat(root)
	if err != nil {
		return fn(root, nil, err)
	}
	if err := fn(root, stat, nil); err != nil {
		if errors.Is(err, filepath.SkipDir) {
			return nil
		}
		return err
	}
	if !stat.IsDir() {
		return nil
	}
	entries, err := vfs.ReadDir(root)
	if err != nil {
		return fn(root, stat, err)
	}
	for _, e := range entries {
		child := path.Join(root, e.Name())
		if !strings.HasPrefix(child, "/") {
			child = "/" + child
		}
		if err := walkRemote(vfs, child, fn); err != nil && err != filepath.SkipDir {
			return err
		}
	}
	return nil
}

// readAtCached 远程文件共用的带块缓存 ReadAt。
// readAt 是“直连读一块”的函数；fileSize < 0 表示未知。
func readAtCached(cache *webdavBlockCache, fileSize int64, readAt func([]byte, int64) (int, error), p []byte, off int64) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if off < 0 {
		return 0, fmt.Errorf("ReadAt: negative offset")
	}
	if cache == nil {
		return readAt(p, off)
	}

	total := 0
	cur := off
	end := off + int64(len(p))
	blockSize := cache.blockSize

	for cur < end {
		blockOff := (cur / blockSize) * blockSize
		block, err := ensureBlock(cache, fileSize, readAt, blockOff)
		if err != nil {
			if total > 0 {
				if errors.Is(err, io.EOF) {
					return total, io.EOF
				}
				return total, err
			}
			return 0, err
		}
		inBlock := cur - block.offset
		if inBlock >= int64(len(block.data)) {
			if total > 0 {
				return total, io.EOF
			}
			return 0, io.EOF
		}
		n := copy(p[total:], block.data[inBlock:])
		total += n
		cur += int64(n)
		if int64(len(block.data)) < blockSize && cur >= block.offset+int64(len(block.data)) {
			if total < len(p) {
				return total, io.EOF
			}
		}
		if n == 0 {
			break
		}
	}
	if total < len(p) {
		return total, io.EOF
	}
	return total, nil
}

func ensureBlock(cache *webdavBlockCache, fileSize int64, readAt func([]byte, int64) (int, error), blockOff int64) (*webdavCacheBlock, error) {
	if b, ok := cache.get(blockOff); ok {
		return b, nil
	}
	if wait := cache.acquireFetch(blockOff); wait != nil {
		<-wait
		if b, ok := cache.get(blockOff); ok {
			return b, nil
		}
	}
	defer cache.releaseFetch(blockOff)

	readLen := cache.blockSize
	if fileSize >= 0 {
		if blockOff >= fileSize {
			return nil, io.EOF
		}
		if blockOff+readLen > fileSize {
			readLen = fileSize - blockOff
		}
	}
	data := make([]byte, readLen)
	n, err := readAt(data, blockOff)
	if err != nil && err != io.EOF {
		return nil, err
	}
	block := &webdavCacheBlock{offset: blockOff, data: data[:n]}
	cache.put(block)
	return block, nil
}
