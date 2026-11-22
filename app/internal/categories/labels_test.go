package categories

import "testing"

func TestLegacyLabel(t *testing.T) {
	tests := []struct {
		locale, value, want string
	}{
		{"en-US", "electricity.grid", "Grid electricity"},
		{"zh-CN", "electricity.grid", "电网电力"},
		{"zh-CN", "fuel.mobile", "移动燃烧"},
		{"en-US", "custom.key", "custom.key"},
	}
	for _, test := range tests {
		if got := LegacyLabel(test.locale, test.value); got != test.want {
			t.Errorf("LegacyLabel(%q, %q) = %q, want %q", test.locale, test.value, got, test.want)
		}
	}
}
