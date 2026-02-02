import fsSync from 'node:fs';
import path from 'node:path';

const unsupported = { ok: false, reason: 'unsupported' };

export const jjProvider = {
  name: 'jj',
  detect({ startPath }) {
    const repoRoot = findJjRoot(startPath || process.cwd());
    return repoRoot ? { ok: true, provider: 'jj', repoRoot, detectedBy: 'jj-root' } : { ok: false };
  },
  listTrackedFiles() {
    return unsupported;
  },
  getRepoProvenance({ repoRoot }) {
    return {
      provider: 'jj',
      root: repoRoot,
      head: null,
      dirty: null,
      detectedBy: 'jj-root'
    };
  },
  getChangedFiles() {
    return unsupported;
  },
  getFileMeta() {
    return unsupported;
  },
  annotate() {
    return { ok: false, reason: 'disabled' };
  }
};

const findJjRoot = (startPath) => {
  let current = path.resolve(startPath || process.cwd());
  while (true) {
    const jjPath = path.join(current, '.jj');
    if (fsSync.existsSync(jjPath)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};
