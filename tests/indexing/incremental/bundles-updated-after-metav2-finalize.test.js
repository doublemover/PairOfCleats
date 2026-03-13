#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pipelinePath = path.join(root, 'src', 'index', 'build', 'indexer', 'pipeline.js');
const source = fs.readFileSync(pipelinePath, 'utf8');

const writeCall = 'await writeIndexArtifactsForMode(';
const updateCall = 'await updateIncrementalBundles(';

const writeIndex = source.indexOf(writeCall);
const updateIndex = source.indexOf(updateCall);

if (writeIndex < 0) {
  console.error(`Expected pipeline to contain "${writeCall}".`);
  process.exit(1);
}
if (updateIndex < 0) {
  console.error(`Expected pipeline to contain "${updateCall}".`);
  process.exit(1);
}
if (updateIndex <= writeIndex) {
  console.error(
    'Expected incremental bundle refresh to run after artifact write/finalization ' +
    '(prevents stale metaV2 in incremental bundles).'
  );
  process.exit(1);
}

console.log('incremental bundle update ordering against metaV2 finalization ok.');
