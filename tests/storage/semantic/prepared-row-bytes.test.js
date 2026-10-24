#!/usr/bin/env node
import { prepareSemanticBatchEntry, semanticBatchEntryBytes, readPreparedSemanticBatchEntry } from '../../../src/index/semantic/prepared-batch.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { canonicalSemanticJson, createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSemanticDiskAccount, createSemanticPartitionSink } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
applyTestEnv();
const bytes = Buffer.from('f();'), source = createSemanticSourceSnapshot({ bytes, repositoryNamespace: 'fixture:prepared', path: 'source.js', language: 'javascript' }).manifest;
const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId, parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' } });
const row = { id: 0, kind: 'expression', span: [0, source.textLength], scope: null, data: { astKind: 'CallExpression', operation: null, invocationKind: 'call', syntacticArgumentCount: 0, flags: [] } };
const entry = { family: 'node', row }; let captures = 0, captured = null;
const envelope = canonicalSemanticJson(entry, { onObjectEncoded(value, encoded) { if (value === row) { captures += 1; captured = encoded; } } });
assert.equal(captures, 1); assert.equal(captured, canonicalSemanticJson(row));
const root = resolveTestCachePath(process.cwd(), 'semantic-prepared-row-bytes'); await fs.mkdir(root, { recursive: true });
const sink = await createSemanticPartitionSink({ stagingRoot: root, source, sourceBytes: bytes, partitionId, producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), diskAccount: createSemanticDiskAccount(1024 * 1024), byteAdmission: { async acquire() { row.id = 999; return () => {}; } } });
await sink.appendBatch({ partitionId, sequence: 0, rows: [entry], byteCount: Buffer.byteLength(envelope) + 1 });
const descriptor = await sink.finalizeSource();
assert.equal((await fs.readFile(path.join(root, descriptor.members.semantic_records[0].path), 'utf8')).trim(), captured, 'admitted bytes cannot be mutated by the producer while awaiting IO');

const prepared = prepareSemanticBatchEntry({ family: 'node', row: { nested: { value: 1 } } });
assert.throws(() => { prepared.row.nested.value = 2; }, TypeError);
assert.equal(prepareSemanticBatchEntry(prepared), prepared);
assert.equal(semanticBatchEntryBytes(prepared), Buffer.byteLength(canonicalSemanticJson(prepared)) + 1);
assert.equal(readPreparedSemanticBatchEntry({ ...prepared }), null, 'a shape-compatible copy cannot forge a prepared receipt');
assert.equal(readPreparedSemanticBatchEntry(prepared).rowJson, canonicalSemanticJson(prepared.row));
