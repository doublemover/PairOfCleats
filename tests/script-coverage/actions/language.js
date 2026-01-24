import path from 'node:path';

export const buildLanguageActions = ({ root, runNode }) => [
  {
    label: 'language-fidelity-test',
    run: () => runNode('language-fidelity-test', path.join(root, 'tests', 'lang', 'contracts', 'javascript.test.js')),
    covers: ['language-fidelity-test']
  },
  {
    label: 'kotlin-perf-guard-test',
    run: () => runNode('kotlin-perf-guard-test', path.join(root, 'tests', 'kotlin-perf-guard.js')),
    covers: ['kotlin-perf-guard-test']
  },
  {
    label: 'tree-sitter-chunks-test',
    run: () => runNode('tree-sitter-chunks-test', path.join(root, 'tests', 'tree-sitter-chunks.js')),
    covers: ['tree-sitter-chunks-test']
  },
  {
    label: 'js-tree-sitter-maxbytes-test',
    run: () => runNode('js-tree-sitter-maxbytes-test', path.join(root, 'tests', 'js-tree-sitter-maxbytes.js')),
    covers: ['js-tree-sitter-maxbytes-test']
  },
  {
    label: 'type-inference-crossfile-go',
    run: () => runNode('type-inference-crossfile-go', path.join(root, 'tests', 'type-inference-crossfile-go.js')),
    covers: ['type-inference-crossfile-go']
  },
  {
    label: 'type-inference-crossfile-test',
    run: () => runNode('type-inference-crossfile-test', path.join(root, 'tests', 'type-inference-crossfile.js')),
    covers: ['type-inference-crossfile-test']
  },
  {
    label: 'type-inference-lsp-enrichment-test',
    run: () => runNode('type-inference-lsp-enrichment-test', path.join(root, 'tests', 'type-inference-lsp-enrichment.js')),
    covers: ['type-inference-lsp-enrichment-test']
  },
  {
    label: 'type-inference-typescript-provider-no-ts',
    run: () => runNode('type-inference-typescript-provider-no-ts', path.join(root, 'tests', 'type-inference-typescript-provider-no-ts.js')),
    covers: ['type-inference-typescript-provider-no-ts']
  },
  {
    label: 'type-inference-clangd-provider-no-clangd',
    run: () => runNode('type-inference-clangd-provider-no-clangd', path.join(root, 'tests', 'type-inference-clangd-provider-no-clangd.js')),
    covers: ['type-inference-clangd-provider-no-clangd']
  },
  {
    label: 'type-inference-sourcekit-provider-no-sourcekit',
    run: () => runNode('type-inference-sourcekit-provider-no-sourcekit', path.join(root, 'tests', 'type-inference-sourcekit-provider-no-sourcekit.js')),
    covers: ['type-inference-sourcekit-provider-no-sourcekit']
  },
  {
    label: 'format-fidelity-test',
    run: () => runNode('format-fidelity-test', path.join(root, 'tests', 'format-fidelity.js')),
    covers: ['format-fidelity-test']
  },
  {
    label: 'chunking-yaml-test',
    run: () => runNode('chunking-yaml-test', path.join(root, 'tests', 'chunking-yaml.js')),
    covers: ['chunking-yaml-test']
  },
  {
    label: 'chunking-sql-lua-test',
    run: () => runNode('chunking-sql-lua-test', path.join(root, 'tests', 'chunking-sql-lua.js')),
    covers: ['chunking-sql-lua-test']
  },
  {
    label: 'clike-doc-comments-test',
    run: () => runNode('clike-doc-comments-test', path.join(root, 'tests', 'clike-doc-comments.js')),
    covers: ['clike-doc-comments-test']
  },
  {
    label: 'ruby-end-comment-test',
    run: () => runNode('ruby-end-comment-test', path.join(root, 'tests', 'ruby-end-comment.js')),
    covers: ['ruby-end-comment-test']
  },
  {
    label: 'php-methods-unique-test',
    run: () => runNode('php-methods-unique-test', path.join(root, 'tests', 'php-methods-unique.js')),
    covers: ['php-methods-unique-test']
  },
  {
    label: 'tooling-lsp-test',
    run: () => runNode('tooling-lsp-test', path.join(root, 'tests', 'tooling-lsp.js')),
    covers: ['tooling-lsp-test']
  },
  {
    label: 'lsp-shutdown-test',
    run: () => runNode('lsp-shutdown-test', path.join(root, 'tests', 'lsp-shutdown.js')),
    covers: ['lsp-shutdown-test']
  },
  {
    label: 'ts-jsx-fixtures',
    run: () => runNode('ts-jsx-fixtures', path.join(root, 'tests', 'ts-jsx-fixtures.js')),
    covers: []
  },
  {
    label: 'python-heuristic-chunking-test',
    run: () => runNode(
      'python-heuristic-chunking-test',
      path.join(root, 'tests', 'lang', 'python-heuristic-chunking.test.js')
    ),
    covers: []
  },
  {
    label: 'python-imports-test',
    run: () => runNode(
      'python-imports-test',
      path.join(root, 'tests', 'lang', 'python-imports.test.js')
    ),
    covers: []
  },
  {
    label: 'python-pool-test',
    run: () => runNode(
      'python-pool-test',
      path.join(root, 'tests', 'lang', 'python-pool.test.js')
    ),
    covers: []
  },
  {
    label: 'js-imports-test',
    run: () => runNode('js-imports-test', path.join(root, 'tests', 'lang', 'js-imports.test.js')),
    covers: []
  },
  {
    label: 'js-chunking-test',
    run: () => runNode('js-chunking-test', path.join(root, 'tests', 'lang', 'js-chunking.test.js')),
    covers: []
  },
  {
    label: 'js-relations-test',
    run: () => runNode('js-relations-test', path.join(root, 'tests', 'lang', 'js-relations.test.js')),
    covers: []
  },
  {
    label: 'typescript-imports-only-test',
    run: () => runNode('typescript-imports-only-test', path.join(root, 'tests', 'typescript-imports-only.js')),
    covers: ['typescript-imports-only-test']
  },
  {
    label: 'import-priority-test',
    run: () => runNode('import-priority-test', path.join(root, 'tests', 'import-priority.js')),
    covers: ['import-priority-test']
  },
  {
    label: 'ignore-overrides-test',
    run: () => runNode('ignore-overrides-test', path.join(root, 'tests', 'ignore-overrides.js')),
    covers: ['ignore-overrides-test']
  },
  {
    label: 'language-registry-collectors-test',
    run: () => runNode('language-registry-collectors-test', path.join(root, 'tests', 'language-registry-collectors.js')),
    covers: ['language-registry-collectors-test']
  },
  {
    label: 'language-registry-selection-test',
    run: () => runNode('language-registry-selection-test', path.join(root, 'tests', 'language-registry-selection.js')),
    covers: ['language-registry-selection-test']
  },
  {
    label: 'python-fallback-test',
    run: () => runNode('python-fallback-test', path.join(root, 'tests', 'python-fallback.js')),
    covers: ['python-fallback-test']
  },
  {
    label: 'python-ast-worker-test',
    run: () => runNode('python-ast-worker-test', path.join(root, 'tests', 'python-ast-worker.js')),
    covers: []
  },
  {
    label: 'typescript-parser-selection-test',
    run: () => runNode('typescript-parser-selection-test', path.join(root, 'tests', 'typescript-parser-selection.js')),
    covers: ['typescript-parser-selection-test']
  }
];
