#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { guardBootstrapEntry, requireBootstrap, BOOTSTRAP_RECEIPT } from '../../src/shared/bootstrap-readiness.js';


await guardBootstrapEntry(import.meta.url);
const { spawnSubprocess, spawnSubprocessSync } = await import('../../src/shared/subprocess/runner.js');
const { isDirectExecution } = await import('../../src/shared/direct-execution.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const portableLinkExclusions = new Set([
  'tooling/install/bootstrap-readiness', // Its link branch is POSIX-only.
  'tooling/ci/lsp-runtime-artifact-admission', // Stock PHPactor is POSIX-only; Windows asserts unsupported before opening bytes.
  'indexing/semantic/native-deferred-production', // Linux ELF qualification.
  'indexing/semantic/native-task-authority' // Linux ELF qualification.
]);

export const findWindowsLinkFixtures = (root, tests) => {
  const sourceCache = new Map();
  return tests.filter(test => {
    if (portableLinkExclusions.has(test.id) || /^tooling\/script-coverage\/(core|storage|indexing|language|benchmarks|search|embeddings|services|fixtures|tools)\//.test(test.id)) return false;
    const file = path.resolve(root, 'tests', test.path);
    if (!sourceCache.has(file)) sourceCache.set(file, fs.readFileSync(file, 'utf8'));
    return /\b(?:symlink|symlinkSync)\s*\(/.test(sourceCache.get(file));
  }).map(test => test.id).sort();
};

export const validateAuthorityManifest = (manifest, discoveredIds, requiredIds) => {
  assert.equal(manifest?.schemaVersion, 1, 'authority manifest schema');
  assert.deepEqual(Object.keys(manifest).sort(), ['ids', 'schemaVersion'], 'unknown authority manifest field');
  assert.ok(Array.isArray(manifest.ids) && manifest.ids.length > 0, 'explicit nonempty authority cohort');
  assert.ok(manifest.ids.every(id => typeof id === 'string' && id.length > 0), 'authority IDs are strings');
  assert.equal(new Set(manifest.ids).size, manifest.ids.length, 'duplicate authority ID');
  const available = new Set(discoveredIds);
  assert.ok(manifest.ids.every(id => available.has(id)), 'unknown authority ID');
  assert.deepEqual([...manifest.ids].sort(), [...requiredIds].sort(), 'authority inventory drift: review every direct link fixture');
  return [...manifest.ids];
};

export const authorityRunnerArgs = (ids, reportFile, logDir) => {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ['tests/run.js', '--lane', 'all-with-destructive', '--jobs', '1',
    '--pairofcleats-threads', '1', '--timeout-ms', '30000', '--retries', '0',
    '--native-status-redo=false', '--fail-fast', '--report-file', reportFile, '--log-dir', logDir,
    ...ids.flatMap(id => ['--match', '/^' + escape(id) + '$/'])];
};

export const assertAuthorityReport = (report, ids) => {
  assert.ok(Array.isArray(report?.tests), 'authority report missing');
  assert.equal(report.tests.length, ids.length, 'authority report incomplete');
  assert.equal(new Set(report.tests.map(test => test.id)).size, ids.length, 'duplicate authority result');
  assert.deepEqual(report.tests.map(test => test.id).sort(), [...ids].sort(), 'authority result identity mismatch');
  for (const test of report.tests) {
    assert.equal(test.status, 'passed', `${test.id}: authority cases must pass`);
    assert.equal(test.timedOut, false, `${test.id}: timeout`);
    assert.ok(test.skipReason == null, `${test.id}: skip`);
    assert.equal(test.attempts, 1, `${test.id}: retry`);
    assert.equal(test.exitCode, 0, `${test.id}: exit`);
    assert.equal(test.signal, null, `${test.id}: signal`);
    assert.ok(Number.isFinite(test.durationMs) && test.durationMs >= 0 && test.durationMs <= 30000, `${test.id}: deadline`);
  }
};

export const probeFileSymlink = (fileSystem = fs) => {
  const dir = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'poc-windows-authority-'));
  const target = path.join(dir, 'target.txt'), link = path.join(dir, 'link.txt');
  const contents = randomUUID();
  try {
    fileSystem.writeFileSync(target, contents);
    fileSystem.symlinkSync(target, link, 'file');
    assert.ok(fileSystem.lstatSync(link).isSymbolicLink() && fileSystem.statSync(link).isFile(), 'actual file symlink required');
    assert.equal(fileSystem.readFileSync(link, 'utf8'), contents, 'file symlink read proof');
    return { created: true, type: 'file-symlink' };
  } finally {
    // Only unlink these two owned entries; never recursively traverse a link.
    for (const file of [link, target]) {
      try { fileSystem.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    fileSystem.rmdirSync(dir);
  }
};

const sha256 = value => createHash('sha256').update(value).digest('hex');
const sha256File = async file => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 64 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
};
const git = (root, args) => {
  const result = spawnSubprocessSync('git', args, { cwd: root, stdio: 'pipe', timeoutMs: 30000 });
  if (result.exitCode !== 0) throw new Error('Git identity failed: ' + result.stderr);
  return result.stdout.trim();
};

const runWindowsAuthority = async (root = ROOT) => {
  assert.equal(process.platform, 'win32', 'Windows authority qualification requires Windows');
  await requireBootstrap({ root });
  assert.equal(process.version.slice(1), fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(), 'qualification must use the exact CI Node pin');
  const output = path.join(root, '.diagnostics/windows-authority');
  fs.mkdirSync(output, { recursive: true });
  const receipt = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'running',
    checkoutRoot: root, head: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']),
    platform: process.platform, arch: process.arch, os: os.version(), release: os.release(),
    node: process.version, abi: process.versions.modules, nodeExecutableSha256: await sha256File(process.execPath) };
  const receiptPath = path.join(output, 'environment.json');
  try {
    assert.equal(git(root, ['status', '--porcelain']), '', 'authority checkout must be clean');
    const readinessBytes = fs.readFileSync(path.join(root, BOOTSTRAP_RECEIPT));
    const readiness = JSON.parse(readinessBytes);
    receipt.bootstrapSha256 = sha256(readinessBytes);
    receipt.verifiedPackages = readiness.verifiedPackages;
    receipt.nativeCapabilities = readiness.nativeCapabilities;
    fs.writeFileSync(path.join(output, 'bootstrap-receipt.json'), readinessBytes);
    receipt.phase = 'capability';
    receipt.capability = probeFileSymlink();
    receipt.phase = 'discovery';
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    const listed = await spawnSubprocess(process.execPath, ['tests/run.js', '--lane', 'all-with-destructive', '--list', '--json'],
      { cwd: root, stdio: 'pipe', timeoutMs: 30000, maxOutputBytes: 10 * 1024 * 1024, killTree: true, cleanupOnParentExit: true });
    const tests = JSON.parse(listed.stdout).tests;
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/ci/windows-authority-fixtures.json'), 'utf8'));
    const ids = validateAuthorityManifest(manifest, tests.map(test => test.id), findWindowsLinkFixtures(root, tests));
    receipt.ids = ids;
    receipt.timeoutMs = 30000;
    receipt.retries = 0;
    receipt.nativeStatusRedo = false;
    const reportFile = path.join(output, 'test-summary.json');
    const logDir = path.join(root, '.testLogs/windows-authority');
    const args = authorityRunnerArgs(ids, reportFile, logDir);
    receipt.phase = 'tests';
    receipt.command = [process.execPath, ...args];
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    await spawnSubprocess(process.execPath, args, { cwd: root, stdio: 'inherit', timeoutMs: ids.length * 30000 + 30000,
      killTree: true, cleanupOnParentExit: true });
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assertAuthorityReport(report, ids);
    for (const test of report.tests) assert.ok(test.logs?.length && test.logs.every(file => fs.existsSync(file)), `${test.id}: missing logs`);
    assert.equal(git(root, ['rev-parse', 'HEAD']), receipt.head, 'authority source changed');
    assert.equal(git(root, ['status', '--porcelain']), '', 'authority tests modified the checkout');
    assert.equal(sha256(fs.readFileSync(path.join(root, BOOTSTRAP_RECEIPT))), receipt.bootstrapSha256, 'authority dependency receipt changed');
    receipt.phase = 'complete';
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed';
    receipt.error = { code: error.code || null, message: error.message };
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  }
};

if (isDirectExecution(import.meta.url)) {
  try { await runWindowsAuthority(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
