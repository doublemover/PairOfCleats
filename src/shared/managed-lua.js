import fs from 'node:fs';
import path from 'node:path';
import { assertNoSymlinkPath } from './contained-file.js';
import { readManagedToolText } from './managed-tool-file.js';

export const resolveManagedLuaLanguageServer = toolingRoot => {
  if (!toolingRoot) return null;
  const owner = path.join(path.resolve(toolingRoot), 'servers', 'lua-language-server');
  try {
    const receipt = JSON.parse(readManagedToolText(path.join(owner, 'current.json')));
    if (receipt.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/u.test(receipt.generation || '')) return null;
    const root = path.join(owner, receipt.generation);
    const command = path.join(root, 'bin', process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server');
    const mainLuaPath = path.join(root, 'bin', 'main.lua');
    for (const file of [command, mainLuaPath]) {
      assertNoSymlinkPath(owner, file);
      const stat = fs.statSync(file);
      if (!stat.isFile() || !stat.size) return null;
    }
    return { root, command, mainLuaPath, binDir: path.dirname(command) };
  } catch { return null; }
};
