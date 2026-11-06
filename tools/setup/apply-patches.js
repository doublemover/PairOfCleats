#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitLikeChildResult } from './postinstall-exit.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { resolveBootstrapBudget, runBootstrapTasks } from './bootstrap-tasks.js';
import { throwIfAborted } from '../../src/shared/abort.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { withCheckoutMutation, requireCheckoutMutationSession } from './checkout-mutation.js';
import { withPackagePatchStage } from './patch-stage.js';
import { formatBootstrapTaskProgress } from './task-progress.js';

const MAX_PATCH_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PATCHES = 32;
const MAX_FILES_PER_PATCH = 16;
const MAX_TARGETS = 128;

// Only bounded existing text-file modifications are supported. Git applies
// hunks to a disposable staging file, never to a path from a package patch.
const checkedPath = (root, relative, directory = false) => {
  let current = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    if (!/^[a-zA-Z0-9_@.+-]+$/.test(part) || part === '.' || part === '..'
      || part.toLowerCase() === '.git') throw new Error(`Unsafe patch path: ${relative}`);
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    const needsDirectory = index < parts.length - 1 || directory;
    if (stat.isSymbolicLink() || (needsDirectory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
      throw new Error(`Patch path must be a regular unlinked ${needsDirectory ? 'directory' : 'file'}: ${relative}`);
    }
  }
  return current;
};

const readBounded = (file, limit) => {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error(`Patch input exceeds size limit: ${file}`);
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length !== stat.size) throw new Error(`Patch input changed while reading: ${file}`);
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
};

const decodeText = (buffer) => {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  if (text.includes('\0')) throw new Error('Binary package patches are unsupported.');
  return text;
};

const validateHunks = (lines) => {
  let oldLeft = 0;
  let newLeft = 0;
  let hunks = 0;
  let previousBody = false;
  for (const line of lines) {
    if (line === '\\ No newline at end of file' && previousBody) {
      previousBody = false;
      continue;
    }
    previousBody = false;
    if (oldLeft === 0 && newLeft === 0) {
      const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?: .*)?$/.exec(line);
      if (!hunk) throw new Error('Unsupported or malformed patch hunk.');
      oldLeft = Number(hunk[1] ?? 1);
      newLeft = Number(hunk[2] ?? 1);
      if (oldLeft + newLeft > MAX_PATCH_BYTES || oldLeft + newLeft === 0) throw new Error('Invalid patch hunk size.');
      hunks++;
      continue;
    }
    if (line[0] === ' ') { oldLeft--; newLeft--; }
    else if (line[0] === '-') oldLeft--;
    else if (line[0] === '+') newLeft--;
    else throw new Error('Unsupported patch hunk content.');
    if (oldLeft < 0 || newLeft < 0) throw new Error('Invalid patch hunk counts.');
    previousBody = true;
  }
  if (!hunks || oldLeft || newLeft) throw new Error('Incomplete patch hunks.');
  return hunks;
};

const parsePatch = (name, buffer) => {
  const match = /^(@[a-z0-9_-]+\+)?([a-z0-9][a-z0-9._-]*)\+(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)\.patch$/.exec(name);
  if (!match) throw new Error(`Unsupported package patch filename: ${name}`);
  const packageName = `${match[1] ? `${match[1].slice(0, -1)}/` : ''}${match[2]}`;
  const lines = decodeText(buffer).replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const sections = [];
  for (const line of lines) {
    if (line.startsWith('diff --git ')) sections.push([]);
    if (!sections.length) throw new Error('Missing package patch header.');
    sections.at(-1).push(line);
  }
  if (!sections.length || sections.length > MAX_FILES_PER_PATCH) {
    throw new Error('Package patch exceeds file section limit.');
  }
  return sections.map(section => {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(section[0]);
    const relative = header?.[1];
    if (!relative || relative !== header[2] || !relative.startsWith(`node_modules/${packageName}/`)
      || !/^index [a-f0-9]+\.\.[a-f0-9]+ 100(?:644|755)$/.test(section[1])
      || section[2] !== `--- a/${relative}` || section[3] !== `+++ b/${relative}`) {
      throw new Error(`Unsupported or malformed existing-file text patch: ${name}`);
    }
    const hunks = validateHunks(section.slice(4));
    section[0] = 'diff --git a/target b/target';
    section[2] = '--- a/target';
    section[3] = '+++ b/target';
    return { name, packageName, version: match[3], relative, hunks, patch: `${section.join('\n')}\n` };
  });
};

