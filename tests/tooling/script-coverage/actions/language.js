import path from 'node:path';

export const buildLanguageActions = ({ root, runNode }) => [
  {
    label: 'language-fixture-contracts-test',
    run: () => runNode('language-fixture-contracts-test', path.join(root, 'tests', 'lang', 'contracts', 'language-fixture-contracts.test.js')),
    covers: ['language-fidelity-test', 'language-fixture-contracts-test']
  },
  {
    label: 'kotlin-perf-guard-test',
    run: () => runNode('kotlin-perf-guard-test', path.join(root, 'tests', 'lang', 'kotlin', 'perf-guard.test.js')),
    covers: ['kotlin-perf-guard-test']
  },
  {
    label: 'tree-sitter-chunks-test',
    run: () => runNode('tree-sitter-chunks-test', path.join(root, 'tests', 'indexing', 'tree-sitter', 'chunks.test.js')),
    covers: ['tree-sitter-chunks-test']
  },
  {
    label: 'js-tree-sitter-maxbytes-test',
    run: () => runNode('js-tree-sitter-maxbytes-test', path.join(root, 'tests', 'indexing', 'tree-sitter', 'js-maxbytes.test.js')),
    covers: ['js-tree-sitter-maxbytes-test']
  },
  {
    label: 'type-inference-crossfile-go',
    run: () => runNode('type-inference-crossfile-go', path.join(root, 'tests', 'indexing', 'type-inference', 'crossfile', 'type-inference-go.test.js')),
    covers: ['type-inference-crossfile-go']
  },
  {
    label: 'type-inference-crossfile-test',
    run: () => runNode(
      'type-inference-crossfile-test',
      path.join(root, 'tests', 'indexing', 'type-inference', 'crossfile', 'output.integration.test.js')
    ),
    covers: ['type-inference-crossfile-test']
  },
  {
    label: 'type-inference-lsp-enrichment-test',
    run: () => runNode('type-inference-lsp-enrichment-test', path.join(root, 'tests', 'indexing', 'type-inference', 'providers', 'type-inference-lsp-enrichment.test.js')),
    covers: ['type-inference-lsp-enrichment-test']
  },
  {
    label: 'type-inference-typescript-provider-no-ts',
    run: () => runNode('type-inference-typescript-provider-no-ts', path.join(root, 'tests', 'indexing', 'type-inference', 'providers', 'type-inference-typescript-provider-no-ts.test.js')),
    covers: ['type-inference-typescript-provider-no-ts']
  },
  {
    label: 'type-inference-clangd-provider-no-clangd',
    run: () => runNode('type-inference-clangd-provider-no-clangd', path.join(root, 'tests', 'indexing', 'type-inference', 'providers', 'type-inference-clangd-provider-no-clangd.test.js')),
    covers: ['type-inference-clangd-provider-no-clangd']
  },
  {
    label: 'type-inference-sourcekit-provider-no-sourcekit',
    run: () => runNode('type-inference-sourcekit-provider-no-sourcekit', path.join(root, 'tests', 'indexing', 'type-inference', 'providers', 'type-inference-sourcekit-provider-no-sourcekit.test.js')),
    covers: ['type-inference-sourcekit-provider-no-sourcekit']
  },
  {
    label: 'format-fidelity-test',
    run: () => runNode('format-fidelity-test', path.join(root, 'tests', 'indexing', 'chunking', 'formats', 'format-fidelity.test.js')),
    covers: ['format-fidelity-test']
  },
  {
    label: 'chunking-yaml-test',
    run: () => runNode('chunking-yaml-test', path.join(root, 'tests', 'indexing', 'chunking', 'yaml.test.js')),
    covers: ['chunking-yaml-test']
  },
  {
    label: 'chunking-sql-lua-test',
    run: () => runNode('chunking-sql-lua-test', path.join(root, 'tests', 'indexing', 'chunking', 'sql-lua.test.js')),
    covers: ['chunking-sql-lua-test']
  },
  {
    label: 'clike-doc-comments-test',
    run: () => runNode('clike-doc-comments-test', path.join(root, 'tests', 'lang', 'clike', 'doc-comments.test.js')),
    covers: ['clike-doc-comments-test']
  },
  {
    label: 'ruby-end-comment-test',
    run: () => runNode('ruby-end-comment-test', path.join(root, 'tests', 'lang', 'ruby', 'end-comment.test.js')),
    covers: ['ruby-end-comment-test']
  },
  {
    label: 'php-methods-unique-test',
    run: () => runNode('php-methods-unique-test', path.join(root, 'tests', 'lang', 'php', 'methods-unique.test.js')),
    covers: ['php-methods-unique-test']
  },
  {
    label: 'tooling-lsp-test',
    run: () => runNode('tooling-lsp-test', path.join(root, 'tests', 'tooling', 'lsp', 'tooling.test.js')),
    covers: ['tooling-lsp-test']
  },
  {
    label: 'lsp-shutdown-test',
    run: () => runNode('lsp-shutdown-test', path.join(root, 'tests', 'tooling', 'lsp', 'shutdown.test.js')),
    covers: ['lsp-shutdown-test']
  },
  {
    label: 'typescript-contract-matrix-test',
    run: () => runNode('typescript-contract-matrix-test', path.join(root, 'tests', 'lang', 'typescript', 'typescript-contract-matrix.test.js')),
    covers: ['ts-jsx-fixtures', 'typescript-imports-only-test', 'typescript-parser-selection-test', 'typescript-contract-matrix-test']
  },
  {
    label: 'import-resolution-policy-contract-matrix-test',
    run: () => runNode('import-resolution-policy-contract-matrix-test', path.join(root, 'tests', 'indexing', 'imports', 'import-resolution-policy-contract-matrix.test.js')),
    covers: ['import-priority-test', 'import-resolution-policy-contract-matrix-test']
  },
  {
    label: 'ignore-contract-matrix-test',
    run: () => runNode('ignore-contract-matrix-test', path.join(root, 'tests', 'indexing', 'ignore', 'contract-matrix.test.js')),
    covers: ['ignore-overrides-test', 'ignore-contract-matrix-test']
  },
  {
    label: 'language-registry-contract-matrix-test',
    run: () => runNode('language-registry-contract-matrix-test', path.join(root, 'tests', 'lang', 'registry', 'registry-contract-matrix.test.js')),
    covers: ['language-registry-collectors-test', 'language-registry-selection-test', 'language-registry-contract-matrix-test']
  },
  {
    label: 'python-contract-matrix-test',
    run: () => runNode('python-contract-matrix-test', path.join(root, 'tests', 'lang', 'python', 'python-contract-matrix.test.js')),
    covers: ['python-heuristic-chunking-test', 'python-imports-test', 'python-pool-test', 'python-fallback-test', 'python-contract-matrix-test']
  },
  {
    label: 'python-ast-worker-test',
    run: () => runNode('python-ast-worker-test', path.join(root, 'tests', 'lang', 'python', 'ast-worker.test.js')),
    covers: []
  },
  {
    label: 'javascript-contract-matrix-test',
    run: () => runNode('javascript-contract-matrix-test', path.join(root, 'tests', 'lang', 'javascript', 'javascript-contract-matrix.test.js')),
    covers: ['js-imports-test', 'js-chunking-test', 'js-relations-test', 'javascript-contract-matrix-test']
  }
];
