#!/usr/bin/env node

/**
 * workspace-mcp - Google Workspace MCP server for any AI agent
 *
 * Wraps the gemini-cli-extensions/workspace MCP server so it can be
 * run standalone via `npx workspace-mcp` or configured in any MCP client.
 *
 * On first run, clones and builds the upstream repo to a local cache.
 * Subsequent runs reuse the cached build.
 */

const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_URL = 'https://github.com/gemini-cli-extensions/workspace.git';
const CACHE_DIR = path.join(os.homedir(), '.cache', 'workspace-mcp');
const REPO_DIR = path.join(CACHE_DIR, 'workspace');
const DIST_ENTRY = path.join(REPO_DIR, 'workspace-server', 'dist', 'index.js');
const STAMP_FILE = path.join(CACHE_DIR, 'build-stamp');

function log(msg) {
  process.stderr.write(`[workspace-mcp] ${msg}\n`);
}

function run(cmd, opts) {
  try {
    execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch (err) {
    if (err.stderr?.length) process.stderr.write(err.stderr);
    if (err.stdout?.length) process.stderr.write(err.stdout);
    throw err;
  }
}

function needsBuild() {
  if (!fs.existsSync(DIST_ENTRY)) return true;
  if (!fs.existsSync(STAMP_FILE)) return true;
  // Rebuild if stamp is older than 24 hours
  const age = Date.now() - fs.statSync(STAMP_FILE).mtimeMs;
  return age > 24 * 60 * 60 * 1000;
}

function ensureBuilt() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
    if (fs.existsSync(REPO_DIR)) {
      fs.rmSync(REPO_DIR, { recursive: true, force: true }); // clear any partial clone
    }
    log('Cloning workspace extension...');
    run(`git clone --depth 1 ${REPO_URL} ${REPO_DIR}`);
  } else if (needsBuild()) {
    log('Updating workspace extension...');
    try {
      run('git pull --ff-only', { cwd: REPO_DIR });
    } catch {
      // Non-fatal — use existing checkout
    }
  }

  if (needsBuild()) {
    log('Installing dependencies...');
    run('npm install', { cwd: REPO_DIR });
    log('Building...');
    run('npm run build', { cwd: REPO_DIR });
    fs.writeFileSync(STAMP_FILE, new Date().toISOString());
    log('Ready.');
  }
}

function main() {
  const args = process.argv.slice(2);

  // Pass-through special commands
  if (args.includes('login')) {
    ensureBuilt();
    const headless = path.join(REPO_DIR, 'workspace-server', 'dist', 'headless-login.js');
    const child = spawn('node', [headless], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 1));
    return;
  }

  if (args.includes('--update')) {
    log('Forcing re-clone...');
    try { fs.rmSync(REPO_DIR, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(STAMP_FILE); } catch {}
    ensureBuilt();
    log('Update complete.');
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`workspace-mcp - Google Workspace MCP server

Usage:
  workspace-mcp           Start the MCP server (stdio transport)
  workspace-mcp login     Run interactive OAuth login
  workspace-mcp --update  Re-clone and rebuild from upstream
  workspace-mcp --help    Show this help

MCP client configuration example (Claude Code, Cursor, etc.):
  {
    "mcpServers": {
      "google-workspace": {
        "command": "npx",
        "args": ["-y", "github:jcpoyser/workspace-mcp"]
      }
    }
  }

Environment variables:
  WORKSPACE_CLIENT_ID                       Override OAuth client ID
  WORKSPACE_CLOUD_FUNCTION_URL              Override cloud function URL
  GEMINI_CLI_WORKSPACE_FORCE_FILE_STORAGE   Force file-based token storage`);
    return;
  }

  ensureBuilt();

  // Start the MCP server with stdio transport
  const child = spawn('node', [DIST_ENTRY, '--use-dot-names'], {
    stdio: 'inherit',
    env: process.env,
  });

  // Register signal handlers immediately after spawn
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => child.kill(sig));
  }

  child.on('exit', (code) => process.exit(code ?? 0));
}

main();
