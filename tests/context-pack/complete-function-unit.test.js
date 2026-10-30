import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assembleCompositeContextPack, clearContextPackCaches } from '../../src/context-pack/assemble.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { COMPOSITE_CONTEXT_PACK_SCHEMA } from '../../src/contracts/schemas/analysis/context-pack.js';
import { compileSchema, createAjv } from '../../src/shared/validation/ajv-factory.js';
import { FUNCTION_UNIT_SOURCE_MAX_BYTES } from '../../src/context-pack/function-unit.js';

// UNVALIDATED: real parser, contained source and assembler; no child/addon.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['javascript', 'typescript', 'jsx', 'tsx', 'method', 'nested', 'partial', 'retained-fragment',
  'retained-mismatch', 'malformed', 'source-drift', 'cannot-fit', 'large-file-small-unit', 'source-read-limit',
  'work-limit', 'unsupported', 'cancelled', 'contract'].includes(selected));
const parent = path.resolve('.tmp/tasks'); fs.mkdirSync(parent, { recursive: true });
const root = fs.mkdtempSync(path.join(parent, 'function-edit-'));
let prefix = '\uFEFF// e\u0301 😀\r\n', target = 'export function target(value) {\r\n\tconst label = "界😀";\r\n\treturn label + value;\r\n}',
  suffix = '\r\nfunction adjacent() { return 2; }\r\n', ext = '.js';
if (selected === 'typescript') {
  ext = '.ts'; prefix = 'type Box<T> = { value: T };\r\n';
  target = 'export function target<T>(value: Box<T>): T {\r\n\treturn value.value;\r\n}';
}
if (selected === 'jsx' || selected === 'tsx') {
  ext = selected === 'jsx' ? '.jsx' : '.tsx'; prefix = '// generated views remain complete syntax\r\n';
  target = selected === 'jsx' ? 'export const Target = ({ value }) => <section>{value}</section>;'
    : 'export const Target = (value: { name: string }) => <section>{value.name}</section>;';
}
if (selected === 'method') {
  prefix = 'class Container {\r\n\t'; target = 'async target(value) {\r\n\t\treturn "界😀" + value;\r\n\t}'; suffix = '\r\n}\r\n';
}
if (selected === 'nested') target = 'export function target() {\n  function nested() { return 1; }\n  return nested();\n}';
if (selected === 'malformed') target = 'export function target() { return (';
if (selected === 'unsupported') { ext = '.py'; prefix = ''; target = 'def target():\n\treturn 1\n'; suffix = ''; }
if (selected === 'large-file-small-unit') prefix = '/*' + 'x'.repeat(140000) + '*/\n';
if (selected === 'source-read-limit') prefix = '/*' + 'x'.repeat(FUNCTION_UNIT_SOURCE_MAX_BYTES) + '*/\n';
const source = prefix + target + suffix, file = path.join(root, `source${ext}`);
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const start = prefix.length, end = start + target.length;
const chunk = { chunkUid: 'function-seed', file: `source${ext}`, kind: 'FunctionDeclaration', start, end,
  fileHash: digest(source), fileHashAlgo: 'sha256' };
const policy = { schemaVersion: 1, task: 'edit-safe', granularity: 'function', wholeFileFallback: false };
const input = { repoRoot: root, seed: { type: 'chunk', chunkUid: chunk.chunkUid }, chunkMeta: [chunk],
  includeGraph: false, strictEvidence: true, indexSignature: 'pinned-function-generation', taskPolicy: policy };
