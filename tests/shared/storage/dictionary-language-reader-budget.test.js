// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { loadCodeDictionaryWordSets } from '../../../src/shared/dictionary-wordlists.js';
import { registerDictionaryStorageRoot } from '../../../src/shared/storage/dictionary-access.js';

const temporary = await makeTempDir('dictionary-language-reader-budget-');
const originalCreate = fsSync.createReadStream;
let releaseReads;
let loading;
try {
  const home = path.join(temporary, 'home');
  const root = path.join(home, 'dictionaries');
  await fs.mkdir(root, { recursive: true });
  applyTestEnv({ cacheRoot: home, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_DICT_DIR: root } });
  registerDictionaryStorageRoot(root);
  const files = [];
  for (let index = 0; index < 13; index++) {
    const file = path.join(root, `${index}.txt`);
    await fs.writeFile(file, `Word${index}\n`);
    files.push(file);
  }
  const gate = new Promise(resolve => { releaseReads = resolve; });
  let eightStarted;
  const started = new Promise(resolve => { eightStarted = resolve; });
  let active = 0, peak = 0, opened = 0;
  fsSync.createReadStream = (...args) => {
    const stream = originalCreate(...args);
    active++;
    peak = Math.max(peak, active);
    const destroy = stream.destroy.bind(stream);
    stream.destroy = error => { gate.then(() => destroy(error)); return stream; };
    stream.once('close', () => { active--; });
    stream.once('open', () => { opened++; if (opened === 8) eightStarted(); });
    return stream;
  };
  loading = loadCodeDictionaryWordSets({ commonFiles: [files[0]],
    byLanguage: new Map(files.slice(1).map((file, index) => [`language-${index}`, [file]])) });
  await started;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(peak, 8, 'common and every language scope share the same bounded native reader budget');
  assert.equal(opened, 8, 'queued languages wait for actual earlier stream closure');
  releaseReads();
  const loaded = await loading;
  assert.equal(active, 0);
  assert.equal(peak, 8);
  assert.equal(loaded.wordsByLanguage.size, 12);
  assert.equal(loaded.commonWords.has('word0'), true);
  assert.equal(loaded.allWords.size, 13);
} finally {
  releaseReads?.();
  if (loading) await loading.catch(() => {});
  fsSync.createReadStream = originalCreate;
  await rmDirRecursive(temporary);
}
console.log('Code dictionary common/language reads share one native-reader budget.');
