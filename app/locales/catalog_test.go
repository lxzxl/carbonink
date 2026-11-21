package locales

import (
	"os"
	"testing"

	"go.yaml.in/yaml/v3"
)

// TestCatalogParity keeps en and zh-CN at the same key set. The converter
// checks the JSON side; this checks the committed YAML.
func TestCatalogParity(t *testing.T) {
	en := read(t, "en.yaml")
	zh := read(t, "zh-CN.yaml")
	for key, value := range en {
		if _, ok := zh[key]; !ok {
			t.Errorf("zh-CN is missing %q", key)
		}
		if message(value) == "" {
			t.Errorf("en %q is empty", key)
		}
	}
	for key := range zh {
		if _, ok := en[key]; !ok {
			t.Errorf("en is missing %q", key)
		}
	}
	if len(en) < 1200 {
		t.Fatalf("en has %d messages, want the full 1.x catalog", len(en))
	}
}

func read(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := yaml.Unmarshal(data, &out); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return out
}

func message(v any) string {
	switch v := v.(type) {
	case string:
		return v
	case map[string]any:
		s, _ := v["message"].(string)
		return s
	default:
		return ""
	}
}
