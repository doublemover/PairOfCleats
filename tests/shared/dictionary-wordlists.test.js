#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addDictionaryWordsFromText,
  collectDictionaryFileSignatures,
  loadCodeDictionaryWordSets,
  loadDictionaryWordSetFromFiles
} from '../../src/shared/dictionary-wordlists.js';

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-dict-wordlists-'));

try {
  const baseA = path.join(tmpRoot, 'dict-a.txt');
  const baseB = path.join(tmpRoot, 'dict-b.txt');
  await fs.writeFile(baseA, 'Alpha\n Beta \r\n\nGamma', 'utf8');
  await fs.writeFile(baseB, 'beta\nDELTA\n', 'utf8');

  const mixedCase = await loadDictionaryWordSetFromFiles([baseA, baseB], { lowerCase: false });
  assert.deepEqual(
    Array.from(mixedCase).sort(),
    ['Alpha', 'Beta', 'DELTA', 'Gamma', 'beta'].sort()
  );

  const lowerCased = await loadDictionaryWordSetFromFiles([baseA, baseB], { lowerCase: true });
  assert.deepEqual(
    Array.from(lowerCased).sort(),
    ['alpha', 'beta', 'delta', 'gamma'].sort()
  );

  const fromSinglePathString = await loadDictionaryWordSetFromFiles(baseA, { lowerCase: true });
  assert.deepEqual(
    Array.from(fromSinglePathString).sort(),
    ['alpha', 'beta', 'gamma'],
    'expected string file path input to be treated as a single dictionary file'
  );

  const textOnly = addDictionaryWordsFromText('  One \nTwo\r\n\nTHREE ', new Set(), { lowerCase: true });
  assert.deepEqual(Array.from(textOnly).sort(), ['one', 'three', 'two']);

  const signatureRows = await collectDictionaryFileSignatures(
    [baseA, path.join(tmpRoot, 'missing.txt')],
    {
      toSignaturePath: (filePath) => path.basename(filePath),
      prefix: 'dict:'
    }
  );
  assert.equal(signatureRows.length, 2);
  assert(signatureRows.some((row) => /^dict:dict-a\.txt:\d+:\d+(\.\d+)?$/.test(row)));
  assert(signatureRows.some((row) => row === 'dict:missing.txt:missing'));

  const common = path.join(tmpRoot, 'code-common.txt');
  const jsWords = path.join(tmpRoot, 'code-js.txt');
  await fs.writeFile(common, 'Common\n Alpha \n', 'utf8');
  await fs.writeFile(jsWords, 'One\nTwo\n', 'utf8');
  const codeWordSets = await loadCodeDictionaryWordSets({
    commonFiles: [common],
    byLanguage: new Map([
      ['javascript', [jsWords]],
      ['python', [path.join(tmpRoot, 'missing-lang.txt')]]
    ]),
    lowerCase: true
  });
  assert.deepEqual(Array.from(codeWordSets.commonWords).sort(), ['alpha', 'common']);
  assert.deepEqual(Array.from(codeWordSets.wordsByLanguage.keys()), ['javascript']);
  assert.deepEqual(Array.from(codeWordSets.wordsByLanguage.get('javascript')).sort(), ['one', 'two']);
  assert.deepEqual(
    Array.from(codeWordSets.allWords).sort(),
    ['alpha', 'common', 'one', 'two']
  );

  console.log('dictionary wordlists test passed');
} finally {
  await fs.rm(tmpRoot, { recursive: true, force: true });
}
