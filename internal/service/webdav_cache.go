package service

import (
	"container/list"
	"sync"
)

// ==================== WebDAV 自适应块缓存（LRU） ====================
//
// 背景：每次 player seek 都触发一次独立的 HTTP Range 请求，往返延迟叠加。
// 方案：按固定块大小（8MB）缓存最近访问的数据块，相邻区间的读取可直接命中缓存。
//
// 典型命中场景：
//   - 播放器 demuxer 连续读取多个相邻小块（MP4 box、MKV cluster）
//   - 音频/视频/字幕轨道交织在同一时间窗口
//   - seek 后的短距离"回看/前探"
//
// 参数选择：
//   - BlockSize = 8MB：足够覆盖一个 HLS 分片常见大小，也不会浪费太多带宽
//   - MaxBlocks = 4：每个文件最多占用 32MB 内存，支持中等规模并发
//   - 上层调用者可通过 WebDAVCacheBlockSize/WebDAVCacheBlockCount 调整（见 config）

const (
	defaultWebDAVBlockSize  int64 = 8 * 1024 * 1024 // 8 MiB
	defaultWebDAVBlockCount       = 4               // 每文件最多 4 块
)

// webdavCacheBlock 一个缓存块
type webdavCacheBlock struct {
	offset int64  // 块起始偏移（按 blockSize 对齐）
	data   []byte // 真实数据（长度可能小于 blockSize，最后一块不满时）
}

// webdavBlockCache 单文件的 LRU 块缓存
//
// 所有方法线程安全，使用 container/list 实现 O(1) LRU。
type webdavBlockCache struct {
	mu         sync.Mutex
	blockSize  int64
	maxBlocks  int
	lru        *list.List              // 双向链表：front=最近使用
	index      map[int64]*list.Element // offset → 链表节点
	fetchGroup map[int64]chan struct{} // 防止同一块并发发起多次 Range
	fetchMu    sync.Mutex
}

// newWebDAVBlockCache 创建块缓存
func newWebDAVBlockCache(blockSize int64, maxBlocks int) *webdavBlockCache {
	if blockSize <= 0 {
		blockSize = defaultWebDAVBlockSize
	}
	if maxBlocks <= 0 {
		maxBlocks = defaultWebDAVBlockCount
	}
	return &webdavBlockCache{
		blockSize:  blockSize,
		maxBlocks:  maxBlocks,
		lru:        list.New(),
		index:      make(map[int64]*list.Element),
		fetchGroup: make(map[int64]chan struct{}),
	}
}

// get 查询缓存块；命中返回数据（可直接使用，调用方无需复制）
func (c *webdavBlockCache) get(offset int64) (*webdavCacheBlock, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.index[offset]; ok {
		c.lru.MoveToFront(el)
		return el.Value.(*webdavCacheBlock), true
	}
	return nil, false
}

// put 放入缓存块（淘汰最旧块）
func (c *webdavBlockCache) put(block *webdavCacheBlock) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if el, ok := c.index[block.offset]; ok {
		el.Value = block
		c.lru.MoveToFront(el)
		return
	}

	el := c.lru.PushFront(block)
	c.index[block.offset] = el

	// 淘汰最旧
	for c.lru.Len() > c.maxBlocks {
		oldest := c.lru.Back()
		if oldest == nil {
			break
		}
		c.lru.Remove(oldest)
		b := oldest.Value.(*webdavCacheBlock)
		delete(c.index, b.offset)
	}
}

// clear 清空缓存（例如文件关闭时）
func (c *webdavBlockCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lru.Init()
	c.index = make(map[int64]*list.Element)
}

// acquireFetch 获取某块的"独占获取权"；避免多 goroutine 对同一块发起重复 Range
// 返回值：
//   - wait == nil: 当前 goroutine 负责下载，下载完成后必须调用 releaseFetch
//   - wait != nil: 已有其他 goroutine 在下载，读取者应 wait 然后重查缓存
func (c *webdavBlockCache) acquireFetch(offset int64) (wait <-chan struct{}) {
	c.fetchMu.Lock()
	defer c.fetchMu.Unlock()

	if ch, ok := c.fetchGroup[offset]; ok {
		return ch
	}
	ch := make(chan struct{})
	c.fetchGroup[offset] = ch
	return nil
}

// releaseFetch 释放获取权并唤醒所有等待者
func (c *webdavBlockCache) releaseFetch(offset int64) {
	c.fetchMu.Lock()
	ch, ok := c.fetchGroup[offset]
	if ok {
		delete(c.fetchGroup, offset)
	}
	c.fetchMu.Unlock()
	if ok {
		close(ch)
	}
}

// ==================== 缓存化 ReadAt ====================
//
// 块缓存读取的通用实现位于 remote_common.go 的 readAtCached / ensureBlock，
// WebDAV / Alist / S3 三个文件实现共用，不再各自维护一份。
