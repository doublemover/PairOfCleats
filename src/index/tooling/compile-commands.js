import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isAbsolutePathNative, isPathWithinRoot } from '../../shared/file-paths.js';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../shared/contained-file.js';
import { stableStringify } from '../../shared/stable-json.js';
import { throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource, describeStorageFailure } from '../../shared/storage/failure-observation.js';

const MAX_DATABASE_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 16384;
const MAX_RESPONSE_BYTES = 1024 * 1024, MAX_RESPONSES = 64, MAX_RESPONSE_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_PATHS = 2048;
const digest = value => createHash('sha256').update(value).digest('hex');
const canonicalPath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const documentKey = (rootDir, doc) => {
  if (typeof doc?.virtualPath !== 'string' || !doc.virtualPath || isAbsolutePathNative(doc.virtualPath)
    || doc.virtualPath.replace(/\\/g, '/').split('/').includes('..')) return null;
  return canonicalPath(path.resolve(rootDir, doc.containerPath || doc.virtualPath));
};
const bindingKey = (rootDir, config, documents) => digest(stableStringify({ rootDir: canonicalPath(rootDir), config,
  documents: documents.map(doc => [doc.virtualPath, doc.containerPath || null, doc.docHash || null]) }));
const candidatesFor = (rootDir, clangdConfig) => {
  const candidates = [];
  if (clangdConfig?.compileCommandsDir) {
    const value = clangdConfig.compileCommandsDir;
    candidates.push(isAbsolutePathNative(value) ? value : path.join(rootDir, value));
  } else {
    candidates.push(rootDir);
    candidates.push(path.join(rootDir, 'build'));
    candidates.push(path.join(rootDir, 'out'));
    candidates.push(path.join(rootDir, 'cmake-build-debug'));
    candidates.push(path.join(rootDir, 'cmake-build-release'));
  }
  return candidates.map(dir => path.resolve(dir));
};

const selectDatabase = (rootDir, config) => {
  const selections = [];
  const args = Array.isArray(config?.args) ? config.args : [];
  for (let index = 0; index < args.length; index++) {
    if (typeof args[index] !== 'string') continue;
    const match = /^--?compile-commands-dir(?:=(.*))?$/.exec(args[index]);
    if (!match) continue;
    const value = match[1] === undefined ? args[++index] : match[1];
    if (typeof value !== 'string' || !value.trim()) return { dir: null, path: null, status: 'invalid-selection' };
    selections.push(path.resolve(rootDir, value));
  }
  if (selections.length) {
    const explicit = typeof config?.compileCommandsDir === 'string' && config.compileCommandsDir.trim()
      ? path.resolve(rootDir, config.compileCommandsDir) : null;
    if (new Set([...selections, ...(explicit ? [explicit] : [])].map(canonicalPath)).size > 1) {
      return { dir: null, path: null, status: 'conflicting-selection' };
    }
    config = { ...config, compileCommandsDir: selections[0] };
  }
  if (Object.hasOwn(config || {}, 'compileCommandsDir') && config.compileCommandsDir != null
    && (typeof config.compileCommandsDir !== 'string' || !config.compileCommandsDir.trim())) {
    return { dir: null, path: null, status: 'invalid-selection' };
  }
  for (const dir of candidatesFor(rootDir, config)) {
    const candidate = path.join(dir, 'compile_commands.json');
    try {
      const stat = fsSync.lstatSync(candidate);
      return { dir, path: candidate, status: stat.isFile() && !stat.isSymbolicLink() ? 'selected' : 'wrong-kind' };
    } catch (error) {
      const { code } = describeStorageFailure(error, { phase: 'compile-database-selection' });
      if (code !== 'ENOENT') return { dir, path: candidate, status: 'unreadable', code };
      if (config?.compileCommandsDir) return { dir, path: candidate, status: 'missing' };
    }
  }
  return { dir: null, path: null, status: 'missing' };
};

/** Locator compatibility for owners with their own stricter source admission.
 * A non-null locator is not usable per-document compilation context. */
export const resolveCompileCommandsDir = (rootDir, clangdConfig) => {
  const selected = selectDatabase(rootDir, clangdConfig);
  return selected.status === 'selected' ? selected.dir : null;
};

/** Read-only bounded command admission. Arguments and command text remain data;
 * this owner never invokes a driver, build, shell or response-file command. */
