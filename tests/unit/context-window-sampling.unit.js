import assert from 'node:assert/strict';
import { selectContextWindowSample } from '../../src/index/build/context-window.js';

for (const input of [
  [],
  ['z.js', 'a.js', 'B.js', 'é.js', '😀.js'],
  Array.from({ length: 75 }, (_, index) => `src/${74 - index}.js`),
  Array.from({ length: 75 }, (_, index) => `src/${index % 11}.js`)
]) {
  const before = input.slice();
  assert.deepEqual(selectContextWindowSample(input), [...input].sort().slice(0, 20));
  assert.deepEqual(input, before, 'sampling must not mutate discovery order');
}
assert.deepEqual(selectContextWindowSample(null), []);
console.log('bounded context-window sampling test passed');
