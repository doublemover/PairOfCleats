#!/usr/bin/env node
import { sortImportScanItems } from '../src/index/build/imports.js';

const items = [
  { relKey: 'a', stat: { size: 100 }, index: 0 },
  { relKey: 'b', stat: { size: 1000 }, index: 1 },
  { relKey: 'c', stat: { size: 2000 }, index: 2 },
  { relKey: 'd', stat: { size: 150 }, index: 3 }
];

const counts = new Map([
  ['a', 10],
  ['b', 5],
  ['d', 10]
]);

sortImportScanItems(items, counts);
const order = items.map((item) => item.relKey).join(',');

if (order !== 'd,a,b,c') {
  console.error(`import priority test failed: got ${order}`);
  process.exit(1);
}

console.log('import priority test passed');
