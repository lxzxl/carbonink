// Package mcpconfig writes the CarbonInk MCP server entry into the config
// files agent hosts read (Claude Desktop, Claude Code, Cursor). Existing
// settings are preserved; only the `carbonink` entry is added or removed.
package mcpconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Client names one supported agent host.
type Client string

const (
	ClaudeDesktop Client = "claudeDesktop"
	ClaudeCode    Client = "claudeCode"
	Cursor        Client = "cursor"
)

// Clients is the stable display order.
var Clients = []Client{ClaudeDesktop, ClaudeCode, Cursor}

// Entry is one `mcpServers.carbonink` value.
type Entry struct {
	Command string
	Args    []string
}

// Status is one client's detection result.
type Status struct {
	Client      Client
	Installed   bool
	Configured  bool
	NeedsUpdate bool
	ConfigPath  string
}

// Result describes one configure or remove call.
type Result struct {
	ConfigPath string
	BackupPath string
	NoChange   bool
}

// Path returns the config file for a client.
func Path(home, configDir string, client Client) string {
	switch client {
	case ClaudeDesktop:
		return filepath.Join(configDir, "Claude", "claude_desktop_config.json")
	case ClaudeCode:
		return filepath.Join(home, ".claude.json")
	case Cursor:
		return filepath.Join(home, ".cursor", "mcp.json")
	}
	return ""
}

// Detect returns every client's installed/configured state.
func Detect(home, configDir string, entry Entry) []Status {
	out := make([]Status, 0, len(Clients))
	for _, client := range Clients {
		path := Path(home, configDir, client)
		status := Status{Client: client, ConfigPath: path, Installed: installed(home, configDir, client)}
		servers, err := readServers(path)
		if err == nil {
			if configured, ok := servers["carbonink"]; ok {
				status.Configured = true
				status.NeedsUpdate = !matches(configured, entry)
			}
		}
		out = append(out, status)
	}
	return out
}

// Configure adds or updates the `carbonink` entry.
func Configure(path string, entry Entry) (Result, error) {
	result := Result{ConfigPath: path}
	root := map[string]any{}
	var existingRaw string
	if data, err := os.ReadFile(path); err == nil {
		existingRaw = string(data)
		if err := json.Unmarshal(data, &root); err != nil {
			return result, fmt.Errorf("refusing to overwrite invalid JSON at %s", path)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return result, err
	}
	servers := map[string]any{}
	if raw, ok := root["mcpServers"].(map[string]any); ok {
		servers = raw
	}
	// Drop a stale duplicate of our own entry under another key.
	for key, value := range servers {
		if key != "carbonink" && matches(value, entry) {
			delete(servers, key)
		}
	}
	servers["carbonink"] = map[string]any{"command": entry.Command, "args": entry.Args}
	root["mcpServers"] = servers

	next, err := encode(root)
	if err != nil {
		return result, err
	}
	if existingRaw == next {
		result.NoChange = true
		pruneBackups(path)
		return result, nil
	}
	if existingRaw != "" {
		result.BackupPath = backupPath(path)
		if err := os.WriteFile(result.BackupPath, []byte(existingRaw), 0o600); err != nil {
			return result, fmt.Errorf("backup %s: %w", path, err)
		}
	}
	if err := writeFile(path, next); err != nil {
		return result, err
	}
	pruneBackups(path)
	return result, nil
}

// Remove drops the `carbonink` entry, leaving everything else intact.
func Remove(path string) (Result, error) {
	result := Result{ConfigPath: path}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		result.NoChange = true
		return result, nil
	}
	if err != nil {
		return result, err
	}
	root := map[string]any{}
	if err := json.Unmarshal(data, &root); err != nil {
		return result, fmt.Errorf("refusing to overwrite invalid JSON at %s", path)
	}
	servers, ok := root["mcpServers"].(map[string]any)
	if !ok {
		result.NoChange = true
		return result, nil
	}
	if _, present := servers["carbonink"]; !present {
		result.NoChange = true
		return result, nil
	}
	delete(servers, "carbonink")
	if len(servers) == 0 {
		delete(root, "mcpServers")
	} else {
		root["mcpServers"] = servers
	}
	next, err := encode(root)
	if err != nil {
		return result, err
	}
	result.BackupPath = backupPath(path)
	if err := os.WriteFile(result.BackupPath, data, 0o600); err != nil {
		return result, fmt.Errorf("backup %s: %w", path, err)
	}
	if err := writeFile(path, next); err != nil {
		return result, err
	}
	pruneBackups(path)
	return result, nil
}

func installed(home, configDir string, client Client) bool {
	switch client {
	case ClaudeDesktop:
		return exists(filepath.Join(configDir, "Claude"))
	case ClaudeCode:
		return exists(filepath.Join(home, ".claude.json")) || exists(filepath.Join(home, ".claude"))
	case Cursor:
		return exists(filepath.Join(home, ".cursor"))
	}
	return false
}

func readServers(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	root := map[string]any{}
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	servers, _ := root["mcpServers"].(map[string]any)
	if servers == nil {
		servers = map[string]any{}
	}
	return servers, nil
}

func matches(value any, entry Entry) bool {
	row, ok := value.(map[string]any)
	if !ok {
		return false
	}
	command, _ := row["command"].(string)
	if command != entry.Command {
		return false
	}
	rawArgs, _ := row["args"].([]any)
	if len(rawArgs) != len(entry.Args) {
		return false
	}
	for i, arg := range entry.Args {
		if fmt.Sprint(rawArgs[i]) != arg {
			return false
		}
	}
	return true
}

func encode(root map[string]any) (string, error) {
	data, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data) + "\n", nil
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func writeFile(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".carbonink-tmp-" + fmt.Sprint(time.Now().UnixNano())
	if err := os.WriteFile(tmp, []byte(content), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func backupPath(path string) string {
	stamp := strings.NewReplacer(":", "-", ".", "-").Replace(time.Now().UTC().Format("20060102-150405.000000000"))
	return fmt.Sprintf("%s.carbonink-bak-%s-%d", path, stamp, os.Getpid())
}

func pruneBackups(path string) {
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type backup struct {
		path string
		mod  time.Time
	}
	var backups []backup
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), base+".carbonink-bak-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		backups = append(backups, backup{filepath.Join(dir, entry.Name()), info.ModTime()})
	}
	sort.Slice(backups, func(i, j int) bool { return backups[i].mod.After(backups[j].mod) })
	for i := 3; i < len(backups); i++ {
		_ = os.Remove(backups[i].path)
	}
}
