import fs from 'node:fs/promises';
import path from 'node:path';
import { publishIndexStateMutation } from '../../../src/shared/index-state-publication.js';
import { updateLmdbState } from '../../../src/storage/lmdb/index-state.js';

// Explicit fixture command; no database/model, shell, links or child processes.
const [root, kind] = process.argv.slice(2);
if (!path.isAbsolute(root || '') || !['holder', 'lmdb'].includes(kind)) throw new Error('Invalid fixture invocation.');
try {
  if (kind === 'holder') {
    await publishIndexStateMutation(root, async state => {
      state.sqlite = { ...state.sqlite, fromChild: true };
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { process.off('message', commit); reject(new Error('Fixture commit deadline')); }, 5000);
        const commit = message => { clearTimeout(timer); if (message !== 'commit') reject(new Error('Invalid commit message')); else resolve(); };
        process.once('message', commit); process.send('holding');
      });
    });
  } else {
    const original = fs.open; let observed = false;
    const lockPath = path.join(root, '.index_state.write.lock');
    fs.open = async (file, ...args) => {
      try { return await original(file, ...args); }
      catch (error) {
        if (!observed && file === lockPath && error.code === 'EEXIST') { observed = true; process.send('contended'); }
        throw error;
      }
    };
    try { await updateLmdbState(root, { fromChild: true }); }
    finally { fs.open = original; }
  }
  process.send('done');
} finally {
  process.disconnect();
}
