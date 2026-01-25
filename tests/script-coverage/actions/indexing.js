import path from 'node:path';

export const buildIndexingActions = ({ root, runNode }) => [
  {
    label: 'artifact-size-guardrails-test',
    run: () => runNode('artifact-size-guardrails-test', path.join(root, 'tests', 'artifact-size-guardrails.js')),
    covers: ['artifact-size-guardrails-test']
  },
  {
    label: 'chunk-meta-jsonl-cleanup-test',
    run: () => runNode('chunk-meta-jsonl-cleanup-test', path.join(root, 'tests', 'chunk-meta-jsonl-cleanup.js')),
    covers: ['chunk-meta-jsonl-cleanup-test']
  },
  {
    label: 'chunking-guardrails-test',
    run: () => runNode('chunking-guardrails-test', path.join(root, 'tests', 'chunking-guardrails.js')),
    covers: ['chunking-guardrails-test']
  },
  {
    label: 'code-map-basic-test',
    run: () => runNode('code-map-basic-test', path.join(root, 'tests', 'code-map-basic.js')),
    covers: ['code-map-basic-test']
  },
  {
    label: 'code-map-dot-test',
    run: () => runNode('code-map-dot-test', path.join(root, 'tests', 'code-map-dot.js')),
    covers: ['code-map-dot-test']
  },
  {
    label: 'code-map-graphviz-fallback-test',
    run: () => runNode('code-map-graphviz-fallback-test', path.join(root, 'tests', 'code-map-graphviz-fallback.js')),
    covers: ['code-map-graphviz-fallback-test']
  },
  {
    label: 'code-map-determinism-test',
    run: () => runNode('code-map-determinism-test', path.join(root, 'tests', 'code-map-determinism.js')),
    covers: ['code-map-determinism-test']
  },
  {
    label: 'code-map-guardrails-test',
    run: () => runNode('code-map-guardrails-test', path.join(root, 'tests', 'code-map-guardrails.js')),
    covers: ['code-map-guardrails-test']
  },
  {
    label: 'code-map-performance-test',
    run: () => runNode('code-map-performance-test', path.join(root, 'tests', 'code-map-performance.js')),
    covers: ['code-map-performance-test']
  },
  {
    label: 'e2e-smoke-test',
    run: () => runNode('e2e-smoke-test', path.join(root, 'tests', 'e2e-smoke.js')),
    covers: ['e2e-smoke-test']
  },
  {
    label: 'jsonl-validation-test',
    run: () => runNode('jsonl-validation-test', path.join(root, 'tests', 'jsonl-validation.js')),
    covers: ['jsonl-validation-test']
  },
  {
    label: 'incremental-manifest-test',
    run: () => runNode('incremental-manifest-test', path.join(root, 'tests', 'incremental-manifest.js')),
    covers: ['incremental-manifest-test']
  },
  {
    label: 'index-lock-test',
    run: () => runNode('index-lock-test', path.join(root, 'tests', 'index-lock.js')),
    covers: ['index-lock-test']
  },
  {
    label: 'minhash-parity-test',
    run: () => runNode('minhash-parity-test', path.join(root, 'tests', 'minhash-parity.js')),
    covers: ['minhash-parity-test']
  },
  {
    label: 'metadata-v2-test',
    run: () => runNode('metadata-v2-test', path.join(root, 'tests', 'metadata-v2.js')),
    covers: ['metadata-v2-test']
  },
  {
    label: 'chunking-limits-test',
    run: () => runNode('chunking-limits-test', path.join(root, 'tests', 'chunking-limits.js')),
    covers: ['chunking-limits-test']
  },
  {
    label: 'graph-chunk-id-test',
    run: () => runNode('graph-chunk-id-test', path.join(root, 'tests', 'graph-chunk-id.js')),
    covers: ['graph-chunk-id-test']
  },
  {
    label: 'segment-pipeline-test',
    run: () => runNode('segment-pipeline-test', path.join(root, 'tests', 'segment-pipeline.js')),
    covers: ['segment-pipeline-test']
  },
  {
    label: 'prose-skip-imports-test',
    run: () => runNode('prose-skip-imports-test', path.join(root, 'tests', 'prose-skip-imports.js')),
    covers: ['prose-skip-imports-test']
  },
  {
    label: 'extracted-prose-test',
    run: () => runNode('extracted-prose-test', path.join(root, 'tests', 'extracted-prose.js')),
    covers: ['extracted-prose-test']
  },
  {
    label: 'tokenize-dictionary-test',
    run: () => runNode('tokenize-dictionary-test', path.join(root, 'tests', 'tokenize-dictionary.js')),
    covers: ['tokenize-dictionary-test']
  },
  {
    label: 'import-links-test',
    run: () => runNode('import-links-test', path.join(root, 'tests', 'import-links.js')),
    covers: ['import-links-test']
  },
  {
    label: 'git-blame-range-test',
    run: () => runNode('git-blame-range-test', path.join(root, 'tests', 'git-blame-range.js')),
    covers: ['git-blame-range-test']
  },
  {
    label: 'external-docs-test',
    run: () => runNode('external-docs-test', path.join(root, 'tests', 'external-docs.js')),
    covers: ['external-docs-test']
  },
  {
    label: 'artifact-bak-recovery-test',
    run: () => runNode('artifact-bak-recovery-test', path.join(root, 'tests', 'artifact-bak-recovery.js')),
    covers: ['artifact-bak-recovery-test']
  },
  {
    label: 'encoding-hash-test',
    run: () => runNode('encoding-hash-test', path.join(root, 'tests', 'encoding-hash.js')),
    covers: ['encoding-hash-test']
  },
  {
    label: 'encoding-matrix-test',
    run: () => runNode('encoding-matrix-test', path.join(root, 'tests', 'encoding-matrix.js')),
    covers: ['encoding-matrix-test']
  },
  {
    label: 'jsonl-utf8-test',
    run: () => runNode('jsonl-utf8-test', path.join(root, 'tests', 'jsonl-utf8.js')),
    covers: ['jsonl-utf8-test']
  },
  {
    label: 'unicode-offset-test',
    run: () => runNode('unicode-offset-test', path.join(root, 'tests', 'unicode-offset.js')),
    covers: ['unicode-offset-test']
  },
  {
    label: 'file-size-guard-test',
    run: () => runNode('file-size-guard-test', path.join(root, 'tests', 'file-size-guard.js')),
    covers: ['file-size-guard-test']
  },
  {
    label: 'file-line-guard-test',
    run: () => runNode('file-line-guard-test', path.join(root, 'tests', 'file-line-guard.js')),
    covers: ['file-line-guard-test']
  },
  {
    label: 'skip-minified-binary-test',
    run: () => runNode('skip-minified-binary-test', path.join(root, 'tests', 'skip-minified-binary.js')),
    covers: ['skip-minified-binary-test']
  },
  {
    label: 'read-failure-skip-test',
    run: () => runNode('read-failure-skip-test', path.join(root, 'tests', 'read-failure-skip.js')),
    covers: ['read-failure-skip-test']
  },
  {
    label: 'encoding-fallback-test',
    run: () => runNode('encoding-fallback-test', path.join(root, 'tests', 'encoding-fallback.js')),
    covers: ['encoding-fallback-test']
  },
  {
    label: 'incremental-tokenization-cache-test',
    run: () => runNode('incremental-tokenization-cache-test', path.join(root, 'tests', 'incremental-tokenization-cache.js')),
    covers: ['incremental-tokenization-cache-test']
  },
  {
    label: 'tokenization-buffering-test',
    run: () => runNode('tokenization-buffering-test', path.join(root, 'tests', 'tokenization-buffering.js')),
    covers: ['tokenization-buffering-test']
  },
  {
    label: 'postings-quantize-test',
    run: () => runNode('postings-quantize-test', path.join(root, 'tests', 'postings-quantize.js')),
    covers: ['postings-quantize-test']
  },
  {
    label: 'incremental-cache-signature-test',
    run: () => runNode('incremental-cache-signature-test', path.join(root, 'tests', 'incremental-cache-signature.js')),
    covers: ['incremental-cache-signature-test']
  },
  {
    label: 'incremental-reuse-test',
    run: () => runNode('incremental-reuse-test', path.join(root, 'tests', 'incremental-reuse.js')),
    covers: ['incremental-reuse-test']
  },
  {
    label: 'thread-limits-test',
    run: () => runNode('thread-limits-test', path.join(root, 'tests', 'thread-limits.js')),
    covers: ['thread-limits-test']
  },
  {
    label: 'shard-merge-test',
    run: () => runNode('shard-merge-test', path.join(root, 'tests', 'shard-merge.js')),
    covers: ['shard-merge-test']
  },
  {
    label: 'shard-plan-test',
    run: () => runNode('shard-plan-test', path.join(root, 'tests', 'shard-plan.js')),
    covers: ['shard-plan-test']
  },
  {
    label: 'preprocess-files-test',
    run: () => runNode('preprocess-files-test', path.join(root, 'tests', 'preprocess-files.js')),
    covers: ['preprocess-files-test']
  },
  {
    label: 'chunking-limits-unit-test',
    run: () => runNode('chunking-limits-unit-test', path.join(root, 'tests', 'chunking-limits.unit.js')),
    covers: ['chunking-limits-unit-test']
  },
  {
    label: 'chunking-yaml-unit-test',
    run: () => runNode('chunking-yaml-unit-test', path.join(root, 'tests', 'chunking-yaml.unit.js')),
    covers: ['chunking-yaml-unit-test']
  },
  {
    label: 'chunking-json-unit-test',
    run: () => runNode('chunking-json-unit-test', path.join(root, 'tests', 'chunking-json.unit.js')),
    covers: ['chunking-json-unit-test']
  },
  {
    label: 'build-runtime-stage-overrides-test',
    run: () => runNode('build-runtime-stage-overrides-test', path.join(root, 'tests', 'build-runtime-stage-overrides.js')),
    covers: ['build-runtime-stage-overrides-test']
  },
  {
    label: 'build-runtime-content-hash-test',
    run: () => runNode('build-runtime-content-hash-test', path.join(root, 'tests', 'build-runtime-content-hash.js')),
    covers: ['build-runtime-content-hash-test']
  },
  {
    label: 'indexer-signatures-test',
    run: () => runNode('indexer-signatures-test', path.join(root, 'tests', 'indexer-signatures.js')),
    covers: ['indexer-signatures-test']
  },
  {
    label: 'indexer-sort-determinism-test',
    run: () => runNode('indexer-sort-determinism-test', path.join(root, 'tests', 'indexer-sort-determinism.js')),
    covers: ['indexer-sort-determinism-test']
  },
  {
    label: 'indexer-incremental-plan-test',
    run: () => runNode('indexer-incremental-plan-test', path.join(root, 'tests', 'indexer-incremental-plan.js')),
    covers: ['indexer-incremental-plan-test']
  },
  {
    label: 'file-processor-skip-test',
    run: () => runNode('file-processor-skip-test', path.join(root, 'tests', 'file-processor-skip.js')),
    covers: ['file-processor-skip-test']
  },
  {
    label: 'file-processor-cached-bundle-test',
    run: () => runNode('file-processor-cached-bundle-test', path.join(root, 'tests', 'file-processor-cached-bundle.js')),
    covers: ['file-processor-cached-bundle-test']
  },
  {
    label: 'artifacts-token-mode-test',
    run: () => runNode('artifacts-token-mode-test', path.join(root, 'tests', 'artifacts-token-mode.js')),
    covers: ['artifacts-token-mode-test']
  },
  {
    label: 'artifacts-file-meta-test',
    run: () => runNode('artifacts-file-meta-test', path.join(root, 'tests', 'artifacts-file-meta.js')),
    covers: ['artifacts-file-meta-test']
  },
  {
    label: 'piece-assembly-test',
    run: () => runNode('piece-assembly-test', path.join(root, 'tests', 'piece-assembly.js')),
    covers: ['piece-assembly-test']
  },
  {
    label: 'git-meta-test',
    run: () => runNode('git-meta-test', path.join(root, 'tests', 'git-meta.js')),
    covers: ['git-meta-test']
  },
  {
    label: 'artifact-formats-test',
    run: () => runNode('artifact-formats-test', path.join(root, 'tests', 'artifact-formats.js')),
    covers: ['artifact-formats-test']
  },
  {
    label: 'json-stream-test',
    run: () => runNode('json-stream-test', path.join(root, 'tests', 'json-stream.js')),
    covers: ['json-stream-test']
  }
];
