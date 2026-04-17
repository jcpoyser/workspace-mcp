#!/usr/bin/env node
/**
 * Morning brief — fetches calendar, email, messages, tasks, and recent Drive
 * activity via MCP servers, then uses Claude to synthesize a concise brief.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npm run brief
 *
 * Optional env vars:
 *   SLACK_MCP_COMMAND   — shell command to start a Slack MCP server
 *                         e.g. "npx @slack/mcp-server"
 *   EXTRA_MCP_COMMAND   — any additional stdio MCP server command
 */

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_BIN = join(__dirname, '..', 'bin', 'workspace-mcp.js');

// Tool categories relevant to a morning brief — expand here to pull in more
const BRIEF_KEYWORDS = [
  'gmail', 'mail', 'email',          // Gmail
  'calendar', 'event',               // Google Calendar
  'chat', 'message', 'space',        // Google Chat / Slack
  'task', 'todo',                    // Google Tasks
  'drive', 'file', 'document',       // Google Drive recent activity
  'people', 'contact',               // People / directory lookups
  'slack',                           // Slack (if Slack MCP attached)
];

const SYSTEM = `You are a morning briefing assistant. Use all available workspace tools to gather today's context, then produce ONE concise brief.

Gather this data (use parallel tool calls where possible):
1. Calendar events for today (full day)
2. Unread or important email from the last 24 hours (up to 15 threads)
3. Urgent or unread messages from Google Chat / Slack (last 24 hours)
4. Open tasks or to-dos due today or overdue
5. Identify obvious follow-up actions from the above

Output format — omit any section that has nothing to show:

## Morning Brief — {today}

**Calendar Today**
• HH:MM  Event title [location or video link if relevant]

**Important Email**
• Sender: Subject — one-line summary of action or key info needed

**Urgent Messages**
• Space/Channel › Sender: one-line summary

**Tasks Due**
• Task title [overdue if applicable]

**Follow-ups**
• Action — from: source thread/event

Rules:
- Max 5 bullets per section
- ⚡ prefix for truly urgent items (deadline today, explicit urgency signal)
- One line per bullet; facts only — no editorialising`;

async function connectMCP(command, args) {
  const transport = new StdioClientTransport({ command, args, env: process.env });
  const client = new Client({ name: 'morning-brief', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

function mcpResultToText(result) {
  if (!result?.content) return '(empty)';
  if (!Array.isArray(result.content)) return String(result.content);
  return result.content
    .map((c) => (c && c.type === 'text' ? c.text : JSON.stringify(c)))
    .join('\n');
}

async function main() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  // Always connect workspace-mcp (Gmail + Calendar + Chat + Drive + Tasks)
  process.stderr.write('[morning-brief] Connecting to Google Workspace…\n');
  const workspace = await connectMCP(process.execPath, [WORKSPACE_BIN]);
  const mcpClients = [workspace];

  // Optional: Slack MCP server
  const slackCmd = process.env.SLACK_MCP_COMMAND?.trim();
  if (slackCmd) {
    process.stderr.write('[morning-brief] Connecting to Slack MCP…\n');
    const [cmd, ...args] = slackCmd.split(/\s+/);
    mcpClients.push(await connectMCP(cmd, args));
  }

  // Optional: any additional MCP server (GitHub, Linear, Jira, etc.)
  const extraCmd = process.env.EXTRA_MCP_COMMAND?.trim();
  if (extraCmd) {
    process.stderr.write('[morning-brief] Connecting to extra MCP server…\n');
    const [cmd, ...args] = extraCmd.split(/\s+/);
    mcpClients.push(await connectMCP(cmd, args));
  }

  try {
    // Discover relevant tools from every connected server
    const tools = [];
    const toolOwner = new Map(); // tool name → mcp client

    for (const mcp of mcpClients) {
      const { tools: mcpTools } = await mcp.listTools();
      process.stderr.write(
        `[morning-brief] Available tools: ${mcpTools.map((t) => t.name).join(', ')}\n`,
      );
      for (const t of mcpTools) {
        if (BRIEF_KEYWORDS.some((kw) => t.name.toLowerCase().includes(kw))) {
          tools.push({
            name: t.name,
            description: t.description ?? t.name,
            input_schema: t.inputSchema ?? { type: 'object', properties: {} },
          });
          toolOwner.set(t.name, mcp);
        }
      }
    }

    if (tools.length === 0) {
      throw new Error(
        'No relevant tools found. Run `workspace-mcp login` to authenticate Google Workspace.',
      );
    }

    process.stderr.write(
      `[morning-brief] Using ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`,
    );

    const anthropic = new Anthropic();

    const messages = [
      {
        role: 'user',
        content: `Generate my morning brief for ${today}. Use the available tools to fetch calendar events, email, messages, and tasks, then output the formatted brief.`,
      },
    ];

    // Tool-use loop — Claude fetches data through MCP tools then synthesises
    while (true) {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        tools,
      });

      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('');
        process.stdout.write(text + '\n');
        break;
      }

      if (response.stop_reason !== 'tool_use') {
        process.stderr.write(
          `[morning-brief] Unexpected stop reason: ${response.stop_reason}\n`,
        );
        break;
      }

      messages.push({ role: 'assistant', content: response.content });

      const results = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const mcp = toolOwner.get(block.name);
        if (!mcp) {
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `Unknown tool: ${block.name}`,
          });
          continue;
        }

        try {
          const result = await mcp.callTool({
            name: block.name,
            arguments: block.input,
          });
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: mcpResultToText(result),
          });
        } catch (err) {
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `Tool error: ${err.message}`,
          });
        }
      }

      messages.push({ role: 'user', content: results });
    }
  } finally {
    for (const mcp of mcpClients) {
      await mcp.close().catch(() => {});
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[morning-brief] ${err.message}\n`);
  process.exit(1);
});
