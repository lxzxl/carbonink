// Command carbonink-mcp is the standalone MCP helper. Packaged builds run the
// same server with `CarbonInk --mcp`, so users need no second executable;
// this command exists for development, tests, and agents that prefer a small
// console binary.
package main

import "app.carbonink.desktop/internal/mcp"

func main() { mcp.Main() }
