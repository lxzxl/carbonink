package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"

	"app.carbonink.desktop/internal/agentbridge"
)

// bridgeAddress is the same derivation the desktop app uses.
func bridgeAddress(dbPath string) string {
	return agentbridge.Address(filepath.Dir(dbPath))
}

func callBridge(ctx context.Context, address, channel string, args json.RawMessage) (json.RawMessage, error) {
	var input any
	if len(args) > 0 {
		if err := json.Unmarshal(args, &input); err != nil {
			return nil, errors.New("invalid tool arguments: " + err.Error())
		}
	}
	return agentbridge.Call(ctx, address, channel, input)
}

// normalizeAnswerArgs forces the provenance the 1.x MCP server set: answers
// written by an agent are ai_suggested, never manual.
func normalizeAnswerArgs(raw json.RawMessage) json.RawMessage {
	var in map[string]any
	if err := json.Unmarshal(raw, &in); err != nil || in == nil {
		return raw
	}
	in["source_kind"] = "ai_suggested"
	if _, ok := in["finalize"]; !ok {
		in["finalize"] = false
	}
	out, err := json.Marshal(in)
	if err != nil {
		return raw
	}
	return out
}
