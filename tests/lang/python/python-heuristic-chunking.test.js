#!/usr/bin/env node
import { buildPythonHeuristicChunks } from '../../../src/lang/python.js';

const sample = [
  'class Foo:',
  '    def method(self):',
  '        pass',
  '',
  'def top():',
  '    pass',
  '',
  'async def later():',
  '    pass'
].join('\n');

const chunks = buildPythonHeuristicChunks(sample) || [];
const byName = Object.fromEntries(chunks.map((chunk) => [chunk.name, chunk]));

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

expect(byName.Foo, 'Missing class chunk for Foo.');
expect(byName['Foo.method'], 'Missing method chunk for Foo.method.');
expect(byName.top, 'Missing function chunk for top.');
expect(byName.later, 'Missing function chunk for later.');

expect(byName.Foo.meta.startLine === 1, 'Foo startLine mismatch.');
expect(byName.Foo.meta.endLine === 5, 'Foo endLine mismatch.');
expect(byName['Foo.method'].meta.startLine === 2, 'Foo.method startLine mismatch.');
expect(byName['Foo.method'].meta.endLine === 5, 'Foo.method endLine mismatch.');
expect(byName.top.meta.startLine === 5, 'top startLine mismatch.');
expect(byName.top.meta.endLine === 8, 'top endLine mismatch.');
expect(byName.later.meta.startLine === 8, 'later startLine mismatch.');
expect(byName.later.meta.endLine === 9, 'later endLine mismatch.');

console.log('Python heuristic chunking test passed.');
