import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assembleCompositeContextPack, clearContextPackCaches } from '../../src/context-pack/assemble.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { COMPOSITE_CONTEXT_PACK_SCHEMA } from '../../src/contracts/schemas/analysis/context-pack.js';
import { compileSchema, createAjv } from '../../src/shared/validation/ajv-factory.js';
import { buildCliContextPackRequestInput } from '../../src/shared/context-pack-request.js';
import { renderCompositeContextPackJson } from '../../src/retrieval/output/composite-context-pack.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-context-task-'));
const file = path.join(root, 'source.js');
const original = '\uFEFF// e\u0301 😀\r\n\texport function first() {\r\n\t  return "界";\r\n\t}\r\n\r\nfunction second() { return 2; }\r\n';
const digest = (text, algorithm = 'sha256') => createHash(algorithm).update(text).digest('hex');
const policy = { schemaVersion: 1, task: 'edit-safe', granularity: 'file', wholeFileFallback: false };
const chunk = { chunkUid: 'seed', file: 'source.js', kind: 'FunctionDeclaration', start: 10, end: 25,
  fileHash: digest(original), fileHashAlgo: 'sha256' };
const input = { repoRoot: root, seed: { type: 'chunk', chunkUid: 'seed' }, chunkMeta: [chunk],
  includeGraph: false, indexSignature: 'retained-original-generation', strictEvidence: true };
const run = overrides => assembleCompositeContextPack({ ...input, taskPolicy: policy, ...overrides });
const schema = compileSchema(createAjv({ allErrors: true, allowUnionTypes: true, strict: true }), COMPOSITE_CONTEXT_PACK_SCHEMA);
try {
  fs.writeFileSync(file, original);
  for (const [text, algorithm] of [[original, 'sha256'], [original.replaceAll('\r\n', '\n'), 'sha1']]) {
    fs.writeFileSync(file, text);
    const pack = run({ chunkMeta: [{ ...chunk, fileHash: digest(text, algorithm), fileHashAlgo: algorithm }] });
    assert.equal(Buffer.compare(Buffer.from(pack.primary.excerpt), fs.readFileSync(file)), 0, 'verbatim original UTF-8, whitespace and BOM');
    assert.equal(pack.evidence.complete, true); assert.equal(pack.primary.unit.byteLength, Buffer.byteLength(text));
    assert.deepEqual(pack.primary.unit.span, [0, text.length]); assert.equal(pack.primary.unit.indexSignature, input.indexSignature);
    assert.equal(validateCompositeContextPack(pack).ok, true); assert.equal(schema(pack), true);
    const clipped = structuredClone(pack); clipped.primary.excerpt = clipped.primary.excerpt.slice(1);
    assert.equal(validateCompositeContextPack(clipped).ok, false);
    const falseSafe = structuredClone(pack); falseSafe.primary.evidence.truncated = true;
    assert.equal(schema(falseSafe), false);
    const undeclared = structuredClone(pack); delete undeclared.evidence.policy.taskPolicy;
    assert.equal(schema(undeclared), false);
  }
  fs.writeFileSync(file, original);
  assert.equal(assembleCompositeContextPack({ ...input }).evidence.policy.taskPolicy, undefined);
  const explored = run({ taskPolicy: { schemaVersion: 1, task: 'exploration', granularity: 'excerpt' }, strictEvidence: false, maxTokens: 1 });
  assert.equal(explored.primary.unit, undefined); assert.equal(explored.primary.evidence.truncatedTokens, true);
  assert.equal(explored.evidence.complete, false);
  assert.throws(() => run({ taskPolicy: { ...policy, granularity: 'function' } }), { code: 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE' });
  const fallback = run({ taskPolicy: { ...policy, granularity: 'function', wholeFileFallback: true } });
  assert.equal(fallback.primary.excerpt, original); assert.equal(fallback.primary.unit.fallbackUsed, true);
  for (const limits of [{ maxBytes: Buffer.byteLength(original) - 1 }, { maxTokens: 1 }]) {
    assert.throws(() => run(limits), { code: 'ERR_CONTEXT_PACK_UNIT_CANNOT_FIT' });
  }
  assert.throws(() => run({ caps: { maxWallClockMs: 0 } }), { code: 'ERR_CONTEXT_PACK_UNIT_DEADLINE' });
  for (const taskPolicy of [{ ...policy, schemaVersion: 2 }, { ...policy, granularity: 'excerpt' },
    { ...policy, task: 'exploration' }, { ...policy, unrecognized: true }]) {
    assert.throws(() => run({ taskPolicy }), { code: 'ERR_CONTEXT_PACK_INVALID_REQUEST' });
  }
  assert.throws(() => run({ chunkMeta: [{ ...chunk, fileHash: null }] }), { code: 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE' });
  fs.writeFileSync(file, original + '// drift');
  assert.throws(() => run(), { code: 'ERR_CONTEXT_PACK_SOURCE_MISMATCH' });
  fs.writeFileSync(file, original);
  assert.equal(run().primary.excerpt, original, 'a rejected request cannot publish edited source under the old generation');
  assert.throws(() => run({ chunkMeta: [{ ...chunk, file: '../outside.js' }] }), { code: 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE' });
  fs.rmSync(file);
  assert.throws(() => run(), { code: 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE' });
  const large = 'x'.repeat(70000); fs.writeFileSync(file, large);
  const retained = run({ chunkMeta: [{ ...chunk, fileHash: digest(large) }] });
  assert.throws(() => renderCompositeContextPackJson(retained), { code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' });
  assert.equal(retained.primary.excerpt, large, 'final JSON overflow cannot clip an intact edit unit');
  const projected = buildCliContextPackRequestInput({ task: 'edit-safe', granularity: 'file', wholeFileFallback: false });
  assert.deepEqual(projected.taskPolicy, policy);
} finally { clearContextPackCaches(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Context task policies preserve intact verified files and reject unsafe or oversized mandatory units.');
