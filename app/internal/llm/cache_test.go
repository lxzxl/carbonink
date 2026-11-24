package llm

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFileCacheRoundTripExpiryAndClear(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "llm-cache")
	cache := NewFileCache(dir)

	key := BuildCacheKey("classify", "openai", "gpt-4o-mini", "v1", "", "",
		map[string]string{"hash": "abc"})
	if err := cache.Set(key, map[string]string{"doc_type": "freight.v1"}, time.Hour); err != nil {
		t.Fatal(err)
	}

	var got map[string]string
	if !NewFileCache(dir).Get(key, &got) {
		t.Fatal("expected cache hit from freshly opened FileCache")
	}
	if got["doc_type"] != "freight.v1" {
		t.Fatalf("got = %+v", got)
	}
	if st := cache.Stats(); st.Count != 1 || st.Bytes == 0 {
		t.Fatalf("stats = %+v, want count=1, bytes>0", st)
	}

	expiredKey := BuildCacheKey("classify", "openai", "gpt-4o-mini", "v1", "", "",
		map[string]string{"hash": "expired"})
	if err := cache.Set(expiredKey, map[string]string{"ok": "1"}, time.Millisecond); err != nil {
		t.Fatal(err)
	}
	time.Sleep(15 * time.Millisecond)
	var gone map[string]string
	if cache.Get(expiredKey, &gone) {
		t.Fatal("expected expired entry to miss")
	}

	count, bytes, err := cache.Clear()
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || bytes == 0 {
		t.Fatalf("clear = (%d, %d), want count=1, bytes>0", count, bytes)
	}
	if cache.Get(key, &got) {
		t.Fatal("expected cache miss after Clear")
	}
}

func TestBuildCacheKeyHashesLongPayload(t *testing.T) {
	long := strings.Repeat("secret-prompt-text-", 30)
	key := BuildCacheKey("classify", "gemini", "gemini-2.5-flash", "v1", "", "", long)
	if strings.Contains(key, "secret-prompt-text") {
		t.Fatalf("cache key leaked long payload: %s", key)
	}
}
