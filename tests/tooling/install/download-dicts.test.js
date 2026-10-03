#!/usr/bin/env node
import path from 'node:path';
import * as helper from './download-dicts-test-helper.js';

const { tempRoot, sourceFile, sourceHash } = await helper.setupDownloadDictsTest('download-dicts');
const server = await helper.startWordsServer(sourceFile);
const { url } = server;
let result;
try {
  result = await helper.runDownloadDicts([
    '--url',
    `test=${url}`,
    '--sha256',
    `test=${sourceHash}`,
    '--lang',
    'test',
    '--dir',
    tempRoot,
    '--force'
  ], { logName: 'download-dicts' });
} finally {
  await server.close();
}

if (result.code !== 0) {
  console.error('download-dicts test failed: script error.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.code ?? 1);
}

const dictPath = path.join(tempRoot, 'test.txt');
await helper.assertFileIncludes(dictPath, 'alpha', {
  missingMessage: `download-dicts test failed: missing ${dictPath}`,
  mismatchMessage: 'download-dicts test failed: content mismatch.'
});

const manifestPath = path.join(tempRoot, 'dictionaries.json');
const manifest = await helper.readRequiredJson(manifestPath, 'download-dicts test failed: manifest missing.');
if (!manifest.test || manifest.test.url !== url || manifest.test.file !== 'test.txt') {
  console.error('download-dicts test failed: manifest entry mismatch.');
  process.exit(1);
}
if (manifest.test.sha256 !== sourceHash || manifest.test.verified !== true) {
  console.error('download-dicts test failed: hash verification missing.');
  process.exit(1);
}

console.log('download-dicts test passed');

