import assert from 'node:assert/strict';
import { normalizeRepoRelativePath } from '../../src/shared/path-normalize.js';
import { parseSeedRef } from '../../src/shared/seed-ref.js';

for (const [root, input, expected] of [
  ['/work/repo', '/work/repo/src/a.js', 'src/a.js'],
  ['/work/repo', '/work/Repo/src/a.js', null],
  ['/work/repo', '/WORK/repo/src/a.js', null],
  ['/work/repo', 'src/Ünicode.js', 'src/Ünicode.js'],
  ['/work/repo', '/work/repo/Src/a.js', 'Src/a.js'],
  ['C:\\work\\repo', 'c:\\WORK\\repo\\src\\a.js', 'src/a.js'],
  ['C:\\work\\repo', '\\work\\repo\\src\\a.js', 'src/a.js'],
  ['\\\\server\\share\\repo', '\\\\SERVER\\SHARE\\repo\\a.js', 'a.js'],
  ['//server/share/repo', '//SERVER/SHARE/repo/a.js', 'a.js']
]) assert.equal(normalizeRepoRelativePath(input, root), expected, `${root} <- ${input}`);
assert.equal(normalizeRepoRelativePath('src/a.js', 'relative/repo', { platform: 'posix' }), 'src/a.js');
assert.equal(normalizeRepoRelativePath('src\\a.js', 'relative\\repo', { platform: 'win32' }), 'src/a.js');
assert.throws(() => parseSeedRef('file:/work/Repo/src/a.js', '/work/repo'), /repo-relative/);
console.log('path normalization flavor test passed');