export const admitCompilationDatabase = async ({ rootDir, config = {}, documents = [], signal = null }) => {
  throwIfAborted(signal);
  const selection = Object.freeze(selectDatabase(rootDir, config)), responses = new Map(), byFile = new Map(), failedResponses = new Set();
  const requestedFiles = new Set(documents.map(doc => documentKey(rootDir, doc))), pathKinds = new Map();
  const base = { version: 1, selection, explicit: Object.hasOwn(config, 'compileCommandsDir') && config.compileCommandsDir != null
      || (Array.isArray(config.args) && config.args.some(value => typeof value === 'string' && /^--?compile-commands-dir(?:=|$)/.test(value))),
  bindingKey: bindingKey(rootDir, config, documents), sha256: null, responses: [], sourcePathBudgetReached: false,
  status: selection.status, totalEntries: 0, invalidEntries: 0, usableEntries: 0 };
  const coverage = () => {
    const counts = { exact: 0, ambiguous: 0, inferred: 0, fallback: 0, unknown: 0 };
    const rows = documents.map(doc => {
      const key = documentKey(rootDir, doc), variants = byFile.get(key) || new Map();
      const embedded = doc.containerPath && doc.containerPath !== doc.virtualPath;
      const entries = [...variants.values()];
      const status = !key || embedded ? 'unknown' : entries.length > 1 ? 'ambiguous'
        : entries.length === 1 && entries[0].complete ? 'exact' : entries.length ? 'unknown'
          : ['missing', 'empty', 'usable', 'partially-valid'].includes(base.status) ? 'fallback' : 'unknown';
      counts[status]++;
      return Object.freeze({ virtualPath: doc.virtualPath, status, variants: variants.size,
        variantKey: status === 'exact' ? entries[0].variantKey : null });
    });
    return Object.freeze({ ...base, responses: Object.freeze([...responses.values()]),
      sourcePaths: Object.freeze([...pathKinds.values()].filter(Boolean)),
      documents: Object.freeze(rows), counts: Object.freeze(counts) });
  };
  if (selection.status !== 'selected') return coverage();
  let read, raw;
  try {
    read = await readVerifiedContainedFile(selection.dir, selection.path, { maxBytes: MAX_DATABASE_BYTES, signal });
    base.sha256 = read.hash;
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
  } catch (error) {
    const { code } = describeStorageFailure(error, { phase: 'compile-database-read' });
    throwIfAborted(signal);
    base.status = code === 'ERR_FILE_TOO_LARGE' ? 'over-budget'
      : error instanceof SyntaxError || code === 'ERR_ENCODING_INVALID_ENCODED_DATA' ? 'malformed' : 'unreadable';
    return coverage();
  }
  if (!Array.isArray(raw)) { base.status = 'malformed'; return coverage(); }
  base.totalEntries = raw.length;
  if (raw.length > MAX_ENTRIES) { base.status = 'over-budget'; return coverage(); }
  if (!raw.length) { base.status = 'empty'; return coverage(); }
  const physicalRoot = await fs.realpath(rootDir);
  let responseBytes = 0;
  for (let ordinal = 0; ordinal < raw.length; ordinal++) {
    if (ordinal % 128 === 0) { await new Promise(resolve => setImmediate(resolve)); throwIfAborted(signal); }
    const row = raw[ordinal];
    if (!row || typeof row !== 'object' || typeof row.directory !== 'string' || !row.directory.trim()
      || typeof row.file !== 'string' || !row.file.trim()
      || row.directory.length > 4096 || row.file.length > 4096
      || !path.isAbsolute(row.directory)) { base.invalidEntries++; continue; }
    const argsValid = Array.isArray(row.arguments) && row.arguments.length > 0 && row.arguments.length <= 128
      && row.arguments.every(value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0'));
    const commandValid = row.arguments === undefined && typeof row.command === 'string'
      && row.command.trim().length > 0 && row.command.length <= 32768 && !row.command.includes('\0');
    if (!argsValid && !commandValid) { base.invalidEntries++; continue; }
    const directory = path.resolve(row.directory), file = path.resolve(directory, row.file);
    let complete = true;
    const dependencies = [];
    if (requestedFiles.has(canonicalPath(file)) && !isPathWithinRoot(file, rootDir)) complete = false;
    if (requestedFiles.has(canonicalPath(file)) && isPathWithinRoot(file, rootDir)) {
      for (const [filename, kind] of [[directory, 'directory'], [file, 'file']]) {
        const key = `${kind}:${filename}`;
        if (!pathKinds.has(key)) {
          if (pathKinds.size >= MAX_SOURCE_PATHS) { complete = false; base.sourcePathBudgetReached = true; continue; }
          try {
            assertNoSymlinkPath(path.parse(filename).root, filename);
            const stat = await fs.lstat(filename, { bigint: true });
            const realPath = await fs.realpath(filename);
            pathKinds.set(key, !stat.isSymbolicLink() && (kind === 'directory' ? stat.isDirectory()
              : stat.isFile() && isPathWithinRoot(realPath, physicalRoot))
              ? Object.freeze({ path: filename, realPath, kind, dev: String(stat.dev), ino: String(stat.ino) }) : null);
          } catch (error) {
            observeStorageResource(error, { phase: 'compile-source-path-admission' }).requireSettled();
            pathKinds.set(key, null);
          }
        }
        if (!pathKinds.get(key)) complete = false;
      }
    }
    // Opaque shell command strings are never parsed/executed to discover @file
    // dependencies. Without their closure, that variant remains unknown.
    if (commandValid && row.command.includes('@')) complete = false;
    for (const argument of argsValid ? row.arguments : []) {
      if (argument.includes('@') && !argument.startsWith('@')) complete = false;
      if (!argument.startsWith('@')) continue;
      const response = path.resolve(directory, argument.slice(1));
      if (argument.length < 2 || !(isPathWithinRoot(response, rootDir) || isPathWithinRoot(response, selection.dir))) { complete = false; continue; }
      if (!responses.has(response) && !failedResponses.has(response)) {
        if (responses.size + failedResponses.size >= MAX_RESPONSES || responseBytes >= MAX_RESPONSE_TOTAL_BYTES) { complete = false; continue; }
        try {
          const root = isPathWithinRoot(response, rootDir) ? rootDir : selection.dir;
          const value = await readVerifiedContainedFile(root, response,
            { maxBytes: Math.min(MAX_RESPONSE_BYTES, MAX_RESPONSE_TOTAL_BYTES - responseBytes), signal });
          responseBytes += value.buffer.length;
          // Nested response expansion is toolchain-specific. Do not claim an
          // exact closure after inspecting only its outer file.
          let nested = true;
          try { nested = new TextDecoder('utf-8', { fatal: true }).decode(value.buffer).includes('@'); } catch {}
          responses.set(response, Object.freeze({ path: response, root, sha256: value.hash, bytes: value.buffer.length, complete: !nested }));
        } catch (error) {
          observeStorageResource(error, { phase: 'compile-response-read' }).requireSettled();
          throwIfAborted(signal); complete = false;
          if (failedResponses.size < MAX_RESPONSES) failedResponses.add(response);
        }
      }
      const dependency = responses.get(response);
      if (!dependency || !dependency.complete) complete = false;
      if (dependency) dependencies.push(dependency);
    }
    const variantKey = digest(stableStringify({ file: canonicalPath(file), directory: canonicalPath(directory),
      arguments: argsValid ? row.arguments : null, command: commandValid ? row.command : null, dependencies }));
    const key = canonicalPath(file), variants = byFile.get(key) || new Map();
    variants.set(variantKey, { variantKey, complete }); byFile.set(key, variants); base.usableEntries++;
  }
  base.status = base.usableEntries ? base.invalidEntries ? 'partially-valid' : 'usable' : 'malformed';
  return coverage();
};

/** Reuse the captured map only for the same launch/configuration/documents and
 * fresh exact dependency bytes. A changed selection must be replanned. */
export const revalidateCompilationDatabase = async (captured, { rootDir, config = {}, documents = [], signal = null }) => {
  if (!captured || captured.bindingKey !== bindingKey(rootDir, config, documents)
    || stableStringify(captured.selection) !== stableStringify(selectDatabase(rootDir, config))) return false;
  if (captured.selection.status !== 'selected') return true;
  if (!captured.sha256) {
    const next = await admitCompilationDatabase({ rootDir, config, documents, signal });
    return next.status === captured.status && next.sha256 === captured.sha256;
  }
  const read = await readVerifiedContainedFile(captured.selection.dir, captured.selection.path,
    { maxBytes: MAX_DATABASE_BYTES, signal });
  if (read.hash !== captured.sha256) return false;
  for (const response of captured.responses) {
    const value = await readVerifiedContainedFile(response.root, response.path, { maxBytes: MAX_RESPONSE_BYTES, signal });
    if (value.hash !== response.sha256 || value.buffer.length !== response.bytes) return false;
  }
  for (const source of captured.sourcePaths) {
    assertNoSymlinkPath(path.parse(source.path).root, source.path);
    const stat = await fs.lstat(source.path, { bigint: true });
    if (String(stat.dev) !== source.dev || String(stat.ino) !== source.ino || stat.isSymbolicLink()
      || canonicalPath(await fs.realpath(source.path)) !== canonicalPath(source.realPath)
      || !(source.kind === 'directory' ? stat.isDirectory() : stat.isFile())) return false;
  }
  return true;
};