const gitOptions = stage => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(stage, 'empty.gitconfig'),
    GIT_ATTR_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: path.dirname(stage)
  });
  return { cwd: stage, env, shell: false, windowsHide: true };
};
const gitArgs = (args, input = '-') => ['-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', ...args, input];
const runGitAsync = async (stage, patch, args, signal) => {
  try {
    fs.writeFileSync(path.join(stage, 'patch.diff'), patch, { mode: 0o600 });
    const result = await spawnResolvedSubprocess('git', gitArgs(args, 'patch.diff'), { ...gitOptions(stage),
      outputEncoding: 'utf8', maxOutputBytes: MAX_PATCH_BYTES, timeoutMs: 30000,
      signal, rejectOnNonZeroExit: false, stdio: 'pipe' });
    if (result.signal || result.exitCode == null) {
      throw Object.assign(new Error(result.signal || 'no exit status'), { result });
    }
    return { ...result, status: result.exitCode };
  } catch (cause) {
    // Preserve scheduler cancellation and any original subprocess ownership.
    // Wrapping AbortError as a Git failure lets an earlier cancelled input
    // mask the actual incompatible patch that stopped the preparation wave.
    const description = describeStorageFailure(cause, { phase: 'package-patch-git', defaultCode: 'ERR_PATCH_GIT',
      defaultMessage: 'Git patch operation failed.' });
    if (readErrorDataProperty(cause, 'name') === 'AbortError' || readErrorDataProperty(cause, 'code') === 'ABORT_ERR') throw cause;
    const error = new Error('Cannot run required Git patch tool: ' + description.message, { cause });
    try {
      const result = readErrorDataProperty(cause, 'result');
      if (result) error.childResult = { ...result, status: result.exitCode };
    } catch (inspection) { throw addStorageFailureContext(error, {}, inspection, { secondaryPresent: true }); }
    throw error;
  }
};

const collectPatchInputs = cwd => {
  const root = fs.realpathSync(cwd);
  try { fs.lstatSync(path.join(root, 'patches')); } catch (error) {
    if (error.code === 'ENOENT') return { root, inputs: [] };
    throw error;
  }
  const patchesDir = checkedPath(root, 'patches', true);
  const names = [];
  const directory = fs.opendirSync(patchesDir);
  try {
    let count = 0;
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++count > 128) throw new Error('Too many entries in patches/.');
      if (!entry.name.endsWith('.patch')) continue;
      if (!entry.isFile()) throw new Error('Patch must be a regular file: ' + entry.name);
      names.push(entry.name);
      if (names.length > MAX_PATCHES) throw new Error('Too many package patches.');
    }
  } finally { directory.closeSync(); }
  const inputs = [], targets = new Set();
  let totalBytes = 0;
  for (const name of names.sort()) {
    const sections = parsePatch(name, readBounded(checkedPath(root, 'patches/' + name), MAX_PATCH_BYTES));
    for (const patch of sections) {
      const packageJsonPath = checkedPath(root, 'node_modules/' + patch.packageName + '/package.json');
      const installed = JSON.parse(decodeText(readBounded(packageJsonPath, MAX_PATCH_BYTES)));
      if (installed.name !== patch.packageName || installed.version !== patch.version) {
        throw new Error(name + ' requires exactly ' + patch.packageName + '@' + patch.version
          + '; found ' + installed.name + '@' + installed.version);
      }
      const target = checkedPath(root, patch.relative);
      if (targets.has(target.toLowerCase())) throw new Error('Multiple patches target the same file: ' + patch.relative);
      targets.add(target.toLowerCase());
      if (targets.size > MAX_TARGETS) throw new Error('Package patches exceed target file limit.');
      const before = readBounded(target, MAX_FILE_BYTES);
      totalBytes += before.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Package patches exceed total input size limit.');
      const source = decodeText(before);
      const crlf = source.includes('\r\n');
      if (crlf && /(^|[^\r])\n/.test(source)) throw new Error('Mixed line endings are unsupported: ' + patch.relative);
      inputs.push({ ...patch, target, before, crlf });
    }
  }
  return { root, inputs };
};

