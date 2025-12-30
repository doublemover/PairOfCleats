#!/usr/bin/env node
import { filterChunks } from '../src/search/output.js';

const meta = [
  {
    id: 0,
    kind: 'function',
    docmeta: { signature: 'foo(bar)', params: ['bar'] },
    codeRelations: { calls: [['foo', 'fetch']], usages: ['config'] }
  },
  {
    id: 1,
    kind: 'function',
    docmeta: {},
    codeRelations: {}
  },
  {
    id: 2,
    kind: 'function',
    docmeta: { signature: 'baz()', params: ['baz'] },
    codeRelations: { calls: [['baz', 'other']], usages: ['other'] }
  }
];

const expectIds = (filters, expected, label) => {
  const result = filterChunks(meta, filters).map((entry) => entry.id).sort();
  const expectedSorted = expected.slice().sort();
  const ok = result.length === expectedSorted.length
    && result.every((value, idx) => value === expectedSorted[idx]);
  if (!ok) {
    console.error(`${label} failed: expected [${expectedSorted.join(', ')}], got [${result.join(', ')}]`);
    process.exit(1);
  }
};

expectIds({ signature: 'foo' }, [0], 'signature filter');
expectIds({ param: 'bar' }, [0], 'param filter');
expectIds({ calls: 'fetch' }, [0], 'calls filter');
expectIds({ uses: 'config' }, [0], 'uses filter');

console.log('filter strictness test passed');
