// Package agentbridge is the local socket that lets the standalone MCP
// helper process perform the three allowlisted writes through the desktop
// app's own store, so an agent's change gets the same EF pinning, unit
// conversion, CO2e computation, and audit event as an edit made in the UI.
//
// Not an authentication boundary: any process that can open this socket can
// already open the SQLite file, which is strictly more powerful. The socket
// only offers the allowlist below, and fails closed when a channel is absent.
package agentbridge

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// Bridge error codes, mirrored on both ends.
const (
	ErrorNotAllowed = "channel_not_allowed"
	ErrorNotReady   = "not_ready"
	ErrorHandler    = "handler_error"
	ErrorBadRequest = "bad_request"
)

// Allowlist is the whole security posture: everything else is refused before
// dispatch, so adding a new channel stays an explicit decision.
var Allowlist = map[string]bool{
	"activity:create": true,
	"source:create":   true,
	"answer:save":     true,
}

// EnvAddress overrides the socket path (tests and unusual installs).
const EnvAddress = "CARBONINK_AGENT_BRIDGE"

// Address is where the app listens and the MCP process connects. Both derive
// it from the same data directory. Windows has no stable filesystem socket
// path under APPDATA within AF_UNIX's limit, so it hashes into the temp dir.
func Address(dataDir string) string {
	if override := os.Getenv(EnvAddress); override != "" {
		return override
	}
	path := filepath.Join(dataDir, "agent-bridge.sock")
	// macOS caps sun_path at ~104 bytes and Windows at 108. A deeply nested
	// home or a test temp directory can exceed that, so fall back to a short
	// hashed name in the system temp directory.
	if runtime.GOOS == "windows" || len(path) > 100 {
		sum := sha256.Sum256([]byte(dataDir))
		return filepath.Join(os.TempDir(), "carbonink-agent-"+hex.EncodeToString(sum[:8])+".sock")
	}
	return path
}

// Request is one newline-delimited frame from the MCP process.
type Request struct {
	ID      string            `json:"id"`
	Channel string            `json:"channel"`
	Args    []json.RawMessage `json:"args"`
}

// Response answers exactly one Request, correlated by ID.
type Response struct {
	ID    string     `json:"id"`
	OK    bool       `json:"ok"`
	Value any        `json:"value,omitempty"`
	Error *ErrorBody `json:"error,omitempty"`
}

// ErrorBody is the failure the client raises.
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Dispatch handles one allowlisted channel. It runs on the bridge's own
// goroutine, never on the UI thread.
type Dispatch func(ctx context.Context, channel string, args []json.RawMessage) (any, error)

// Server is one listening bridge.
type Server struct {
	listener net.Listener
	path     string
	dispatch Dispatch
	done     chan struct{}
}

// Listen starts the bridge at addr. A stale socket file is removed first;
// a live listener on the same path makes Listen fail.
func Listen(addr string, dispatch Dispatch) (*Server, error) {
	if dispatch == nil {
		return nil, errors.New("agentbridge: dispatch is required")
	}
	if err := os.MkdirAll(filepath.Dir(addr), 0o700); err != nil {
		return nil, fmt.Errorf("agentbridge: create socket directory: %w", err)
	}
	// A live listener must not be unlinked out from under: dial first, and
	// only a refused/absent socket is treated as stale.
	if conn, err := net.DialTimeout("unix", addr, 200*time.Millisecond); err == nil {
		_ = conn.Close()
		return nil, fmt.Errorf("agentbridge: already listening at %s", addr)
	}
	if err := os.Remove(addr); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("agentbridge: remove stale socket: %w", err)
	}
	listener, err := net.Listen("unix", addr)
	if err != nil {
		return nil, fmt.Errorf("agentbridge: listen %s: %w", addr, err)
	}
	if runtime.GOOS != "windows" {
		_ = os.Chmod(addr, 0o600)
	}
	s := &Server{listener: listener, path: addr, dispatch: dispatch, done: make(chan struct{})}
	go s.serve()
	return s, nil
}

