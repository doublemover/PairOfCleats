import { resolveDevelopmentArtifactPath } from '../../tools/shared/dev-artifacts.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withDirectoryLock } from './directory-lock.js';

/** The release CLI consumes fixed dist paths; fixtures must share their owner. */
export const withReleaseArchiveFixture = async (callback) => {
  const root = process.cwd();
  const cache = resolveDevelopmentArtifactPath(root, 'test-cache');
  await fs.mkdir(cache, { recursive: true });
  return withDirectoryLock(path.join(cache, 'release-editor-archives'), async () => {
    const snapshots = [];
    for (const relative of ['dist/vscode/pairofcleats.vsix', 'dist/sublime/pairofcleats.sublime-package']) {
      for (const filename of [path.join(root, relative), path.join(root, relative + '.manifest.json')]) {
        try { snapshots.push([filename, await fs.readFile(filename)]); }
        catch (error) { if (error.code !== 'ENOENT') throw error; snapshots.push([filename, null]); }
      }
    }
    try { return await callback(); }
    finally {
      for (const [filename, bytes] of snapshots) {
        if (bytes === null) await fs.rm(filename, { force: true });
        else await fs.writeFile(filename, bytes);
      }
    }
  }, { maxWaitMs: 5000, staleMs: 60000 });
};
