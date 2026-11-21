package report

import (
	"context"
	"encoding/base64"
	"strings"

	"app.carbonink.desktop/internal/store"
)

// LogoSetting is the per-workspace key 1.x used for the report cover logo: a
// PNG or JPEG data URL, capped by the settings UI at 512 KB.
const LogoSetting = "report.logo"

// LoadLogo reads the workspace's logo for a report. A missing, malformed, or
// unsupported value returns nil so generation never fails over branding.
func LoadLogo(ctx context.Context, s *store.Store) (data []byte, format string) {
	raw, ok, err := s.Setting(ctx, LogoSetting)
	if err != nil || !ok {
		return nil, ""
	}
	return DecodeLogo(raw)
}

// DecodeLogo turns a data URL into its bytes and fpdf's image type. Anything
// but PNG or JPEG decodes to nil.
func DecodeLogo(raw string) (data []byte, format string) {
	const prefix = "data:"
	if !strings.HasPrefix(raw, prefix) {
		return nil, ""
	}
	rest := raw[len(prefix):]
	marker := ";base64,"
	at := strings.Index(rest, marker)
	if at < 0 {
		return nil, ""
	}
	switch rest[:at] {
	case "image/png":
		format = "PNG"
	case "image/jpeg", "image/jpg":
		format = "JPG"
	default:
		return nil, ""
	}
	decoded, err := base64.StdEncoding.DecodeString(rest[at+len(marker):])
	if err != nil || len(decoded) == 0 {
		return nil, ""
	}
	return decoded, format
}
