import { semanticObject as object, semanticHashSchema as hash, semanticNullable as nullable } from './semantic-envelopes.js';

export const SOURCE_REVISION_PROFILE = 'tiny-javascript-source-revisions-v1';
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const count = maximum => ({ type: 'integer', minimum: 0, maximum });
const text = { type: 'string', minLength: 1, maxLength: 128 };
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]{0,63}$' };
const path = { type: 'string', maxLength: 80, pattern: '^(?:[A-Za-z][A-Za-z0-9_-]*/)*[A-Za-z][A-Za-z0-9_-]*\\.js$' };
const declaration = object({ name: { type: 'string', pattern: '^fn_[A-Za-z0-9_]{1,48}$' }, value: { type: 'integer', minimum: -9, maximum: 9 }, exported: { type: 'boolean' } });
const file = object({ path, prefix: { enum: ['plain', 'bom', 'unicode-crlf'] }, declarations: list(declaration, 8) });
export const SOURCE_REVISION_SCENARIO_SCHEMA = object({ schemaVersion: { const: 1 }, profile: { const: SOURCE_REVISION_PROFILE }, family: id,
  seed: count(4294967295), repositoryNamespace: id, parser: { enum: ['babel', 'acorn', 'esprima'] }, files: list(file, 8),
  revisions: list(object({ id, beforeId: hash, afterId: hash, removePaths: { ...list(path, 8), uniqueItems: true }, putFiles: list(file, 8) }), 16) });
const chunk = object({ name: text, kind: { enum: ['FunctionDeclaration', 'ExportedFunction', 'Module'] }, start: count(16384), end: count(16384),
  startLine: nullable(count(16384)), endLine: nullable(count(16384)), text: { type: 'string', maxLength: 16384 } });
export const SOURCE_REVISION_OUTPUT_SCHEMA = list(object({ path, byteHash: hash, textLength: count(16384), byteLength: count(65536), chunks: list(chunk, 8) }), 8);
const parser = object({ family: { enum: ['babel', 'acorn', 'esprima'] }, version: text,
  options: object({ ext: { const: '.js' }, flowMode: { const: 'off' } }) });
const source = object({ path, sourceUnitId: { type: 'string', pattern: '^su1:[a-f0-9]{64}$' }, byteHash: hash, textHash: hash,
  textLength: count(16384), byteLength: count(65536), lineStarts: { ...list(count(16384), 32), minItems: 1 },
  parser: nullable(parser), declarationIds: list(nullable({ type: 'string', pattern: '^jsdecl1:[a-f0-9]{64}$' }), 8) });
const milliseconds = { type: 'number', minimum: 0 };
const claim = object({ tier: { const: 'independent-source-construction-grammar' }, relation: { const: 'exact-utf16-declaration-ranges-and-source-bytes' },
  outcome: { enum: ['pass', 'fail', 'unknown'] }, reason: nullable(text), counterexample: nullable(object({ expected: SOURCE_REVISION_OUTPUT_SCHEMA, actual: SOURCE_REVISION_OUTPUT_SCHEMA })) });
const checkpoint = { oneOf: [object({ index: count(16), checkpointId: id, stateId: hash, outcome: { const: 'not-run' }, reason: { const: 'run-work-budget' } }),
  object({ index: count(16), checkpointId: id, stateId: hash, outcome: { enum: ['pass', 'fail', 'unknown'] }, candidateExecutionId: text, rebuildExecutionId: text,
    candidateOutputId: hash, rebuildOutputId: hash, referenceOutputId: nullable(hash), sources: list(source, 8),
    claims: { type: 'array', minItems: 2, maxItems: 2, items: { oneOf: [claim,
      object({ tier: { const: 'same-implementation-clean-rebuild' }, relation: { const: 'exact-output-and-source-identities' }, outcome: { enum: ['pass', 'fail'] } })] } },
    work: object({ candidateMs: milliseconds, rebuildMs: milliseconds, referenceMs: milliseconds, parsedFiles: count(8), reusedFiles: count(8), removedFiles: count(8),
      parsedSourceBytes: count(65536), referenceFiles: count(8) }) })] };
export const SOURCE_REVISION_RECEIPT_SCHEMA = object({ schemaVersion: { const: 1 }, kind: { const: 'tiny-javascript-source-revision-run' },
  profile: { const: SOURCE_REVISION_PROFILE }, scenarioId: hash, executionId: text, family: id, seed: count(4294967295),
  outcome: { enum: ['pass', 'fail', 'unknown'] }, checkpoints: { ...list(checkpoint, 17), minItems: 1 },
  producer: object({ javascriptRelations: text, sourceChunking: text }),
  scope: { const: 'constructed-javascript-function-declarations; no-execution-or-index-publication' },
  candidateStrategy: { const: 'reuse-exact-unchanged-file; reparse-changed-file; retract-removed-file' },
  limits: object({ maxMs: { type: 'integer', minimum: 1, maximum: 1000 }, maxReferenceFiles: count(8), sourceBytes: { const: 65536 }, receiptBytes: { const: 262144 } }), elapsedMs: milliseconds });
