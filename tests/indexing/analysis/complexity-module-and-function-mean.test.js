#!/usr/bin/env node
import assert from 'node:assert/strict';
import { analyzeComplexity } from '../../../src/index/analysis.js';

const cases = [
  ['function a(x){if(x)return 1;return 0;} function b(x){if(x)return 1;return 0;}', 2, 2],
  ['function a(x){if(x)return 1;return 0;} function b(){return 0;}', 2, 1.5],
  ['function a(){return 0;}', 1, 1],
  ['function a(){return 0;} if (flag) run();', 1, 1],
  ['function a(){function b(x){if(x)return 1;return 0;} return b(true);}', 2, 1.5],
  ['if(flag) run();', 0, 0],
  ['', 0, 0]
];
for (const [source, functions, averageCyclomatic] of cases) {
  const result = await analyzeComplexity(source);
  assert.equal(result.status, 'measured');
  assert.equal(result.functions, functions);
  assert.equal(result.averageCyclomatic, averageCyclomatic);
}
for (const source of [
  'export function a(x){if(x)return 1;return 0;}',
  'export default function a(x){if(x)return 1;return 0;}',
  'import {value} from "pkg"; function a(x){if(x)return value;return 0;} export {a};',
  'export default function(x){if(x)return 1;return 0;}'
]) {
  const value = await analyzeComplexity(source);
  assert.equal(value.status, 'measured'); assert.equal(value.functions, 1); assert.equal(value.averageCyclomatic, 2);
}
for (const source of ['export function broken(', 'const arrow = x => x ? 1 : 0;', 'class A { method() {} }']) {
  const value = await analyzeComplexity(source);
  assert.equal(value.status, 'unavailable');
  assert.equal(Object.hasOwn(value, 'averageCyclomatic'), false, 'failed/unsupported analysis cannot claim measured zero');
}
console.log('complexity supports module declarations and measures the function mean');
