import path from 'node:path';

export const buildIndexingActions = ({ root, runNode }) => [
  {
    label: 'artifact-size-guardrails-test',
    run: () => runNode('artifact-size-guardrails-test', path.join(root, 'tests', 'indexing', 'artifacts', 'artifact-size-guardrails.test.js')),
    covers: ['artifact-size-guardrails-test']
  },
  {
    label: 'chunk-meta-jsonl-cleanup-test',
    run: () => runNode('chunk-meta-jsonl-cleanup-test', path.join(root, 'tests', 'indexing', 'artifacts', 'chunk-meta-jsonl-cleanup.test.js')),
    covers: ['chunk-meta-jsonl-cleanup-test']
  },
  {
    label: 'chunking-guardrails-test',
    run: () => runNode('chunking-guardrails-test', path.join(root, 'tests', 'indexing', 'chunking', 'chunking-guardrails.test.js')),
    covers: ['chunking-guardrails-test']
  },
  {
    label: 'code-map-basic-test',
    run: () => runNode('code-map-basic-test', path.join(root, 'tests', 'indexing', 'map', 'code-map-basic.test.js')),
    covers: ['code-map-basic-test']
  },
  {
    label: 'code-map-dot-test',
    run: () => runNode('code-map-dot-test', path.join(root, 'tests', 'indexing', 'map', 'code-map-dot.test.js')),
    covers: ['code-map-dot-test']
  },
  {
    label: 'code-map-graphviz-fallback-test',
    run: () => runNode('code-map-graphviz-fallback-test', path.join(root, 'tests', 'indexing', 'map', 'code-map-graphviz-fallback.test.js')),
    covers: ['code-map-graphviz-fallback-test']
  },
  {
    label: 'code-map-determinism-test',
    run: () => runNode('code-map-determinism-test', path.join(root, 'tests', 'indexing', 'map', 'code-map-determinism.test.js')),
    covers: ['code-map-determinism-test']
  },
  {
    label: 'code-map-guardrails-test',
    run: () => runNode('code-map-guardrails-test', path.join(root, 'tests', 'indexing', 'map', 'code-map-guardrails.test.js')),
    covers: ['code-map-guardrails-test']
  },
  {
    label: 'code-map-performance-test',
    run: () => runNode('code-map-performance-test', path.join(root, 'tests', 'indexing', 'map', 'code-map-performance.test.js')),
    covers: ['code-map-performance-test']
  },
  {
    label: 'e2e-smoke-test',
    run: () => runNode('e2e-smoke-test', path.join(root, 'tests', 'smoke', 'e2e-smoke.test.js')),
    covers: ['e2e-smoke-test']
  },
  {
    label: 'jsonl-validation-test',
    run: () => runNode('jsonl-validation-test', path.join(root, 'tests', 'shared', 'json-stream', 'jsonl-validation.test.js')),
    covers: ['jsonl-validation-test']
  },
  {
    label: 'incremental-manifest-test',
    run: () => runNode('incremental-manifest-test', path.join(root, 'tests', 'indexing', 'incremental', 'incremental-manifest.test.js')),
    covers: ['incremental-manifest-test']
  },
  {
    label: 'index-lock-test',
    run: () => runNode('index-lock-test', path.join(root, 'tests', 'indexing', 'watch', 'index-lock.test.js')),
    covers: ['index-lock-test']
  },
  {
    label: 'minhash-parity-test',
    run: () => runNode('minhash-parity-test', path.join(root, 'tests', 'indexing', 'tokenization', 'minhash-parity.test.js')),
    covers: ['minhash-parity-test']
  },
  {
    label: 'metadata-v2-test',
    run: () => runNode('metadata-v2-test', path.join(root, 'tests', 'indexing', 'metav2', 'metadata-v2.test.js')),
    covers: ['metadata-v2-test']
  },
  {
    label: 'chunking-limits-test',
    run: () => runNode('chunking-limits-test', path.join(root, 'tests', 'indexing', 'chunking', 'chunking-limits.test.js')),
    covers: ['chunking-limits-test']
  },
  {
    label: 'graph-chunk-id-test',
    run: () => runNode('graph-chunk-id-test', path.join(root, 'tests', 'indexing', 'relations', 'graph-chunk-id.test.js')),
    covers: ['graph-chunk-id-test']
  },
  {
    label: 'segment-pipeline-test',
    run: () => runNode('segment-pipeline-test', path.join(root, 'tests', 'indexing', 'segments', 'segment-pipeline.test.js')),
    covers: ['segment-pipeline-test']
  },
  {
    label: 'prose-skip-imports-test',
    run: () => runNode('prose-skip-imports-test', path.join(root, 'tests', 'indexing', 'imports', 'prose-skip-imports.test.js')),
    covers: ['prose-skip-imports-test']
  },
  {
    label: 'extracted-prose-test',
    run: () => runNode('extracted-prose-test', path.join(root, 'tests', 'indexing', 'extracted-prose', 'extracted-prose.test.js')),
    covers: ['extracted-prose-test']
  },
  {
    label: 'tokenize-dictionary-test',
    run: () => runNode('tokenize-dictionary-test', path.join(root, 'tests', 'indexing', 'tokenization', 'tokenize-dictionary.test.js')),
    covers: ['tokenize-dictionary-test']
  },
  {
    label: 'import-links-test',
    run: () => runNode('import-links-test', path.join(root, 'tests', 'indexing', 'imports', 'import-links.test.js')),
    covers: ['import-links-test']
  },
  {
    label: 'git-blame-range-test',
    run: () => runNode('git-blame-range-test', path.join(root, 'tests', 'indexing', 'git', 'git-blame-range.test.js')),
    covers: ['git-blame-range-test']
  },
  {
    label: 'external-docs-test',
    run: () => runNode('external-docs-test', path.join(root, 'tests', 'indexing', 'metadata', 'external-docs.test.js')),
    covers: ['external-docs-test']
  },
  {
    label: 'artifact-bak-recovery-test',
    run: () => runNode('artifact-bak-recovery-test', path.join(root, 'tests', 'indexing', 'artifacts', 'artifact-bak-recovery.test.js')),
    covers: ['artifact-bak-recovery-test']
  },
  {
    label: 'encoding-hash-test',
    run: () => runNode('encoding-hash-test', path.join(root, 'tests', 'shared', 'encoding', 'encoding-hash.test.js')),
    covers: ['encoding-hash-test']
  },
  {
    label: 'encoding-matrix-test',
    run: () => runNode('encoding-matrix-test', path.join(root, 'tests', 'shared', 'encoding', 'encoding-matrix.test.js')),
    covers: ['encoding-matrix-test']
  },
  {
    label: 'jsonl-utf8-test',
    run: () => runNode('jsonl-utf8-test', path.join(root, 'tests', 'shared', 'json-stream', 'jsonl-utf8.test.js')),
    covers: ['jsonl-utf8-test']
  },
  {
    label: 'unicode-offset-test',
    run: () => runNode('unicode-offset-test', path.join(root, 'tests', 'shared', 'encoding', 'unicode-offset.test.js')),
    covers: ['unicode-offset-test']
  },
  {
    label: 'file-size-guard-test',
    run: () => runNode('file-size-guard-test', path.join(root, 'tests', 'indexing', 'file-caps', 'file-size-guard.test.js')),
    covers: ['file-size-guard-test']
  },
  {
    label: 'file-line-guard-test',
    run: () => runNode('file-line-guard-test', path.join(root, 'tests', 'indexing', 'file-caps', 'file-line-guard.test.js')),
    covers: ['file-line-guard-test']
  },
  {
    label: 'skip-minified-binary-test',
    run: () => runNode('skip-minified-binary-test', path.join(root, 'tests', 'indexing', 'file-processor', 'skip-minified-binary.test.js')),
    covers: ['skip-minified-binary-test']
  },
  {
    label: 'read-failure-skip-test',
    run: () => runNode('read-failure-skip-test', path.join(root, 'tests', 'indexing', 'file-processor', 'read-failure-skip.test.js')),
    covers: ['read-failure-skip-test']
  },
  {
    label: 'encoding-fallback-test',
    run: () => runNode('encoding-fallback-test', path.join(root, 'tests', 'shared', 'encoding', 'encoding-fallback.test.js')),
    covers: ['encoding-fallback-test']
  },
  {
    label: 'incremental-tokenization-cache-test',
    run: () => runNode('incremental-tokenization-cache-test', path.join(root, 'tests', 'indexing', 'incremental', 'incremental-tokenization-cache.test.js')),
    covers: ['incremental-tokenization-cache-test']
  },
  {
    label: 'tokenization-buffering-test',
    run: () => runNode('tokenization-buffering-test', path.join(root, 'tests', 'indexing', 'tokenization', 'tokenization-buffering.test.js')),
    covers: ['tokenization-buffering-test']
  },
  {
    label: 'postings-quantize-test',
    run: () => runNode('postings-quantize-test', path.join(root, 'tests', 'indexing', 'postings', 'postings-quantize.test.js')),
    covers: ['postings-quantize-test']
  },
  {
    label: 'incremental-cache-signature-test',
    run: () => runNode('incremental-cache-signature-test', path.join(root, 'tests', 'indexing', 'incremental', 'incremental-cache-signature.test.js')),
    covers: ['incremental-cache-signature-test']
  },
  {
    label: 'incremental-reuse-test',
    run: () => runNode('incremental-reuse-test', path.join(root, 'tests', 'indexing', 'incremental', 'incremental-reuse.test.js')),
    covers: ['incremental-reuse-test']
  },
  {
    label: 'thread-limits-test',
    run: () => runNode('thread-limits-test', path.join(root, 'tests', 'shared', 'runtime', 'thread-limits.test.js')),
    covers: ['thread-limits-test']
  },
  {
    label: 'shard-merge-test',
    run: () => runNode('shard-merge-test', path.join(root, 'tests', 'indexing', 'shards', 'shard-merge.test.js')),
    covers: ['shard-merge-test']
  },
  {
    label: 'shard-plan-test',
    run: () => runNode('shard-plan-test', path.join(root, 'tests', 'indexing', 'shards', 'shard-plan.test.js')),
    covers: ['shard-plan-test']
  },
  {
    label: 'preprocess-files-test',
    run: () => runNode('preprocess-files-test', path.join(root, 'tests', 'indexing', 'preprocess', 'preprocess-files.test.js')),
    covers: ['preprocess-files-test']
  },
  {
    label: 'chunking-limits-unit-test',
    run: () => runNode('chunking-limits-unit-test', path.join(root, 'tests', 'indexing', 'chunking', 'limits.test.js')),
    covers: ['chunking-limits-unit-test']
  },
  {
    label: 'chunking-yaml-unit-test',
    run: () => runNode('chunking-yaml-unit-test', path.join(root, 'tests', 'indexing', 'chunking', 'yaml.test.js')),
    covers: ['chunking-yaml-unit-test']
  },
  {
    label: 'chunking-json-unit-test',
    run: () => runNode('chunking-json-unit-test', path.join(root, 'tests', 'indexing', 'chunking', 'json.test.js')),
    covers: ['chunking-json-unit-test']
  },
  {
    label: 'build-runtime-stage-overrides-test',
    run: () => runNode('build-runtime-stage-overrides-test', path.join(root, 'tests', 'indexing', 'runtime', 'stage-overrides.test.js')),
    covers: ['build-runtime-stage-overrides-test']
  },
  {
    label: 'build-runtime-content-hash-test',
    run: () => runNode('build-runtime-content-hash-test', path.join(root, 'tests', 'indexing', 'runtime', 'content-hash.test.js')),
    covers: ['build-runtime-content-hash-test']
  },
  {
    label: 'indexer-signatures-test',
    run: () => runNode('indexer-signatures-test', path.join(root, 'tests', 'indexer', 'signatures', 'signatures.test.js')),
    covers: ['indexer-signatures-test']
  },
  {
    label: 'indexer-sort-determinism-test',
    run: () => runNode('indexer-sort-determinism-test', path.join(root, 'tests', 'indexer', 'determinism', 'sort-determinism.test.js')),
    covers: ['indexer-sort-determinism-test']
  },
  {
    label: 'indexer-incremental-plan-test',
    run: () => runNode('indexer-incremental-plan-test', path.join(root, 'tests', 'indexer', 'incremental', 'incremental-plan.test.js')),
    covers: ['indexer-incremental-plan-test']
  },
  {
    label: 'file-processor-skip-test',
    run: () => runNode('file-processor-skip-test', path.join(root, 'tests', 'indexing', 'file-processor', 'skip.test.js')),
    covers: ['file-processor-skip-test']
  },
  {
    label: 'file-processor-cached-bundle-test',
    run: () => runNode('file-processor-cached-bundle-test', path.join(root, 'tests', 'indexing', 'file-processor', 'cached-bundle.test.js')),
    covers: ['file-processor-cached-bundle-test']
  },
  {
    label: 'artifacts-token-mode-test',
    run: () => runNode('artifacts-token-mode-test', path.join(root, 'tests', 'indexing', 'artifacts', 'token-mode.test.js')),
    covers: ['artifacts-token-mode-test']
  },
  {
    label: 'artifacts-file-meta-test',
    run: () => runNode('artifacts-file-meta-test', path.join(root, 'tests', 'indexing', 'artifacts', 'file-meta.test.js')),
    covers: ['artifacts-file-meta-test']
  },
  {
    label: 'piece-assembly-test',
    run: () => runNode('piece-assembly-test', path.join(root, 'tests', 'indexing', 'piece-assembly', 'piece-assembly.test.js')),
    covers: ['piece-assembly-test']
  },
  {
    label: 'git-meta-test',
    run: () => runNode('git-meta-test', path.join(root, 'tests', 'indexing', 'git', 'git-meta.test.js')),
    covers: ['git-meta-test']
  },
  {
    label: 'artifact-formats-test',
    run: () => runNode('artifact-formats-test', path.join(root, 'tests', 'indexing', 'artifacts', 'artifact-formats.test.js')),
    covers: ['artifact-formats-test']
  },
  {
    label: 'json-stream-test',
    run: () => runNode('json-stream-test', path.join(root, 'tests', 'shared', 'json-stream', 'json-stream.test.js')),
    covers: ['json-stream-test']
  }
];
