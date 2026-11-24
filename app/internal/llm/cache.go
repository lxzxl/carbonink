package llm

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	fileCacheVersion  = 1
	fileCacheMaxBytes = 100 << 20
	maxInlinePayload  = 256
)

// CacheStats reports the entries and total blob bytes on disk.
type CacheStats struct {
	Count int64
	Bytes int64
}

type cacheEntry struct {
	Key       string `json:"key"`
	File      string `json:"file"`
	ExpiresAt int64  `json:"expiresAt"`
	LastHit   int64  `json:"lastHit"`
	Size      int64  `json:"size"`
}

type cacheIndex struct {
	Version int                   `json:"version"`
	Entries map[string]cacheEntry `json:"entries"`
}

// FileCache is a thread-safe, file-backed deterministic-result cache for LLM
// calls, mirroring 1.x's LlmCache layout (<dir>/index.json + <sha256>.json).
type FileCache struct {
	mu        sync.Mutex
	dir       string
	indexPath string
	entries   map[string]cacheEntry
	loaded    bool
}

// NewFileCache returns a FileCache backed by dir.
func NewFileCache(dir string) *FileCache {
	return &FileCache{
		dir:       dir,
		indexPath: filepath.Join(dir, "index.json"),
		entries:   map[string]cacheEntry{},
	}
}

// BuildCacheKey builds a deterministic semantic cache key matching 1.x's
// buildCacheKey format. Payloads longer than 256 bytes are hashed so index.json
// never stores prompt content.
func BuildCacheKey(scope, provider, model, promptVersion, datasetVersion, inventoryHash string,
	payload any) string {
	encoded, err := json.Marshal(payload)
	if err != nil {
		encoded = []byte("null")
	}
	payloadPart := string(encoded)
	if len(payloadPart) > maxInlinePayload {
		payloadPart = SHA256Hex(encoded)
	}
	if datasetVersion == "" {
		datasetVersion = "-"
	}
	if inventoryHash == "" {
		inventoryHash = "-"
	}
	return strings.Join([]string{
		scope, provider, model, promptVersion, datasetVersion, inventoryHash, payloadPart,
	}, "|")
}

// SHA256Hex returns the lowercase hex SHA-256 digest of data.
func SHA256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// Get decodes a cached JSON value into dst if present, unexpired, and valid.
func (c *FileCache) Get(key string, dst any) bool {
	if c == nil || key == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ensureLoadedLocked()

	hash := SHA256Hex([]byte(key))
	entry, ok := c.entries[hash]
	if !ok {
		return false
	}
	now := time.Now().UnixMilli()
	if entry.ExpiresAt <= now {
		c.removeLocked(hash)
		c.saveIndexLocked()
		return false
	}
	data, err := os.ReadFile(filepath.Join(c.dir, entry.File))
	if err != nil {
		c.removeLocked(hash)
		c.saveIndexLocked()
		return false
	}
	if err := json.Unmarshal(data, dst); err != nil {
		c.removeLocked(hash)
		c.saveIndexLocked()
		return false
	}
	entry.LastHit = now
	c.entries[hash] = entry
	c.saveIndexLocked()
	return true
}

// Set stores value under key for ttl, enforcing the 100 MB LRU cap.
func (c *FileCache) Set(key string, value any, ttl time.Duration) error {
	if c == nil || key == "" || ttl <= 0 {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if int64(len(raw)) > fileCacheMaxBytes {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ensureLoadedLocked()

	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return err
	}
	hash := SHA256Hex([]byte(key))
	file := hash + ".json"
	if err := writeAtomic(filepath.Join(c.dir, file), raw); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	c.entries[hash] = cacheEntry{
		Key:       key,
		File:      file,
		ExpiresAt: now + ttl.Milliseconds(),
		LastHit:   now,
		Size:      int64(len(raw)),
	}
	c.evictExpiredAndOverBudgetLocked(now)
	return c.saveIndexLocked()
}

// Stats returns the number of unexpired entries and total bytes on disk.
func (c *FileCache) Stats() CacheStats {
	if c == nil {
		return CacheStats{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ensureLoadedLocked()
	now := time.Now().UnixMilli()
	var st CacheStats
	for _, entry := range c.entries {
		if entry.ExpiresAt <= now {
			continue
		}
		st.Count++
		st.Bytes += entry.Size
	}
	return st
}

// Clear removes every cached blob and resets the index, returning what was removed.
func (c *FileCache) Clear() (int64, int64, error) {
	if c == nil {
		return 0, 0, nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ensureLoadedLocked()

	var count, bytes int64
	for _, entry := range c.entries {
		count++
		bytes += entry.Size
		_ = os.Remove(filepath.Join(c.dir, entry.File))
	}
	c.entries = map[string]cacheEntry{}
	if _, err := os.Stat(c.dir); err == nil {
		entries, err := os.ReadDir(c.dir)
		if err == nil {
			for _, item := range entries {
				if !item.IsDir() && strings.HasSuffix(item.Name(), ".json") {
					_ = os.Remove(filepath.Join(c.dir, item.Name()))
				}
			}
		}
	}
	c.loaded = true
	return count, bytes, nil
}

func (c *FileCache) ensureLoadedLocked() {
	if c.loaded {
		return
	}
	c.loaded = true
	data, err := os.ReadFile(c.indexPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			c.entries = map[string]cacheEntry{}
		}
		return
	}
	var idx cacheIndex
	if err := json.Unmarshal(data, &idx); err != nil || idx.Version != fileCacheVersion || idx.Entries == nil {
		c.entries = map[string]cacheEntry{}
		return
	}
	c.entries = idx.Entries
}

func (c *FileCache) removeLocked(hash string) {
	if entry, ok := c.entries[hash]; ok {
		_ = os.Remove(filepath.Join(c.dir, entry.File))
		delete(c.entries, hash)
	}
}

func (c *FileCache) evictExpiredAndOverBudgetLocked(now int64) {
	var total int64
	type item struct {
		hash    string
		lastHit int64
		size    int64
	}
	var live []item
	for hash, entry := range c.entries {
		if entry.ExpiresAt <= now {
			c.removeLocked(hash)
			continue
		}
		total += entry.Size
		live = append(live, item{hash: hash, lastHit: entry.LastHit, size: entry.Size})
	}
	if total <= fileCacheMaxBytes {
		return
	}
	sort.Slice(live, func(i, j int) bool { return live[i].lastHit < live[j].lastHit })
	for _, it := range live {
		if total <= fileCacheMaxBytes {
			break
		}
		c.removeLocked(it.hash)
		total -= it.size
	}
}

func (c *FileCache) saveIndexLocked() error {
	if err := os.MkdirAll(c.dir, 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(cacheIndex{
		Version: fileCacheVersion,
		Entries: c.entries,
	})
	if err != nil {
		return err
	}
	return writeAtomic(c.indexPath, data)
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}
