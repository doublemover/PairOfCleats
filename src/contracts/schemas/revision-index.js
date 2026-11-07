import { semanticObject as object, semanticHashSchema as hash, semanticNullable as nullable } from './semantic-envelopes.js';
import { SOURCE_REVISION_OUTPUT_SCHEMA } from './revision-source.js';

export const INDEX_REVISION_PROFILE = 'published-javascript-chunk-index-revisions-v2';
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const count = maximum => ({ type: 'integer', minimum: 0, maximum });
const chunk = SOURCE_REVISION_OUTPUT_SCHEMA.items.properties.chunks.items;
const rows = list(object({ file: SOURCE_REVISION_OUTPUT_SCHEMA.items.properties.path, ...chunk.properties,
  chunkUid: text(1024), tokens: nullable(list({ type: 'string', maxLength: 4096 }, 65536)) }), 128);
const execution = object({ executionId: text(128), command: text(4096), args: list(text(4096), 32), cwd: text(4096), configHash: hash,
  exitCode: { const: 0 }, signal: { type: 'null' }, elapsedMs: { type: 'number', minimum: 0 }, stdoutHash: hash, stderrHash: hash,
  stdoutBytes: count(1048576), stderrBytes: count(1048576), logPrefix: text(4096) });
const generation = object({ buildId: text(256), generationKey: text(16384), pointerHash: hash, pointerPath: text(4096),
  artifactSurfaceVersion: text(128), indexRoot: text(4096), execution, outputId: hash });
const checkpoint = object({ index: count(16), checkpointId: text(64), stateId: hash, outcome: { enum: ['pass', 'fail', 'unknown'] },
  candidate: generation, rebuild: generation,
  claims: { type: 'array', minItems: 2, maxItems: 2, items: { oneOf: [
    object({ tier: { const: 'independent-source-construction-grammar' }, relation: { const: 'published-chunk-utf16-ranges-and-source-text' }, outcome: { enum: ['pass', 'fail', 'unknown'] } }),
    object({ tier: { const: 'same-implementation-clean-rebuild' }, relation: { const: 'exact-chunk-uids-ranges-text-and-published-tokens' }, outcome: { enum: ['pass', 'fail'] } })
  ] } }, counterexample: nullable(object({ expected: nullable(SOURCE_REVISION_OUTPUT_SCHEMA), actual: SOURCE_REVISION_OUTPUT_SCHEMA,
    candidateRows: rows, rebuildRows: rows })) });
export const INDEX_REVISION_RECEIPT_SCHEMA = object({ schemaVersion: { const: 1 }, kind: { const: 'published-code-chunk-index-revision-run' },
  profile: { const: INDEX_REVISION_PROFILE }, executionId: text(128), scenarioId: hash, workspace: text(4096),
  checkpoints: { ...list(checkpoint, 17), minItems: 1 }, requestedCheckpoints: { ...list(count(16), 17), minItems: 1, uniqueItems: true },
  omittedCheckpoints: { ...list(count(16), 16), uniqueItems: true }, completeScenarioCoverage: { type: 'boolean' }, outcome: { enum: ['pass', 'fail', 'unknown'] },
  producer: object({ node: text(128), abi: text(128), sourceChunking: text(128), javascriptRelations: text(128) }),
  scope: { const: 'real-stage2-code-publication; constructed-javascript; no-embeddings-sqlite-enrichment-or-generated-source-execution' },
  strategy: { const: 'serial-incremental-candidate-and-isolated-clean-build; production-default-worker-backend' },
  limits: object({ maxMs: { type: 'integer', minimum: 1, maximum: 25000 }, sourceBytes: { const: 65536 }, chunkRows: { const: 128 },
    receiptBytes: { const: 262144 }, outputBytesPerStream: { const: 1048576 } }) });
