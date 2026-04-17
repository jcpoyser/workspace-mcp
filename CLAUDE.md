# workspace-mcp

Google Workspace MCP server wrapper. Provides Gmail, Calendar, Chat, Drive, Docs, Sheets, Slides, and Tasks tools to any MCP-compatible AI agent.

## Morning Brief

Generates one concise daily brief covering calendar events, important email, urgent messages, open tasks, and follow-ups.

### Quick start

```bash
# 1. Authenticate Google Workspace (first time only)
workspace-mcp login

# 2. Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Install dependencies (first time only)
npm install

# 4. Run the brief
npm run brief
```

### What it covers

| Section | Source |
|---|---|
| Calendar Today | Google Calendar — all-day and timed events |
| Important Email | Gmail — unread/starred, last 24 h, up to 15 threads |
| Urgent Messages | Google Chat spaces + Slack (if configured) |
| Tasks Due | Google Tasks — due today or overdue |
| Follow-ups | Synthesised from email and message threads |

### Optional integrations

**Slack** — set `SLACK_MCP_COMMAND` to your Slack MCP server command:
```bash
SLACK_MCP_COMMAND="npx @slack/mcp-server" npm run brief
```

**Any other MCP server** (GitHub, Linear, Jira, etc.) — set `EXTRA_MCP_COMMAND`:
```bash
EXTRA_MCP_COMMAND="npx @github/mcp-server" npm run brief
```

Both env vars accept a full shell command including arguments, e.g. `"npx -y @slack/mcp-server --token xoxb-..."`.

### Adding more tool categories

Edit `BRIEF_KEYWORDS` in `scripts/morning-brief.mjs` to pull in additional tool families from any connected MCP server. Tools whose names contain any listed keyword are automatically included.

---

## MCP Server Setup

Configure workspace-mcp as an MCP server in Claude Code, Cursor, Windsurf, or any compatible client:

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

## Authentication

```bash
# Interactive OAuth login (opens browser)
workspace-mcp login

# Headless / CI environments — same command, follow prompts
workspace-mcp login
```

Tokens are stored in the OS keychain. Set `GEMINI_CLI_WORKSPACE_FORCE_FILE_STORAGE=1` to use file-based storage instead.

## CLI Reference

```
workspace-mcp [--ref <tag-or-branch>] [--update]
workspace-mcp login [--ref <tag-or-branch>]
workspace-mcp --help
```

Environment variables:
- `WORKSPACE_MCP_UPSTREAM_REF` — pin to a specific upstream tag/branch
- `WORKSPACE_CLIENT_ID` — override OAuth client ID
- `WORKSPACE_CLOUD_FUNCTION_URL` — override cloud function URL
- `GEMINI_CLI_WORKSPACE_FORCE_FILE_STORAGE` — use file storage instead of OS keychain
