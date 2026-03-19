const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_URL = 'https://github.com/gemini-cli-extensions/workspace.git';
const DEFAULT_UPSTREAM_REF = 'v0.0.7';
const CACHE_DIR = path.join(os.homedir(), '.cache', 'workspace-mcp');
const LOCK_FILE = path.join(CACHE_DIR, 'build.lock');
const LOCK_TIMEOUT_MS = 2 * 60 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const MOVING_REF_REFRESH_MS = 24 * 60 * 60 * 1000;

function log(msg) {
  process.stderr.write(`[workspace-mcp] ${msg}\n`);
}

function waitFor(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function safeRefName(ref) {
  return ref.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function resolvePaths(upstreamRef) {
  const repoDir = path.join(CACHE_DIR, `workspace-${safeRefName(upstreamRef)}`);
  return {
    repoDir,
    distEntry: path.join(repoDir, 'workspace-server', 'dist', 'index.js'),
    headlessEntry: path.join(repoDir, 'workspace-server', 'dist', 'headless-login.js'),
    stampFile: path.join(repoDir, '.workspace-mcp-build-stamp'),
  };
}

function isPinnedRef(ref) {
  return /^v\d+\.\d+\.\d+$/.test(ref);
}

function run(command, args, opts = {}) {
  try {
    execFileSync(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
  } catch (err) {
    if (err.stderr?.length) process.stderr.write(err.stderr);
    if (err.stdout?.length) process.stderr.write(err.stdout);
    throw err;
  }
}

function ensureCommandAvailable(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  if (!result.error && result.status === 0) return;

  throw new Error(
    `Required command "${command}" is not available on PATH. ` +
      `Install it before running workspace-mcp.`,
  );
}

function validateBuiltArtifacts(paths) {
  const missing = [paths.distEntry, paths.headlessEntry].filter(
    (file) => !fs.existsSync(file),
  );

  if (missing.length > 0) {
    throw new Error(
      `Upstream build completed but expected artifacts were missing:\n` +
        missing.map((file) => `  - ${file}`).join('\n') +
        '\nThe upstream workspace repo layout may have changed.',
    );
  }
}

function needsBuild(paths, upstreamRef) {
  if (!fs.existsSync(paths.distEntry)) return true;
  if (!fs.existsSync(paths.headlessEntry)) return true;
  if (!fs.existsSync(paths.stampFile)) return true;

  if (isPinnedRef(upstreamRef)) return false;

  const age = Date.now() - fs.statSync(paths.stampFile).mtimeMs;
  return age > MOVING_REF_REFRESH_MS;
}

function removeDirIfPresent(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function acquireLock() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const started = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );

      return () => {
        try {
          fs.closeSync(fd);
        } catch {}
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {}
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      try {
        const stat = fs.statSync(LOCK_FILE);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(LOCK_FILE);
          continue;
        }
      } catch (lockErr) {
        if (lockErr.code === 'ENOENT') continue;
        throw lockErr;
      }

      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new Error(
          'Timed out waiting for the workspace-mcp build lock. ' +
            'Another install/update may still be running.',
        );
      }

      waitFor(250);
    }
  }
}

function cloneRepo(upstreamRef, paths) {
  log(`Cloning workspace extension at ${upstreamRef}...`);
  run('git', ['clone', '--depth', '1', '--branch', upstreamRef, REPO_URL, paths.repoDir]);
}

function buildRepo(paths) {
  log('Installing dependencies...');
  run('npm', ['ci'], { cwd: paths.repoDir });
  log('Building...');
  run('npm', ['run', 'build'], { cwd: paths.repoDir });
  validateBuiltArtifacts(paths);
  fs.writeFileSync(paths.stampFile, new Date().toISOString());
  log('Ready.');
}

function ensureBuilt(upstreamRef, options = {}) {
  const { forceUpdate = false } = options;
  const releaseLock = acquireLock();
  const paths = resolvePaths(upstreamRef);

  try {
    ensureCommandAvailable('git');
    ensureCommandAvailable('npm');

    if (forceUpdate) {
      log(`Refreshing workspace extension at ${upstreamRef}...`);
      removeDirIfPresent(paths.repoDir);
    }

    if (!fs.existsSync(path.join(paths.repoDir, '.git'))) {
      cloneRepo(upstreamRef, paths);
    }

    if (needsBuild(paths, upstreamRef)) {
      buildRepo(paths);
    } else {
      validateBuiltArtifacts(paths);
    }

    return paths;
  } finally {
    releaseLock();
  }
}

function parseArgs(argv) {
  const parsed = {
    command: 'start',
    showHelp: false,
    forceUpdate: false,
    upstreamRef: process.env.WORKSPACE_MCP_UPSTREAM_REF || DEFAULT_UPSTREAM_REF,
  };

  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      parsed.showHelp = true;
      continue;
    }

    if (arg === '--update') {
      parsed.forceUpdate = true;
      continue;
    }

    if (arg === '--ref') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --ref');
      parsed.upstreamRef = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--ref=')) {
      parsed.upstreamRef = arg.slice('--ref='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 1) {
    throw new Error(`Unexpected arguments: ${positionals.join(' ')}`);
  }

  if (positionals.length === 1) {
    if (positionals[0] !== 'login') {
      throw new Error(`Unknown command: ${positionals[0]}`);
    }
    parsed.command = 'login';
  }

  return parsed;
}

function helpText() {
  return `workspace-mcp - Google Workspace MCP server

Usage:
  workspace-mcp [--ref <tag-or-branch>] [--update]
  workspace-mcp login [--ref <tag-or-branch>] [--update]
  workspace-mcp --help

Notes:
  - The default upstream ref is pinned to ${DEFAULT_UPSTREAM_REF}.
  - Use --ref or WORKSPACE_MCP_UPSTREAM_REF to opt into a newer tag or moving branch.
  - --update refreshes the selected ref explicitly.

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
  WORKSPACE_MCP_UPSTREAM_REF                Override the pinned upstream tag/branch
  WORKSPACE_CLIENT_ID                       Override OAuth client ID
  WORKSPACE_CLOUD_FUNCTION_URL              Override cloud function URL
  GEMINI_CLI_WORKSPACE_FORCE_FILE_STORAGE   Force file-based token storage`;
}

function runCommand(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);

  if (parsed.showHelp) {
    console.log(helpText());
    return 0;
  }

  const paths = ensureBuilt(parsed.upstreamRef, { forceUpdate: parsed.forceUpdate });

  if (parsed.command === 'login') {
    const child = spawn(process.execPath, [paths.headlessEntry], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 1));
    return 0;
  }

  const child = spawn(process.execPath, [paths.distEntry, '--use-dot-names'], {
    stdio: 'inherit',
    env: process.env,
  });

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => child.kill(sig));
  }

  child.on('exit', (code) => process.exit(code ?? 0));
  return 0;
}

function main(argv = process.argv.slice(2)) {
  try {
    return runCommand(argv);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    log(message);
    process.exitCode = 1;
    return 1;
  }
}

module.exports = {
  DEFAULT_UPSTREAM_REF,
  acquireLock,
  ensureBuilt,
  helpText,
  isPinnedRef,
  main,
  needsBuild,
  parseArgs,
  resolvePaths,
  runCommand,
  safeRefName,
  validateBuiltArtifacts,
};
