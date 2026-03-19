const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_UPSTREAM_REF,
  helpText,
  isPinnedRef,
  needsBuild,
  parseArgs,
  resolvePaths,
  safeRefName,
  validateBuiltArtifacts,
} = require('../lib/workspace-mcp');

test('parseArgs defaults to start command and pinned ref', () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, 'start');
  assert.equal(parsed.forceUpdate, false);
  assert.equal(parsed.upstreamRef, DEFAULT_UPSTREAM_REF);
});

test('parseArgs accepts login with explicit ref and update', () => {
  const parsed = parseArgs(['login', '--ref', 'preview-2026-03-16', '--update']);
  assert.equal(parsed.command, 'login');
  assert.equal(parsed.forceUpdate, true);
  assert.equal(parsed.upstreamRef, 'preview-2026-03-16');
});

test('parseArgs rejects unknown commands and options', () => {
  assert.throws(() => parseArgs(['serve']), /Unknown command/);
  assert.throws(() => parseArgs(['--wat']), /Unknown option/);
  assert.throws(() => parseArgs(['login', 'extra']), /Unexpected arguments/);
});

test('safeRefName makes cache directory names stable', () => {
  assert.equal(safeRefName('preview/2026-03-16'), 'preview_2026-03-16');
});

test('isPinnedRef distinguishes semver tags from moving refs', () => {
  assert.equal(isPinnedRef('v0.0.7'), true);
  assert.equal(isPinnedRef('master'), false);
  assert.equal(isPinnedRef('preview-2026-03-16'), false);
});

test('helpText mentions pinned default and --ref support', () => {
  const help = helpText();
  assert.match(help, /default upstream ref is pinned to v0\.0\.7/i);
  assert.match(help, /--ref <tag-or-branch>/);
});

test('resolvePaths scopes cache by upstream ref', () => {
  const paths = resolvePaths('v0.0.7');
  assert.match(paths.repoDir, /workspace-v0\.0\.7$/);
  assert.match(paths.distEntry, /workspace-server\/dist\/index\.js$/);
});

test('needsBuild returns false for healthy pinned refs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-mcp-test-'));
  const paths = {
    distEntry: path.join(tmp, 'dist', 'index.js'),
    headlessEntry: path.join(tmp, 'dist', 'headless-login.js'),
    stampFile: path.join(tmp, '.stamp'),
  };

  fs.mkdirSync(path.dirname(paths.distEntry), { recursive: true });
  fs.writeFileSync(paths.distEntry, '');
  fs.writeFileSync(paths.headlessEntry, '');
  fs.writeFileSync(paths.stampFile, new Date().toISOString());

  assert.equal(needsBuild(paths, 'v0.0.7'), false);
});

test('validateBuiltArtifacts throws when upstream layout is missing files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-mcp-test-'));
  const paths = {
    distEntry: path.join(tmp, 'dist', 'index.js'),
    headlessEntry: path.join(tmp, 'dist', 'headless-login.js'),
  };

  fs.mkdirSync(path.dirname(paths.distEntry), { recursive: true });
  fs.writeFileSync(paths.distEntry, '');

  assert.throws(() => validateBuiltArtifacts(paths), /expected artifacts were missing/);
});
