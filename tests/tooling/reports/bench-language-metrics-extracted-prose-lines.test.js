#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLineStats } from '../../../tools/bench/language/metrics.js';

const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'bench-extracted-prose-lines-'));
const repoRoot = path.join(tmpRoot, 'repo');
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'docs'), { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'code.js'),
  [
    '/**',
    ' * alpha bravo charlie delta echo foxtrot',
    ' * ```json',
    ' * {"enabled": true}',
    ' * ```',
    ' */',
    'const value = 1;',
    ''
  ].join('\n')
);
await fsPromises.writeFile(
  path.join(repoRoot, 'docs', 'notes.md'),
  [
    '# Notes',
    '<!-- prose comment sentinel phrase -->',
    'Body text not indexed.',
    ''
  ].join('\n')
);
await fsPromises.writeFile(
  path.join(repoRoot, 'docs', 'frontmatter.md'),
  [
    '---',
    'title: Fixture',
    'tags: [bench]',
    '---',
    'Body prose only.',
    ''
  ].join('\n')
);
await fsPromises.writeFile(
  path.join(repoRoot, 'docs', 'plain.md'),
  [
    '# Plain',
    'Just prose body text.',
    ''
  ].join('\n')
);

const stats = await buildLineStats(repoRoot, {
  indexing: {
    comments: {
      extract: 'all',
      minDocChars: 1,
      minInlineChars: 1,
      minTokens: 1
    }
  }
});

const extractedByFile = stats.linesByFile['extracted-prose'];
assert.equal(extractedByFile.get('src/code.js'), 6, 'expected doc comment + fenced config to dedupe to 6 lines');
assert.equal(extractedByFile.get('docs/notes.md'), 1, 'expected markdown comment line to count');
assert.equal(extractedByFile.get('docs/frontmatter.md'), 4, 'expected markdown frontmatter fence block to count');
assert.equal(extractedByFile.get('docs/plain.md'), 0, 'expected plain markdown body text to be excluded');
assert.equal(stats.totals['extracted-prose'], 11, 'unexpected extracted-prose total');

await fsPromises.rm(tmpRoot, { recursive: true, force: true });

console.log('bench extracted-prose line stats test passed');
