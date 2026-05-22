#!/usr/bin/env node
import path from 'node:path';
import * as helper from './download-dicts-test-helper.js';

const { tempRoot, sourceFile, sourceHash } = await helper.setupDownloadDictsTest('download-dicts-partial-failure');
const server = await helper.startWordsServer(sourceFile);
let result;
try {
  result = await helper.runDownloadDicts([
    '--url',
    `ok=${server.url}`,
    '--sha256',
    `ok=${sourceHash}`,
    '--url',
    `bad=${server.baseUrl}/missing.txt`,
    '--lang',
    'test',
    '--dir',
    tempRoot,
    '--force'
  ], { logName: 'download-dicts-partial-failure' });
} finally {
  await server.close();
}

if (result.code === 0) {
  console.error('download-dicts partial failure test failed: expected non-zero exit code.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const okPath = path.join(tempRoot, 'ok.txt');
await helper.assertFileIncludes(okPath, 'alpha', {
  missingMessage: `download-dicts partial failure test failed: missing ${okPath}`,
  mismatchMessage: 'download-dicts partial failure test failed: downloaded content mismatch.'
});

const manifestPath = path.join(tempRoot, 'dictionaries.json');
const manifest = await helper.readRequiredJson(manifestPath, 'download-dicts partial failure test failed: manifest missing.');
if (!manifest.ok || manifest.bad) {
  console.error('download-dicts partial failure test failed: unexpected manifest entries.');
  process.exit(1);
}

console.log('download-dicts partial failure exit-code test passed');
