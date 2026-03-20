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
      "args": ["-y", "github:jcpoyser/workspace-mcp"]
    }
  }
}
```

For Codex:

```sh
codex mcp add google-workspace -- npx -y github:jcpoyser/workspace-mcp
```

On first run, it clones and builds the upstream extension (~30s). Subsequent starts reuse the cached build. By default, the wrapper pins the upstream workspace server to `v0.0.7` so startup stays reproducible.

## OAuth login

The server uses Google OAuth. On first tool call, it opens a browser for authentication. For headless environments:

```sh
npx -y github:jcpoyser/workspace-mcp login
```

To opt into a different upstream tag or branch:

```sh
npx -y github:jcpoyser/workspace-mcp --ref preview-2026-03-16
```

## Commands

```
workspace-mcp [--ref <tag-or-branch>]           Start the MCP server (stdio)
workspace-mcp login [--ref <tag-or-branch>]     Interactive OAuth login
workspace-mcp --update                          Refresh the selected upstream ref
workspace-mcp --help                            Show help
```

## Reliability notes

- Upstream is pinned by default to `v0.0.7`.
- Use `--ref` or `WORKSPACE_MCP_UPSTREAM_REF` to opt into a different tag or a moving branch.
- `--update` now refreshes the selected ref explicitly instead of silently advancing to a newer upstream build.
- The wrapper uses a cache lock so concurrent MCP clients do not step on each other's clone/build.

## Environment variables

| Variable | Description |
|----------|-------------|
| `WORKSPACE_MCP_UPSTREAM_REF` | Override the pinned upstream tag/branch |
| `WORKSPACE_CLIENT_ID` | Override OAuth client ID |
| `WORKSPACE_CLOUD_FUNCTION_URL` | Override cloud function URL |
| `GEMINI_CLI_WORKSPACE_FORCE_FILE_STORAGE` | Force file-based token storage (skip OS keychain) |

## Prerequisites

- Node.js 18+
- `git`
- `npm`

## License

MIT (wrapper). The upstream extension is Apache-2.0.
