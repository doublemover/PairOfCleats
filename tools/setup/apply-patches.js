#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { exitLikeChildResult } from './postinstall-exit.js';

const MAX_PATCH_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PATCHES = 32;

// Only existing, single-file text modifications are supported. Git applies
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
};

const parsePatch = (name, buffer) => {
  const match = /^(@[a-z0-9_-]+\+)?([a-z0-9][a-z0-9._-]*)\+(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)\.patch$/.exec(name);
  if (!match) throw new Error(`Unsupported package patch filename: ${name}`);
  const packageName = `${match[1] ? `${match[1].slice(0, -1)}/` : ''}${match[2]}`;
  const lines = decodeText(buffer).replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[0]);
  const relative = header?.[1];
  if (!relative || relative !== header[2] || !relative.startsWith(`node_modules/${packageName}/`)
    || !/^index [a-f0-9]+\.\.[a-f0-9]+ 100(?:644|755)$/.test(lines[1])
    || lines[2] !== `--- a/${relative}` || lines[3] !== `+++ b/${relative}`) {
    throw new Error(`Unsupported or malformed single-file text patch: ${name}`);
  }
  validateHunks(lines.slice(4));
  // Preserve the checked-in licensed patch. Rewrite only its in-memory headers.
  lines[0] = 'diff --git a/target b/target';
  lines[2] = '--- a/target';
  lines[3] = '+++ b/target';
  return { name, packageName, version: match[3], relative, patch: `${lines.join('\n')}\n` };
};

const runGit = (stage, patch, args) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(stage, 'empty.gitconfig'),
    GIT_ATTR_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: path.dirname(stage)
  });
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', ...args, '-'], {
    cwd: stage, input: patch, encoding: 'utf8', env, shell: false,
    windowsHide: true, maxBuffer: MAX_PATCH_BYTES, timeout: 30000
  });
  if (result.error || result.signal || result.status === null) {
    const error = new Error(`Cannot run required Git patch tool: ${result.error?.message || result.signal || 'no exit status'}`);
    error.childResult = result;
    throw error;
  }
  return result;
};

export const applyPatches = (cwd = process.cwd()) => {
  const root = fs.realpathSync(cwd);
  try { fs.lstatSync(path.join(root, 'patches')); } catch (error) {
    if (error.code === 'ENOENT') return 0;
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
      if (!entry.isFile()) throw new Error(`Patch must be a regular file: ${entry.name}`);
      names.push(entry.name);
      if (names.length > MAX_PATCHES) throw new Error('Too many package patches.');
    }
  } finally { directory.closeSync(); }
  if (!names.length) return 0;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-package-patches-'));
  try {
    // Git for Windows rejects Node's device path (\\.\nul). A private empty
    // regular file disables user configuration consistently on every platform.
    fs.writeFileSync(path.join(stage, 'empty.gitconfig'), '', { flag: 'wx', mode: 0o600 });
    const prepared = [];
    const targets = new Set();
    let totalBytes = 0;
    for (const name of names.sort()) {
      const patch = parsePatch(name, readBounded(checkedPath(root, `patches/${name}`), MAX_PATCH_BYTES));
      const packageJsonPath = checkedPath(root, `node_modules/${patch.packageName}/package.json`);
      const installed = JSON.parse(decodeText(readBounded(packageJsonPath, MAX_PATCH_BYTES)));
      if (installed.name !== patch.packageName || installed.version !== patch.version) {
        throw new Error(`${name} requires exactly ${patch.packageName}@${patch.version}; found ${installed.name}@${installed.version}`);
      }
      const target = checkedPath(root, patch.relative);
      if (targets.has(target.toLowerCase())) throw new Error(`Multiple patches target the same file: ${patch.relative}`);
      targets.add(target.toLowerCase());
      const before = readBounded(target, MAX_FILE_BYTES);
      totalBytes += before.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Package patches exceed total input size limit.');
      const source = decodeText(before);
      const crlf = source.includes('\r\n');
      if (crlf && /(^|[^\r])\n/.test(source)) throw new Error(`Mixed line endings are unsupported: ${patch.relative}`);
      fs.writeFileSync(path.join(stage, 'target'), source.replace(/\r\n/g, '\n'));
      const forward = runGit(stage, patch.patch, ['--check']);
      if (forward.status !== 0) {
        const reverse = runGit(stage, patch.patch, ['--reverse', '--check']);
        if (reverse.status !== 0) {
          throw new Error(`Required patch ${name} cannot apply and is not fully applied:\n${forward.stderr.trim()}`);
        }
        prepared.push({ ...patch, target, before, after: null });
        continue;
      }
      const result = runGit(stage, patch.patch, []);
      if (result.status !== 0) throw new Error(`Failed to apply ${name}: ${result.stderr.trim()}`);
      const afterText = decodeText(readBounded(path.join(stage, 'target'), MAX_FILE_BYTES));
      const after = Buffer.from(crlf ? afterText.replace(/\n/g, '\r\n') : afterText);
      if (before.equals(after) || runGit(stage, patch.patch, ['--reverse', '--check']).status !== 0) {
        throw new Error(`Required patch was not completely applied: ${name}`);
      }
      prepared.push({ ...patch, target, before, after });
    }
    // Validate all patches first, then recheck paths and bytes before publishing.
    for (const item of prepared) {
      checkedPath(root, item.relative);
      if (!readBounded(item.target, MAX_FILE_BYTES).equals(item.before)) {
        throw new Error(`Package file changed during patch validation: ${item.target}`);
      }
    }
    for (const item of prepared) {
      if (item.after) {
        const temporary = fs.mkdtempSync(path.join(path.dirname(item.target), '.poc-patch-'));
        try {
          const staged = path.join(temporary, 'target');
          fs.writeFileSync(staged, item.after, { mode: fs.statSync(item.target).mode & 0o777 });
          fs.renameSync(staged, item.target);
        } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
      }
      console.log(`[patches] ${item.name}: ${item.after ? 'applied' : 'already applied'}`);
    }
    return prepared.length;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
};

export const exitPatchFailure = (error) => {
  console.error(`[patches] ${error.message}`);
  if (error.childResult) exitLikeChildResult(error.childResult);
  else process.exit(1);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/setup/apply-patches.js');
    if (!applyPatches()) console.log('[patches] no patch files found; skipping patch step.');
  } catch (error) { exitPatchFailure(error); }
}
