#!/usr/bin/env node
import { filterChunks } from '../src/search/output.js';

const meta = [
  {
    id: 0,
    kind: 'FunctionDeclaration',
    last_author: 'Alice',
    docmeta: { signature: 'foo(bar)', params: ['bar'] },
    codeRelations: { calls: [['foo', 'fetch']], usages: ['config'] }
  },
  {
    id: 1,
    kind: 'FunctionDeclaration',
    docmeta: {},
    codeRelations: {}
  },
  {
    id: 2,
    kind: 'ClassDeclaration',
    last_author: 'Bob',
    docmeta: { signature: 'baz()', params: ['baz'] },
    codeRelations: { calls: [['baz', 'other']], usages: ['other'] }
  },
  {
    id: 3,
    docmeta: {},
    codeRelations: {}
  },
  {
    id: 4,
    kind: ['FunctionDeclaration', 'MethodDefinition'],
    last_author: ['Carol', 'Dana'],
    docmeta: { signature: 'qux()', params: ['qux'] },
    codeRelations: {}
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
expectIds({ type: 'FunctionDeclaration' }, [0, 1, 4], 'type filter strict');
expectIds({ type: 'FunctionDeclaration ClassDeclaration' }, [0, 1, 2, 4], 'type multi filter');
expectIds({ author: 'Alice' }, [0], 'author filter strict');
expectIds({ author: 'car' }, [4], 'author filter substring');

console.log('filter strictness test passed');
