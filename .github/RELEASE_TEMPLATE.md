## CarbonInk v{version}

### Highlights

-

### What's New

{changelog}

### Downloads

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [carbonink-{version}-macos-arm64.dmg](https://github.com/lxzxl/carbonink/releases/download/v{version}/carbonink-{version}-macos-arm64.dmg) |
| macOS (Intel) | [carbonink-{version}-macos-x64.dmg](https://github.com/lxzxl/carbonink/releases/download/v{version}/carbonink-{version}-macos-x64.dmg) |
| Windows (x64) | [carbonink-{version}-windows-x64-setup.exe](https://github.com/lxzxl/carbonink/releases/download/v{version}/carbonink-{version}-windows-x64-setup.exe) |

### Upgrading from 1.x (Electron)

CarbonInk 2.0 is a native rewrite (no Chromium / Node runtime), so 1.x installations cannot auto-update into 2.0 in place. Download and install the 2.0 installer above:

- **Automatic read-only data import:** On first launch, CarbonInk 2.0 copies your 1.x workspaces, databases, uploads, and backups without modifying the 1.x data directory.
- **Re-enter API keys once:** Provider metadata carries over automatically, while OS keychain/credential secrets from Electron need to be re-entered once in **Settings → AI Provider**.

### Auto-update

Built-in updates via Sparkle (macOS) and WinSparkle (Windows): go to **Settings → Software Updates → Check for Updates**.

### System Requirements

- macOS 13+ (Ventura or later)
- Windows 10/11 (64-bit)