const run = overrides => assembleCompositeContextPack({ ...input, ...overrides });
const schema = compileSchema(createAjv({ strict: true, allErrors: true, allowUnionTypes: true }), COMPOSITE_CONTEXT_PACK_SCHEMA);
try {
  fs.writeFileSync(file, source);
  if (['partial', 'retained-fragment', 'retained-mismatch'].includes(selected)) {
    chunk.start = source.indexOf('return label'); chunk.end = chunk.start + 'return label'.length;
    if (selected === 'retained-fragment') chunk.meta = { definitionStart: start, definitionEnd: end };
    if (selected === 'retained-mismatch') chunk.meta = { definitionStart: source.indexOf('function adjacent'), definitionEnd: source.lastIndexOf('}') + 1 };
  }
  if (['partial', 'retained-mismatch', 'malformed', 'unsupported', 'source-read-limit', 'work-limit'].includes(selected)) {
    assert.throws(() => run(selected === 'work-limit' ? { caps: { maxWorkUnits: 0 } } : {}), { code: 'ERR_CONTEXT_PACK_UNIT_UNAVAILABLE' });
    if (selected === 'partial' || selected === 'malformed' || selected === 'unsupported') {
      const fallback = run({ taskPolicy: { ...policy, wholeFileFallback: true } });
      assert.equal(fallback.primary.excerpt, source); assert.equal(fallback.primary.unit.granularity, 'file');
      assert.equal(fallback.primary.unit.schemaVersion, 1); assert.equal(fallback.primary.unit.fallbackUsed, true);
      assert.equal(validateCompositeContextPack(fallback).ok, true);
    }
  } else if (selected === 'source-drift') {
    fs.writeFileSync(file, source.replace('target', 'edited'));
    assert.throws(() => run(), { code: 'ERR_CONTEXT_PACK_SOURCE_MISMATCH' });
  } else if (selected === 'cancelled') {
    const controller = new AbortController(); controller.abort();
    assert.throws(() => run({ signal: controller.signal }), { name: 'AbortError' });
  } else if (selected === 'cannot-fit') {
    for (const limits of [{ maxBytes: Buffer.byteLength(target) - 1 }, { maxTokens: 1 }]) {
      assert.throws(() => run(limits), { code: 'ERR_CONTEXT_PACK_UNIT_CANNOT_FIT' });
      assert.throws(() => run({ ...limits, taskPolicy: { ...policy, wholeFileFallback: true } }),
        { code: 'ERR_CONTEXT_PACK_UNIT_CANNOT_FIT' }, 'a qualified mandatory function cannot be clipped or replaced by a fallback to fit');
    }
  } else {
    const pack = run(selected === 'large-file-small-unit' ? { maxBytes: 512 } : {}), unit = pack.primary.unit;
    assert.equal(pack.primary.excerpt, target, 'verbatim parser-qualified original unit, without adjacent statements');
    assert.equal(unit.schemaVersion, 2); assert.equal(unit.granularity, 'function'); assert.equal(unit.fallbackUsed, false);
    assert.deepEqual(unit.span, [start, end]); assert.equal(unit.sourceLength, source.length);
    assert.equal(unit.sourceHash, 'sha256:' + digest(source)); assert.equal(unit.contentHash, 'sha256:' + digest(target));
    assert.equal(unit.byteLength, Buffer.byteLength(target)); assert.ok(unit.parser.family); assert.ok(unit.parser.version);
    assert.equal(pack.primary.evidence.sourceIdentity.drift, 'unchanged');
    assert.equal(validateCompositeContextPack(pack).ok, true); assert.equal(schema(pack), true);
    if (selected === 'contract') {
      for (const change of [copy => { copy.primary.excerpt = copy.primary.excerpt.slice(1); },
        copy => { copy.primary.unit.span[1]++; }, copy => { copy.primary.unit.sourceLength = 1; },
        copy => { copy.primary.unit.schemaVersion = 1; }, copy => { copy.primary.unit.fallbackUsed = true; },
        copy => { copy.primary.unit.sourceHash = 'sha256:' + 'a'.repeat(64); },
        copy => { copy.primary.unit.contentHash = 'sha256:' + 'a'.repeat(64); }]) {
        const copy = structuredClone(pack); change(copy); assert.equal(validateCompositeContextPack(copy).ok, false);
      }
    }
  }
} finally { clearContextPackCaches(); fs.rmSync(root, { recursive: true, force: true }); }
console.log(`Complete original function edit unit: ${selected}`);
