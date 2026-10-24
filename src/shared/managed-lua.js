import fs from 'node:fs';
import path from 'node:path';
import { assertNoSymlinkPath, readVerifiedContainedFileSync } from './contained-file.js';

/** Existing Lua selection metadata only; present does not mean protocol ready. */
export const readManagedLuaSelection = toolingRoot => {
  const owner = path.join(path.resolve(toolingRoot), 'servers', 'lua-language-server');
  const target = path.join(owner, 'current.json');
  let opened = false;
  try {
    const read = readVerifiedContainedFileSync(path.parse(target).root, target, { maxBytes: 64 * 1024 });
    opened = true;
    const value = JSON.parse(read.buffer.toString('utf8'));
    if (!value || Object.keys(value).sort().join(',') !== 'generation,schemaVersion,sha256' || value.schemaVersion !== 1
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value.generation || '')
      || !/^[a-f0-9]{64}$/u.test(value.sha256 || '')) throw new Error('Lua selection has invalid or unknown retained metadata.');
    return { status: 'present', target, owner, root: path.join(owner, value.generation), value, sha256: read.hash };
  } catch (error) {
    if (!opened && error.code === 'ENOENT') return { status: 'missing', target, owner, value: null, sha256: null };
    return { status: 'invalid', target, owner, value: null, sha256: null,
      error: { code: error.code || 'ERR_LUA_SELECTION', message: error.message } };
  }
};

export const resolveManagedLuaLanguageServer = toolingRoot => {
  if (!toolingRoot) return null;
  try {
    const selected = readManagedLuaSelection(toolingRoot);
    if (selected.status !== 'present') return null;
    const { root, owner } = selected;
    const command = path.join(root, 'bin', process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server');
    const mainLuaPath = path.join(root, 'bin', 'main.lua');
    for (const file of [command, mainLuaPath]) {
      assertNoSymlinkPath(owner, file);
      const stat = fs.statSync(file);
      if (!stat.isFile() || !stat.size) return null;
      if (process.platform !== 'win32' && file === command && (stat.mode & 0o111) === 0) return null;
    }
    return { root, command, mainLuaPath, binDir: path.dirname(command) };
  } catch { return null; }
};
