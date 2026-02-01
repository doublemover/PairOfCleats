import path from 'node:path';

export const buildLanguageActions = ({ root, runNode }) => [
  {
    label: 'language-fidelity-test',
    run: () => runNode('language-fidelity-test', path.join(root, 'tests', 'lang', 'contracts', 'javascript.test.js')),
    covers: ['language-fidelity-test']
  },
  {
    label: 'kotlin-perf-guard-test',
    run: () => runNode('kotlin-perf-guard-test', path.join(root, 'tests', 'lang', 'kotlin', 'kotlin-perf-guard.test.js')),
    covers: ['kotlin-perf-guard-test']
  },
  {
    label: 'tree-sitter-chunks-test',
    run: () => runNode('tree-sitter-chunks-test', path.join(root, 'tests', 'indexing', 'tree-sitter', 'tree-sitter-chunks.test.js')),
    covers: ['tree-sitter-chunks-test']
  },
  {
    label: 'js-tree-sitter-maxbytes-test',
    run: () => runNode('js-tree-sitter-maxbytes-test', path.join(root, 'tests', 'indexing', 'tree-sitter', 'js-tree-sitter-maxbytes.test.js')),
    covers: ['js-tree-sitter-maxbytes-test']
  },
  {
    label: 'type-inference-crossfile-go',
    run: () => runNode('type-inference-crossfile-go', path.join(root, 'tests', 'indexing', 'type-inference', 'crossfile', 'type-inference-crossfile-go.test.js')),
    covers: ['type-inference-crossfile-go']
  },
  {
    label: 'type-inference-crossfile-test',
    run: () => runNode(
      'type-inference-crossfile-test',
      path.join(root, 'tests', 'indexing', 'type-inference', 'crossfile', 'crossfile-output.integration.test.js')
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
    run: () => runNode('chunking-yaml-test', path.join(root, 'tests', 'indexing', 'chunking', 'chunking-yaml.test.js')),
    covers: ['chunking-yaml-test']
  },
  {
    label: 'chunking-sql-lua-test',
    run: () => runNode('chunking-sql-lua-test', path.join(root, 'tests', 'indexing', 'chunking', 'chunking-sql-lua.test.js')),
    covers: ['chunking-sql-lua-test']
  },
  {
    label: 'clike-doc-comments-test',
    run: () => runNode('clike-doc-comments-test', path.join(root, 'tests', 'lang', 'clike', 'clike-doc-comments.test.js')),
    covers: ['clike-doc-comments-test']
  },
  {
    label: 'ruby-end-comment-test',
    run: () => runNode('ruby-end-comment-test', path.join(root, 'tests', 'lang', 'ruby', 'ruby-end-comment.test.js')),
    covers: ['ruby-end-comment-test']
  },
  {
    label: 'php-methods-unique-test',
    run: () => runNode('php-methods-unique-test', path.join(root, 'tests', 'lang', 'php', 'php-methods-unique.test.js')),
    covers: ['php-methods-unique-test']
  },
  {
    label: 'tooling-lsp-test',
    run: () => runNode('tooling-lsp-test', path.join(root, 'tests', 'tooling', 'lsp', 'tooling-lsp.test.js')),
    covers: ['tooling-lsp-test']
  },
  {
    label: 'lsp-shutdown-test',
    run: () => runNode('lsp-shutdown-test', path.join(root, 'tests', 'tooling', 'lsp', 'lsp-shutdown.test.js')),
    covers: ['lsp-shutdown-test']
  },
  {
    label: 'ts-jsx-fixtures',
    run: () => runNode('ts-jsx-fixtures', path.join(root, 'tests', 'lang', 'typescript', 'ts-jsx-fixtures.test.js')),
    covers: []
  },
  {
    label: 'python-heuristic-chunking-test',
    run: () => runNode(
      'python-heuristic-chunking-test',
      path.join(root, 'tests', 'lang', 'python', 'python-heuristic-chunking.test.js')
    ),
    covers: []
  },
  {
    label: 'python-imports-test',
    run: () => runNode(
      'python-imports-test',
      path.join(root, 'tests', 'lang', 'python', 'python-imports.test.js')
    ),
    covers: []
  },
  {
    label: 'python-pool-test',
    run: () => runNode(
      'python-pool-test',
      path.join(root, 'tests', 'lang', 'python', 'python-pool.test.js')
    ),
    covers: []
  },
  {
    label: 'js-imports-test',
    run: () => runNode('js-imports-test', path.join(root, 'tests', 'lang', 'javascript', 'js-imports.test.js')),
    covers: []
  },
  {
    label: 'js-chunking-test',
    run: () => runNode('js-chunking-test', path.join(root, 'tests', 'lang', 'javascript', 'js-chunking.test.js')),
    covers: []
  },
  {
    label: 'js-relations-test',
    run: () => runNode('js-relations-test', path.join(root, 'tests', 'lang', 'javascript', 'js-relations.test.js')),
    covers: []
  },
  {
    label: 'typescript-imports-only-test',
    run: () => runNode('typescript-imports-only-test', path.join(root, 'tests', 'lang', 'typescript', 'typescript-imports-only.test.js')),
    covers: ['typescript-imports-only-test']
  },
  {
    label: 'import-priority-test',
    run: () => runNode('import-priority-test', path.join(root, 'tests', 'indexing', 'imports', 'import-priority.test.js')),
    covers: ['import-priority-test']
  },
  {
    label: 'ignore-overrides-test',
    run: () => runNode('ignore-overrides-test', path.join(root, 'tests', 'indexing', 'ignore', 'ignore-overrides.test.js')),
    covers: ['ignore-overrides-test']
  },
  {
    label: 'language-registry-collectors-test',
    run: () => runNode(
      'language-registry-collectors-test',
      path.join(root, 'tests', 'lang', 'registry', 'collectors.test.js')
    ),
    covers: ['language-registry-collectors-test']
  },
  {
    label: 'language-registry-selection-test',
    run: () => runNode(
      'language-registry-selection-test',
      path.join(root, 'tests', 'lang', 'registry', 'selection.test.js')
    ),
    covers: ['language-registry-selection-test']
  },
  {
    label: 'python-fallback-test',
    run: () => runNode('python-fallback-test', path.join(root, 'tests', 'lang', 'python', 'python-fallback.test.js')),
    covers: ['python-fallback-test']
  },
  {
    label: 'python-ast-worker-test',
    run: () => runNode('python-ast-worker-test', path.join(root, 'tests', 'lang', 'python', 'python-ast-worker.test.js')),
    covers: []
  },
  {
    label: 'typescript-parser-selection-test',
    run: () => runNode('typescript-parser-selection-test', path.join(root, 'tests', 'lang', 'typescript', 'typescript-parser-selection.test.js')),
    covers: ['typescript-parser-selection-test']
  }
];
