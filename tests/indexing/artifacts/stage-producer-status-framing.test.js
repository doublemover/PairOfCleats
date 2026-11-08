import assert from 'node:assert/strict';
import { readProducerStatus } from '../../../src/index/build/stage-provenance.js';

const revision = 'a'.repeat(40), object = 'b'.repeat(40);
const header = '# branch.oid ' + revision + '\0# branch.head main\0';
const ordinary = '1 .M N... 100644 100644 100644 ' + object + ' ' + object + ' ';
const rename = '2 R. N... 100644 100644 100644 ' + object + ' ' + object + ' R100 ';
const conflict = 'u UU N... 100644 100644 100644 100644 ' + object + ' ' + object + ' ' + object + ' ';
assert.deepEqual(readProducerStatus(header), { revision, clean: true, untracked: [] });
assert.deepEqual(readProducerStatus(header + ordinary + 'src/with\nnewline.js\0'
  + rename + 'src/target.js\0? src/old-name-is-not-untracked.js\0'
  + conflict + 'src/conflict.js\0? src/with\nnewline-untracked.js\0? src/space Unicode-λ.js\0'), {
  revision, clean: false, untracked: ['src/with\nnewline-untracked.js', 'src/space Unicode-λ.js']
});
assert.deepEqual(readProducerStatus(header + '# branch.upstream origin/main\0# branch.ab +2 -1\0'), {
  revision, clean: true, untracked: []
});
assert.deepEqual(readProducerStatus('# branch.oid ' + 'c'.repeat(64) + '\0# branch.head (detached)\0'), {
  revision: 'c'.repeat(64), clean: true, untracked: []
});
for (const malformed of [
  '', header.slice(0, -1), header + '\0', header + '? \0', header + '! ignored.js\0',
  header + rename + 'src/target.js\0', header + rename + 'src/target.js\0\0',
  header + ordinary.replace('.M', ' M') + 'src/file.js\0',
  header + ordinary.replace('100644', '100649') + 'src/file.js\0',
  header + '# branch.oid ' + revision + '\0', header + '# branch.head duplicate\0',
  header.replace(revision, '(initial)'), header + '# unknown extension\0',
  header.replace('branch.head main', 'branch.head invalid branch'),
  header.replace('branch.head main\0', ''), header + '1 partial\0'
]) assert.throws(() => readProducerStatus(malformed), /Invalid implementation Git status/);
console.log('Producer status validates NUL framing and consumes both rename paths without losing Unicode/newline membership.');
