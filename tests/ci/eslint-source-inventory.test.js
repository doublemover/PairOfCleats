import assert from 'node:assert/strict';
import path from 'node:path';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });
for (const filename of ['tests/tooling/index-stats/all-manifest-byte-accounting.test.js',
  'tests/tooling/index-stats/symbol-family-logical-counts.test.js', 'tools/index/stats.js', 'src/shared/language-aliases.js']) {
  assert.equal(await eslint.isPathIgnored(path.resolve(filename)), false, `${filename} is real source, not an index cache`);
}
for (const filename of ['index-code/generated.js', 'index-prose/generated.js', '.tmp/tasks/index-code/generated.js',
  'tests/.cache/index-code/generated.js', 'node_modules/package/generated.js']) {
  assert.equal(await eslint.isPathIgnored(path.resolve(filename)), true, `${filename} remains outside source formatting`);
}
console.log('Formatting admits tracked index-tool fixtures while retaining actual cache/output exclusions.');
