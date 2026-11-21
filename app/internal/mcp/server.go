// Package mcp is the stdio Model Context Protocol server an external agent
// (Claude Code, Codex, Cursor, or any MCP host) runs beside CarbonInk.
//
// Reads open the active workspace read-only and keep working with the app
// closed. Writes are refused here and forwarded over the desktop app's
// allowlisted local socket, so they land through the same store operations
// the UI uses.
package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// Version is the server version advertised on initialize.
var Version = "2.0.0-beta.1"

const defaultProtocolVersion = "2024-11-05"

// Server is one MCP session. Its seams exist so tests can point it at a
// fixture database and a test bridge.
type Server struct {
	DBPath func() (string, error)
	Bridge func(ctx context.Context, channel string, args []json.RawMessage) (any, error)
}

// New returns a production server.
func New() *Server {
	return &Server{
		DBPath: DBPath,
		Bridge: func(ctx context.Context, channel string, args []json.RawMessage) (any, error) {
			return bridgeCall(ctx, channel, args)
		},
	}
}

// Main runs the stdio server until stdin closes.
func Main() {
	if err := New().Serve(context.Background(), os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "carbonink-mcp:", err)
		os.Exit(1)
	}
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Serve reads newline-delimited JSON-RPC from in and writes responses to out.
// Notifications produce no response.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	encoder := json.NewEncoder(out)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			if err := encoder.Encode(rpcResponse{JSONRPC: "2.0",
				Error: &rpcError{Code: -32700, Message: "Parse error"}}); err != nil {
				return err
			}
			continue
		}
		result, rpcErr, respond := s.handle(ctx, &req)
		if !respond {
			continue
		}
		response := rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: result, Error: rpcErr}
		if err := encoder.Encode(response); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func (s *Server) handle(ctx context.Context, req *rpcRequest) (any, *rpcError, bool) {
	// Notifications carry no id and expect no response.
	if len(req.ID) == 0 || string(req.ID) == "null" {
		return nil, nil, false
	}
	switch req.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &params)
		version := params.ProtocolVersion
		if version == "" {
			version = defaultProtocolVersion
		}
		return map[string]any{
			"protocolVersion": version,
			"capabilities": map[string]any{
				"tools":     map[string]any{},
				"resources": map[string]any{},
			},
			"serverInfo": map[string]any{"name": "carbonink", "version": Version},
			"instructions": "CarbonInk holds one organization's GHG inventory: reporting " +
				"periods, emission sources, activity data, and customer questionnaires. " +
				"Read tools work with the desktop app closed; the three write tools " +
				"(set_answer, create_activity, create_emission_source) require it running.",
		}, nil, true
	case "ping":
		return map[string]any{}, nil, true
	case "tools/list":
		return map[string]any{"tools": tools()}, nil, true
	case "tools/call":
		return s.callTool(ctx, req.Params)
	case "resources/list":
		return s.listResources()
	case "resources/read":
		return s.readResource(req.Params)
	default:
		return nil, &rpcError{Code: -32601, Message: "Method not found: " + req.Method}, true
	}
}

func (s *Server) callTool(ctx context.Context, raw json.RawMessage) (any, *rpcError, bool) {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil || params.Name == "" {
		return nil, &rpcError{Code: -32602, Message: "Invalid tools/call parameters"}, true
	}
	value, err := s.dispatchTool(ctx, params.Name, params.Arguments)
	if err != nil {
		// Tool failures are results, not protocol errors: the host shows the
		// text to the model and lets it decide what to do.
		return map[string]any{
			"content": []any{map[string]any{"type": "text", "text": err.Error()}},
			"isError": true,
		}, nil, true
	}
	text, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return map[string]any{
			"content": []any{map[string]any{"type": "text", "text": err.Error()}},
			"isError": true,
		}, nil, true
	}
	return map[string]any{
		"content": []any{map[string]any{"type": "text", "text": string(text)}},
	}, nil, true
}

func (s *Server) dispatchTool(ctx context.Context, name string, args json.RawMessage) (any, error) {
	switch name {
	case "list_questionnaires", "get_questionnaire", "list_questions", "get_answer",
		"list_activities", "list_emission_sources":
		path, err := s.DBPath()
		if err != nil {
			return nil, err
		}
		return runReadQuery(ctx, path, name, args)

	case "set_answer":
		return s.writeTool(ctx, "answer:save", normalizeAnswerArgs(args))
	case "create_activity":
		return s.writeTool(ctx, "activity:create", args)
	case "create_emission_source":
		return s.writeTool(ctx, "source:create", args)
	}
	return nil, errors.New("Unknown tool: " + name)
}

func (s *Server) writeTool(ctx context.Context, channel string, args json.RawMessage) (any, error) {
	if s.Bridge == nil {
		return nil, errors.New("Writes are unavailable: no agent bridge is configured.")
	}
	if len(args) == 0 {
		args = json.RawMessage(`{}`)
	}
	return s.Bridge(ctx, channel, []json.RawMessage{args})
}

func bridgeCall(ctx context.Context, channel string, args []json.RawMessage) (any, error) {
	path, err := DBPath()
	if err != nil {
		return nil, err
	}
	address := bridgeAddress(path)
	if len(args) == 0 {
		return nil, errors.New("missing tool arguments")
	}
	out, err := callBridge(ctx, address, channel, args[0])
	if err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal(out, &value); err != nil {
		return nil, err
	}
	return value, nil
}
