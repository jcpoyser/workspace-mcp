# workspace-mcp

Google Workspace MCP server for any AI coding agent. Wraps the [gemini-cli-extensions/workspace](https://github.com/gemini-cli-extensions/workspace) extension into a standalone MCP server runnable via `npx`.

Gives your AI agent access to: **Gmail, Google Docs, Drive, Calendar, Chat, Sheets, Slides, People, and time utilities** — 59 tools total.

## Quick start

Add to your MCP client config (Claude Code, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "npx",
      "args": ["-y", "github:wedow/workspace-mcp"]
    }
  }
}
```

On first run, it clones and builds the upstream extension (~30s). Subsequent starts are instant.

## OAuth login

The server uses Google OAuth. On first tool call, it opens a browser for authentication. For headless environments:

```sh
npx -y github:wedow/workspace-mcp login
```

## Commands

```
workspace-mcp           Start the MCP server (stdio)
workspace-mcp login     Interactive OAuth login
workspace-mcp --update  Force update from upstream
workspace-mcp --help    Show help
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `WORKSPACE_CLIENT_ID` | Override OAuth client ID |
| `WORKSPACE_CLOUD_FUNCTION_URL` | Override cloud function URL |
| `GEMINI_CLI_WORKSPACE_FORCE_FILE_STORAGE` | Force file-based token storage (skip OS keychain) |

## License

MIT (wrapper). The upstream extension is Apache-2.0.