// Address is the socket the server listens on.
func (s *Server) Address() string { return s.path }

// Close stops accepting, closes live connections, and removes the socket file.
func (s *Server) Close() error {
	select {
	case <-s.done:
		return nil
	default:
		close(s.done)
	}
	err := s.listener.Close()
	_ = os.Remove(s.path)
	return err
}

func (s *Server) serve() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.done:
				return
			default:
				continue
			}
		}
		go s.handle(conn)
	}
}

func (s *Server) handle(conn net.Conn) {
	defer conn.Close()
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		response := s.answer(line)
		out, err := json.Marshal(response)
		if err != nil {
			continue
		}
		if _, err := conn.Write(append(out, '\n')); err != nil {
			return
		}
	}
}

func (s *Server) answer(line []byte) Response {
	var req Request
	if err := json.Unmarshal(line, &req); err != nil || req.ID == "" || req.Channel == "" {
		return Response{ID: req.ID, Error: &ErrorBody{Code: ErrorBadRequest,
			Message: "Malformed bridge request."}}
	}
	if !Allowlist[req.Channel] {
		return Response{ID: req.ID, Error: &ErrorBody{Code: ErrorNotAllowed,
			Message: "Channel " + req.Channel + " is not on the agent allowlist."}}
	}
	value, err := s.dispatch(context.Background(), req.Channel, req.Args)
	if err != nil {
		return Response{ID: req.ID, Error: &ErrorBody{Code: ErrorHandler, Message: err.Error()}}
	}
	return Response{ID: req.ID, OK: true, Value: value}
}

// ErrNotRunning means the desktop app is closed or has not opened its socket.
var ErrNotRunning = errors.New("CarbonInk is not running. Start the CarbonInk " +
	"desktop app and retry — writes go through the app so they get the same " +
	"emission-factor pinning, unit conversion, and audit trail as edits made " +
	"in the UI. Read-only tools work without the app.")

// RemoteError is the app's refusal or handler failure.
type RemoteError struct {
	Code    string
	Message string
}

func (e *RemoteError) Error() string {
	if e.Code == "" {
		return e.Message
	}
	return e.Code + ": " + e.Message
}

// Call performs one write through the app. It connects per request: tool
// calls are infrequent, and a short-lived socket has no liveness state.
func Call(ctx context.Context, address, channel string, input any) (json.RawMessage, error) {
	if !Allowlist[channel] {
		return nil, &RemoteError{Code: ErrorNotAllowed,
			Message: "Channel " + channel + " is not on the agent allowlist."}
	}
	payload, err := json.Marshal(map[string]any{
		"id":      fmt.Sprintf("%d", time.Now().UnixNano()),
		"channel": channel,
		"args":    []any{input},
	})
	if err != nil {
		return nil, err
	}
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "unix", address)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) {
			return nil, ErrNotRunning
		}
		var opErr *net.OpError
		if errors.As(err, &opErr) {
			return nil, ErrNotRunning
		}
		return nil, err
	}
	defer conn.Close()
	deadline := time.Now().Add(60 * time.Second)
	_ = conn.SetDeadline(deadline)
	if _, err := conn.Write(append(payload, '\n')); err != nil {
		return nil, ErrNotRunning
	}
	reader := bufio.NewReader(conn)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return nil, ErrNotRunning
	}
	var response Response
	if err := json.Unmarshal(line, &response); err != nil {
		return nil, &RemoteError{Code: ErrorBadRequest, Message: "Unreadable response from CarbonInk."}
	}
	if !response.OK {
		if response.Error != nil {
			return nil, &RemoteError{Code: response.Error.Code, Message: response.Error.Message}
		}
		return nil, &RemoteError{Code: ErrorHandler, Message: "Request failed."}
	}
	value, err := json.Marshal(response.Value)
	if err != nil {
		return nil, err
	}
	return value, nil
}
