// Package workspace owns the registry of client workspaces (账套) and the
// one-time import from the Electron data directory.
//
// A workspace is one SQLite file. The registry records which files exist,
// their display names, and which one is active. The Electron app stores the
// same shape in <userData>/workspaces.json; importing copies that registry and
// its databases into the NSGo data directory without touching the originals.
package workspace

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	registryName = "workspaces.json"
	defaultFile  = "app.sqlite"
	defaultName  = "默认账套"
	maxNameRunes = 60
)

var (
	ErrInvalidName     = errors.New("workspace name must be 1-60 characters")
	ErrNotFound        = errors.New("workspace not found")
	ErrActiveWorkspace = errors.New("the active workspace cannot be removed")
	ErrLastWorkspace   = errors.New("the last workspace cannot be removed")
)

// Workspace is one client database file.
type Workspace struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	File      string `json:"file"`
	CreatedAt string `json:"created_at"`
}

// Registry is the contents of workspaces.json.
type Registry struct {
	Version    int         `json:"version"`
	Workspaces []Workspace `json:"workspaces"`
	ActiveID   string      `json:"active_id"`
}

// Manager reads and writes one data directory, optionally importing a legacy
// Electron directory on first use.
type Manager struct {
	dir    string
	legacy string
}

// New returns a manager for dir. legacy may be empty; when it holds a
// workspaces.json, Ensure imports it once.
func New(dir, legacy string) *Manager {
	return &Manager{dir: dir, legacy: legacy}
}

// Ensure loads the registry, importing or bootstrapping it on first run. The
// bool reports whether this call imported the Electron directory.
func (m *Manager) Ensure() (*Registry, bool, error) {
	if err := os.MkdirAll(m.dir, 0o700); err != nil {
		return nil, false, fmt.Errorf("create data dir: %w", err)
	}
	reg, err := m.Load()
	if err == nil {
		return reg, false, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return nil, false, err
	}
	if m.legacy != "" {
		imported, err := m.importLegacy()
		if err != nil {
			return nil, false, err
		}
		if imported {
			reg, err := m.Load()
			return reg, true, err
		}
	}
	reg = &Registry{
		Version: 1,
		Workspaces: []Workspace{{
			ID:        newID(),
			Name:      defaultName,
			File:      defaultFile,
			CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}},
	}
	reg.ActiveID = reg.Workspaces[0].ID
	if err := m.Save(reg); err != nil {
		return nil, false, err
	}
	return reg, false, nil
}

// Load reads and validates the registry. A missing registry returns
// fs.ErrNotExist.
func (m *Manager) Load() (*Registry, error) {
	data, err := os.ReadFile(filepath.Join(m.dir, registryName))
	if err != nil {
		return nil, err
	}
	var reg Registry
	if err := json.Unmarshal(data, &reg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", registryName, err)
	}
	if err := validate(&reg); err != nil {
		return nil, err
	}
	return &reg, nil
}

// Save writes the registry atomically with owner-only permissions.
func (m *Manager) Save(reg *Registry) error {
	if err := validate(reg); err != nil {
		return err
	}
	data, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(m.dir, registryName+".tmp")
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(m.dir, registryName))
}

// Active returns the active workspace and its database path. A corrupt
// active_id falls back to the first workspace, as the Electron app does.
func (m *Manager) Active() (Workspace, string, error) {
	reg, err := m.Load()
	if err != nil {
		return Workspace{}, "", err
	}
	w := reg.Workspaces[0]
	for _, candidate := range reg.Workspaces {
		if candidate.ID == reg.ActiveID {
			w = candidate
			break
		}
	}
	path, err := m.DBPath(w)
	return w, path, err
}

// DBPath resolves a workspace file inside the data directory. The registry may
// only hold base names, so a corrupted or hostile registry cannot escape it.
func (m *Manager) DBPath(w Workspace) (string, error) {
	if err := validateFile(w.File); err != nil {
		return "", err
	}
	return filepath.Join(m.dir, w.File), nil
}

// SetActive marks a registered workspace active.
func (m *Manager) SetActive(id string) error {
	reg, err := m.Load()
	if err != nil {
		return err
	}
	for _, w := range reg.Workspaces {
		if w.ID == id {
			reg.ActiveID = id
			return m.Save(reg)
		}
	}
	return ErrNotFound
}

