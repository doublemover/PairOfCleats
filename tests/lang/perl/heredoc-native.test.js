import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { buildPerlChunks } from '../../../src/lang/perl.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');
const language = require('@ganezdragon/tree-sitter-perl');
const samples = [
  ["'END'", 'plain\nmore literal'],
  ["'END'", '$END\n\\END\nEND trailing\nEND \nsub fake { die "literal"; }'],
  ['"END"', '$value\nmore literal'],
  ['END', '$value\nmore literal'],
  ['\\END', '$END\n\\END']
];
const inspect = (parser, source, expected, oldTree = null) => {
  const tree = parser.parse(source, oldTree);
  assert.equal(tree.rootNode.hasError, false, tree.rootNode.toString());
  assert.deepEqual(tree.rootNode.descendantsOfType('heredoc_end_identifier').map(n => [n.startIndex, n.text]), expected,
    'only complete delimiter lines may end a heredoc');
  return tree;
};
const parser = new Parser(); parser.setLanguage(language);
try {
  for (const [delimiter, body] of samples) {
    const source = `my $x = <<${delimiter};\n${body}\nEND\nsub actual { return $x; }\n`;
    const expected = [[source.lastIndexOf('\nEND\n') + 1, 'END']];
    for (let i = 0; i < 3; i++) {
      parser.reset();
      const tree = inspect(parser, source, expected);
      assert.equal(tree.rootNode.descendantsOfType('function_definition').length, 1,
        'literal declarations must not escape the heredoc body');
      tree.delete?.();
    }
    const productionParser = getNativeTreeSitterParser('perl');
    assert.ok(productionParser, 'the production route must activate the real grammar');
    inspect(productionParser, source, expected).delete?.();
    const chunks = buildPerlChunks(source, { treeSitter: { enabled: true, chunkCache: false } });
    assert.equal(chunks.filter(c => c.kind === 'FunctionDeclaration').length, 1);
    assert.ok(chunks.some(c => c.name === 'actual'));
    assert.ok(!chunks.some(c => c.name === 'fake'));
  }
  const mixed = "my ($a, $b) = (<<~'FIRST', <<'SECOND');\n  one\n  FIRST\n  SECOND\nSECOND\nsub actual { return $a; }\n";
  inspect(parser, mixed, [[mixed.indexOf('  FIRST\n'), '  FIRST'], [mixed.lastIndexOf('\nSECOND\n') + 1, 'SECOND']]).delete?.();
  const source = "my $x = <<'END';\ntext\nEND\nsub actual { return $x; }\n";
  const tree = inspect(parser, source, [[source.indexOf('\nEND\n') + 1, 'END']]);
  const offset = source.indexOf('text');
  const insertion = '$END\n';
  tree.edit({ startIndex: offset, oldEndIndex: offset, newEndIndex: offset + insertion.length,
    startPosition: { row: 1, column: 0 }, oldEndPosition: { row: 1, column: 0 },
    newEndPosition: { row: 2, column: 0 } });
  const edited = source.slice(0, offset) + insertion + source.slice(offset);
  const incremental = inspect(parser, edited, [[edited.lastIndexOf('\nEND\n') + 1, 'END']], tree);
  parser.reset();
  const fresh = inspect(parser, edited, [[edited.lastIndexOf('\nEND\n') + 1, 'END']]);
  assert.equal(incremental.rootNode.toString(), fresh.rootNode.toString());
  incremental.delete?.(); fresh.delete?.(); tree.delete?.();
} finally { parser.delete?.(); }
console.log('Real Perl heredocs preserve literal scope, queued indentation and incremental/native parser parity.');
