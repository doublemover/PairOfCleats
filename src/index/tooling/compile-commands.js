import fsSync from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../../shared/files.js';

export const resolveCompileCommandsDir = (rootDir, clangdConfig) => {
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
  for (const dir of candidates) {
    const candidate = path.join(dir, 'compile_commands.json');
    if (fsSync.existsSync(candidate)) return dir;
  }
  return null;
};