// Create adds a workspace without opening it. The caller switches to it when
// the user is ready; a new file is created by the next store.Open.
func (m *Manager) Create(name string) (Workspace, error) {
	name, err := cleanName(name)
	if err != nil {
		return Workspace{}, err
	}
	reg, err := m.Load()
	if err != nil {
		return Workspace{}, err
	}
	id := newID()
	w := Workspace{
		ID:        id,
		Name:      name,
		File:      "workspace-" + strings.ToLower(id) + ".sqlite",
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	reg.Workspaces = append(reg.Workspaces, w)
	if err := m.Save(reg); err != nil {
		return Workspace{}, err
	}
	return w, nil
}

// Rename changes a workspace's display name; its file never moves.
func (m *Manager) Rename(id, name string) error {
	name, err := cleanName(name)
	if err != nil {
		return err
	}
	reg, err := m.Load()
	if err != nil {
		return err
	}
	for i := range reg.Workspaces {
		if reg.Workspaces[i].ID == id {
			reg.Workspaces[i].Name = name
			return m.Save(reg)
		}
	}
	return ErrNotFound
}

// Remove takes a workspace out of the registry and archives its database and
// WAL siblings with a .deleted-<stamp> suffix. It never deletes user data.
func (m *Manager) Remove(id string) (string, error) {
	reg, err := m.Load()
	if err != nil {
		return "", err
	}
	index := -1
	for i := range reg.Workspaces {
		if reg.Workspaces[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return "", ErrNotFound
	}
	if reg.ActiveID == id {
		return "", ErrActiveWorkspace
	}
	if len(reg.Workspaces) <= 1 {
		return "", ErrLastWorkspace
	}
	w := reg.Workspaces[index]
	reg.Workspaces = append(reg.Workspaces[:index], reg.Workspaces[index+1:]...)
	if err := m.Save(reg); err != nil {
		return "", err
	}

	stamp := time.Now().UTC().Format("20060102-150405.000")
	archived := ""
	base := filepath.Join(m.dir, w.File)
	if _, err := os.Stat(base); err == nil {
		archived = w.File + ".deleted-" + stamp
		if err := os.Rename(base, filepath.Join(m.dir, archived)); err != nil {
			return "", err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		from := base + suffix
		if _, err := os.Stat(from); err == nil {
			if err := os.Rename(from, filepath.Join(m.dir, w.File+suffix+".deleted-"+stamp)); err != nil {
				return "", err
			}
		} else if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
	}
	return archived, nil
}

func cleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > maxNameRunes {
		return "", ErrInvalidName
	}
	return name, nil
}

func validate(reg *Registry) error {
	if reg.Version != 1 {
		return fmt.Errorf("unsupported workspace registry version %d", reg.Version)
	}
	if len(reg.Workspaces) == 0 {
		return errors.New("workspace registry is empty")
	}
	ids := make(map[string]bool, len(reg.Workspaces))
	files := make(map[string]bool, len(reg.Workspaces))
	for _, w := range reg.Workspaces {
		if w.ID == "" || ids[w.ID] {
			return fmt.Errorf("workspace id %q is empty or duplicated", w.ID)
		}
		if strings.TrimSpace(w.Name) == "" {
			return fmt.Errorf("workspace %q has no name", w.ID)
		}
		if err := validateFile(w.File); err != nil {
			return fmt.Errorf("workspace %q: %w", w.ID, err)
		}
		if files[w.File] {
			return fmt.Errorf("workspace file %q is duplicated", w.File)
		}
		ids[w.ID] = true
		files[w.File] = true
	}
	return nil
}

func validateFile(name string) error {
	if name == "" || name == "." || name == ".." {
		return errors.New("workspace file is empty")
	}
	if filepath.Base(name) != name {
		return fmt.Errorf("workspace file %q must be a base name", name)
	}
	if !strings.HasSuffix(name, ".sqlite") {
		return fmt.Errorf("workspace file %q must end in .sqlite", name)
	}
	return nil
}

// importLegacy copies the Electron registry and its databases. The registry is
// written last, so an interrupted import retries on the next launch.
func (m *Manager) importLegacy() (bool, error) {
	src := filepath.Join(m.legacy, registryName)
	data, err := os.ReadFile(src)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read legacy registry: %w", err)
	}
	var reg Registry
	if err := json.Unmarshal(data, &reg); err != nil {
		return false, fmt.Errorf("parse legacy registry: %w", err)
	}
	if err := validate(&reg); err != nil {
		return false, fmt.Errorf("legacy registry: %w", err)
	}

	for _, w := range reg.Workspaces {
		for _, suffix := range []string{"", "-wal", "-shm"} {
			if err := copyIfExists(filepath.Join(m.legacy, w.File+suffix), filepath.Join(m.dir, w.File+suffix)); err != nil {
				return false, err
			}
		}
	}
	if err := copyTree(filepath.Join(m.legacy, "auto-backups"), filepath.Join(m.dir, "auto-backups")); err != nil {
		return false, err
	}
	if err := copyTree(filepath.Join(m.legacy, "uploads"), filepath.Join(m.dir, "uploads")); err != nil {
		return false, err
	}
	if err := m.Save(&reg); err != nil {
		return false, fmt.Errorf("write imported registry: %w", err)
	}
	return true, nil
}

func copyIfExists(src, dst string) error {
	in, err := os.Open(src)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return fmt.Errorf("copy %s: %w", src, err)
	}
	return out.Close()
}

func copyTree(src, dst string) error {
	info, err := os.Stat(src)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil || !info.IsDir() {
		return err
	}
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if !d.Type().IsRegular() {
			return nil
		}
		return copyIfExists(path, target)
	})
}

// newID returns a ULID-shaped identifier: a 48-bit millisecond timestamp and
// 80 random bits, Crockford base32 encoded. It matches the Electron registry's
// format without pulling in a ULID dependency.
func newID() string {
	var b [16]byte
	ms := uint64(time.Now().UnixMilli())
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)
	if _, err := rand.Read(b[6:]); err != nil {
		panic(fmt.Sprintf("workspace id: %v", err))
	}
	hi := binary.BigEndian.Uint64(b[:8])
	lo := binary.BigEndian.Uint64(b[8:])
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	var out [26]byte
	for i := len(out) - 1; i >= 0; i-- {
		out[i] = alphabet[lo&31]
		lo = lo>>5 | hi<<59
		hi >>= 5
	}
	return string(out[:])
}