// One state machine serves serial and parallel preparation in the async owner.
// Every target has its own Git working directory and private configuration.
function* preparePatch(input, stage, verifyOnly) {
  const { name, before, crlf } = input;
  fs.writeFileSync(path.join(stage, 'empty.gitconfig'), '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(stage, 'target'), decodeText(before).replace(/\r\n/g, '\n'));
  const forward = yield ['--check'];
  if (verifyOnly && forward.status === 0) {
    throw new Error('Required patch ' + name + ' has not been applied. Run npm run bootstrap:ci.');
  }
  if (forward.status !== 0) {
    if ((yield ['--reverse', '--check']).status !== 0) {
      throw new Error('Required patch ' + name + ' cannot apply and is not fully applied:\n' + forward.stderr.trim());
    }
    return { ...input, after: null };
  }
  const applied = yield [];
  if (applied.status !== 0) throw new Error('Failed to apply ' + name + ': ' + applied.stderr.trim());
  const afterText = decodeText(readBounded(path.join(stage, 'target'), MAX_FILE_BYTES));
  const after = Buffer.from(crlf ? afterText.replace(/\n/g, '\r\n') : afterText);
  if (before.equals(after) || (yield ['--reverse', '--check']).status !== 0) {
    throw new Error('Required patch was not completely applied: ' + name);
  }
  return { ...input, after };
}

const publishPatches = (root, prepared, { verifyOnly, verbose, log, started }) => {
  // Validate all patches first, then recheck paths and bytes before publishing.
  for (const item of prepared) {
    checkedPath(root, item.relative);
    if (!readBounded(item.target, MAX_FILE_BYTES).equals(item.before)) {
      throw new Error('Package file changed during patch validation: ' + item.target);
    }
  }
  let published = 0;
  for (const item of prepared) {
    try {
      if (item.after) {
        const temporary = fs.mkdtempSync(path.join(path.dirname(item.target), '.poc-patch-'));
        try {
          const staged = path.join(temporary, 'target');
          fs.writeFileSync(staged, item.after, { mode: fs.statSync(item.target).mode & 0o777 });
          fs.renameSync(staged, item.target);
          published++;
        } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
      }
    } catch (cause) {
      throw Object.assign(new Error(`Patch publication failed for ${item.name} (${item.relative}); ${published} target files changed before failure. Re-run verified bootstrap to repair partial completion.`, { cause }), {
        code: 'ERR_PATCH_PARTIAL_PUBLICATION', publishedFiles: published, patch: item.name, target: item.relative
      });
    }
    if (verbose) log(`[patches] ${item.name}: ${item.relative}: ${item.after ? 'applied' : 'verified already applied'} (${item.hunks} hunks)`);
  }
  const packages = new Map();
  for (const item of prepared) {
    const counts = packages.get(item.name) || { applied: 0, unchanged: 0, hunks: 0 };
    counts[item.after ? 'applied' : 'unchanged']++;
    counts.hunks += item.hunks;
    packages.set(item.name, counts);
  }
  for (const [name, counts] of packages) {
    log(`[patches] ${name}: ${verifyOnly ? 'verified' : 'complete'}; ${counts.applied} applied files, ${counts.unchanged} already-applied files, ${counts.hunks} hunks`);
  }
  const hunks = prepared.reduce((total, item) => total + item.hunks, 0);
  log(`[patches] ${verifyOnly ? 'verify-only' : 'apply'}: ${packages.size} packages, ${prepared.length} target files, ${hunks} hunks; ${published} files changed; ${Math.max(0, performance.now() - started).toFixed(0)}ms`);
  return prepared.length;
};

export const applyPatchesAsync = async (cwd = process.cwd(), options = {}) => {
  const { verifyOnly = false, signal = null, verbose = false, log = console.log, session = null, budget } = options;
  const capturedBudget = budget ? Object.freeze({ ...budget }) : undefined;
  return withCheckoutMutation(cwd, async actual => {
    const execute = () => applyPatchesOwned(cwd, { verifyOnly, signal, verbose, log, session: actual,
      ...(capturedBudget ? { budget: capturedBudget } : {}) });
    // A read-only direct check must not replace the journal qualifying existing
    // readiness. Nested checks remain tracked by their original parent journal.
    const { withCheckoutStageJournal, getCheckoutStageJournal } = await import('./checkout-stage-journal.js');
    if (verifyOnly && !getCheckoutStageJournal(actual)) return execute();
    return withCheckoutStageJournal(cwd, actual, { schemaVersion: 1, kind: 'direct-package-patch-plan',
      root: actual.root, stages: [{ id: 'patches' }] }, (journal, owned) => owned ? journal.runStage('patches', execute) : execute());
  }, { session, signal, kind: 'package-patches' });
};

const applyPatchesOwned = async (cwd, { verifyOnly = false, signal = null,
  verbose = false, log = console.log, session,
  budget = resolveBootstrapBudget({ bytesPerJob: 128 * 1024 * 1024 }) } = {}) => {
  const started = performance.now();
  const { root, inputs } = collectPatchInputs(cwd);
  if (!inputs.length) return 0;
  const outcome = await runBootstrapTasks(inputs.map((input, index) => ({
    id: 'patch:' + index, bytes: 128 * 1024 * 1024,
    run: async ({ signal: taskSignal }) => withPackagePatchStage(root, session, async stage => {
      const iterator = preparePatch(input, stage, verifyOnly);
      let step = iterator.next();
      while (!step.done) step = iterator.next(await runGitAsync(stage, input.patch, step.value, taskSignal));
      return step.value;
    })
  })), { budget, signal, eventContext: { runId: session.runId }, onEvent: event => {
    const line = formatBootstrapTaskProgress(event, 'patch-preparation');
    if (line) console.error(line);
  } });
  // Input order owns diagnostics and publication even when preparation overlaps.
  const failure = outcome.results.find(row => row.status === 'failed');
  if (failure) throw failure.error;
  const cancelled = outcome.results.find(row => row.status === 'cancelled' && row.error !== null);
  if (cancelled) throw cancelled.error;
  throwIfAborted(signal, 'Package patch preparation cancelled.');
  if (!outcome.ok) throw new Error('Package patch preparation cancelled.');
  requireCheckoutMutationSession(root, session);
  return publishPatches(root, outcome.results.map(row => row.result), { verifyOnly, verbose, log, started });
};

export const exitPatchFailure = (error) => {
  const message = readErrorDataProperty(error, 'message'), result = readErrorDataProperty(error, 'childResult');
  console.error('[patches] ' + (typeof message === 'string' ? message : 'Package patch operation failed.'));
  if (result) exitLikeChildResult(result);
  else process.exit(1);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--verify', '--verbose'].includes(arg))) throw new Error('Usage: node tools/setup/apply-patches.js [--verify] [--verbose]');
    if (!await applyPatchesAsync(process.cwd(), { verifyOnly: args.includes('--verify'), verbose: args.includes('--verbose') })) console.log('[patches] no patch files found; skipping patch step.');
  } catch (error) { exitPatchFailure(error); }
}
