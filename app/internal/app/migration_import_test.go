package app

import (
	"context"
	"testing"

	"app.carbonink.desktop/internal/prefs"
	"app.carbonink.desktop/internal/store"
)

func TestAdoptLegacyProvider(t *testing.T) {
	cases := []struct {
		name    string
		setting string
		want    prefs.Settings
		adopted bool
	}{
		{
			name:    "known provider fills its preset base URL",
			setting: `{"provider":"deepseek","model":"deepseek-reasoner"}`,
			want: prefs.Settings{LLMProvider: "deepseek", LLMModel: "deepseek-reasoner",
				LLMBaseURL: "https://api.deepseek.com/v1"},
			adopted: true,
		},
		{
			name:    "1.x only provider keeps its endpoint as custom",
			setting: `{"provider":"kimi-coding","model":"kimi-k2","baseUrl":"https://api.moonshot.cn/v1"}`,
			want: prefs.Settings{LLMProvider: "custom", LLMModel: "kimi-k2",
				LLMBaseURL: "https://api.moonshot.cn/v1"},
			adopted: true,
		},
		{
			name:    "unknown provider without an endpoint is dropped",
			setting: `{"provider":"kimi-coding","model":"kimi-k2"}`,
		},
		{
			name:    "id without a model is dropped",
			setting: `{"provider":"openai"}`,
		},
		{
			name:    "malformed JSON is dropped",
			setting: `not json`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			path := fixtureDB(t)
			db, err := store.Open(ctx, path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if err := db.SetSetting(ctx, "llm.provider", tc.setting); err != nil {
				t.Fatal(err)
			}

			var got prefs.Settings
			if adopted := adoptLegacyProvider(ctx, db, &got); adopted != tc.adopted {
				t.Fatalf("adopted = %v, want %v", adopted, tc.adopted)
			}
			if got != tc.want {
				t.Fatalf("settings = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestAdoptLegacyProviderKeepsExistingSettings(t *testing.T) {
	ctx := context.Background()
	path := fixtureDB(t)
	db, err := store.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.SetSetting(ctx, "llm.provider",
		`{"provider":"deepseek","model":"deepseek-chat"}`); err != nil {
		t.Fatal(err)
	}

	existing := prefs.Settings{LLMProvider: "openai", LLMModel: "gpt-4o", LLMBaseURL: "https://example.com/v1"}
	if adoptLegacyProvider(ctx, db, &existing) {
		t.Fatal("adopted over existing settings")
	}
	if existing.LLMProvider != "openai" || existing.LLMModel != "gpt-4o" {
		t.Fatalf("settings changed: %+v", existing)
	}
}
