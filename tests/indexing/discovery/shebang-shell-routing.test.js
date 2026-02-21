#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { discoverEntries, discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'discover-shebang-shell');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'scripts'), { recursive: true });

await fs.writeFile(
  path.join(tempRoot, 'scripts', 'rebuild'),
  '#!/usr/bin/env bash\necho "rebuild"\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'scripts', 'deploy'),
  '#!/usr/bin/env zsh\necho "deploy"\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'scripts', 'lint'),
  '#!/bin/sh\necho "lint"\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'scripts', 'notes'),
  'this is prose-like text without a shebang\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'scripts', 'snippet'),
  '  #!/usr/bin/env bash\necho "snippet"\n',
  'utf8'
);

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });
const entries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  ignoreMatcher,
  skippedFiles: [],
  maxFileBytes: null
});

const rels = entries.map((entry) => entry.rel);
assert.equal(rels.includes('scripts/rebuild'), true, 'expected shebang shell script to route into code discovery');
assert.equal(rels.includes('scripts/deploy'), true, 'expected zsh shebang shell script to route into code discovery');
assert.equal(rels.includes('scripts/lint'), true, 'expected sh shebang shell script to route into code discovery');
assert.equal(rels.includes('scripts/notes'), false, 'expected non-shebang extensionless file to stay out of code discovery');
assert.equal(rels.includes('scripts/snippet'), false, 'expected indented shebang snippet to stay out of code discovery');

const discovered = await discoverEntries({
  root: tempRoot,
  ignoreMatcher,
  maxFileBytes: null
});
const scriptEntry = discovered.entries.find((entry) => entry.rel === 'scripts/rebuild');
assert.equal(scriptEntry?.ext, '.sh', 'expected shebang-routed shell entry to use canonical .sh extension');
const zshEntry = discovered.entries.find((entry) => entry.rel === 'scripts/deploy');
assert.equal(zshEntry?.ext, '.sh', 'expected zsh shebang-routed entry to use canonical .sh extension');
const shEntry = discovered.entries.find((entry) => entry.rel === 'scripts/lint');
assert.equal(shEntry?.ext, '.sh', 'expected sh shebang-routed entry to use canonical .sh extension');
const snippetEntry = discovered.entries.find((entry) => entry.rel === 'scripts/snippet');
assert.ok(snippetEntry, 'expected indented shebang snippet to be discovered as an entry');
assert.equal(snippetEntry.ext, '', 'expected indented shebang snippet to keep empty extension');

console.log('discover shebang shell routing test passed');
