import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createPreparedWorkInput, writePreparedWork } from '../../helpers/semantic-prepared-work.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { prepareSemanticBatchEntry, prepareSemanticProducerEntry, semanticBatchEntryBytes, readPreparedSemanticBatchEntry } from '../../../src/index/semantic/prepared-batch.js';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
ensureTestingEnv(process.env);
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const { dir } = await prepareIsolatedTestCacheDir('semantic-prepared-parity');
try {
  if (['small', 'nodes', 'operands', 'mixed', 'short-writes', 'mutation', 'forged-bytes'].includes(selected)) {
    const shape = ['short-writes', 'mutation', 'forged-bytes'].includes(selected) ? 'small' : selected;
    const input = createPreparedWorkInput(shape);
    const plain = await writePreparedWork(path.join(dir, 'plain'), input, 'plain', { shortWrites: selected === 'short-writes' });
    const preparedInput = createPreparedWorkInput(shape);
    if (selected === 'forged-bytes') Object.assign(preparedInput.rows[0], { rowJson: '{"id":999}', encoded: Buffer.from('{"id":999}').toString('base64'), byteCount: 1 });
    const prepared = await writePreparedWork(path.join(dir, 'prepared'), preparedInput, 'prepared', {
      shortWrites: selected === 'short-writes', mutate: selected === 'mutation' ? () => { preparedInput.rows[0].row.id = 999; } : null
    });
    assert.deepEqual(prepared.projection, plain.projection, 'all stored bytes, offsets, hashes, counts and logical identities');
    assert.equal(prepared.diskBytes, plain.diskBytes);
    assert.ok(prepared.descriptor.members.semantic_records.reduce((sum, part) => sum + part.count, 0) > 0);
    if (selected === 'operands') assert.equal(prepared.descriptor.members.semantic_operands.reduce((sum, part) => sum + part.count, 0), 32);
    if (selected === 'mixed') for (const family of ['semantic_lookup', 'semantic_edges', 'semantic_coverage', 'semantic_ownership']) {
      assert.ok(prepared.descriptor.members[family].length > 0, family);
    }
  } else if (selected === 'prepared-budget') {
    const entry = { family: 'node', row: { data: '界😀"\\\n'.repeat(8192) } };
    let encodings = 0; const stringify = JSON.stringify;
    JSON.stringify = (value, ...args) => { if (value === entry.row.data) encodings++; return stringify(value, ...args); };
    try { assert.throws(() => prepareSemanticProducerEntry(entry, 1024), { code: 'ERR_SEMANTIC_RECORD_LIMIT' }); }
    finally { JSON.stringify = stringify; }
    assert.equal(encodings, 0, 'refuse a known oversized leaf before JSON escape allocation');
    const valid = prepareSemanticBatchEntry({ family: 'lookup', row: { kind: 'name', id: 0, value: '界😀' } });
    const bytes = semanticBatchEntryBytes(valid);
    assert.throws(() => { valid.row.value = 'mutated'; }, TypeError);
    assert.throws(() => { readPreparedSemanticBatchEntry(valid).rowJson = '{"id":999}'; }, TypeError);
    assert.equal(prepareSemanticProducerEntry(valid, bytes), valid);
    assert.throws(() => prepareSemanticProducerEntry(valid, bytes - 1), { code: 'ERR_SEMANTIC_RECORD_LIMIT' });
    for (const primary of [null, undefined, false, Object.freeze(Object.assign(new Error('original'), { code: 'ERR_SEMANTIC_JSON_BUDGET' }))]) {
      assert.throws(() => prepareSemanticProducerEntry({ family: 'lookup', row: { nested: [] } }, 1024, () => { throw primary; }), error => Object.is(error, primary));
    }
    const spoof = Object.freeze(Object.assign(new RangeError('foreign budget-looking error'), { code: 'ERR_SEMANTIC_JSON_BUDGET' }));
    let checks = 0;
    assert.throws(() => prepareSemanticProducerEntry({ family: 'lookup', row: { nested: [] } }, 1024, () => {
      if (++checks === 2) throw spoof;
    }), error => error === spoof);
  } else {
    assert.ok(['byte-count', 'schema', 'oversize', 'copied-receipt', 'abort', 'abort-write', 'write-error'].includes(selected));
    const outcomes = [];
    for (const arm of ['plain', 'prepared']) {
      const input = createPreparedWorkInput('small'), account = createSemanticDiskAccount(1024 * 1024), controller = new AbortController();
      const root = path.join(dir, arm);
      const originalOpen = fs.open;
      const injected = Object.freeze(Object.assign(new Error('original write failure'), { code: 'FIXTURE_WRITE_FAILURE' }));
      let writeCalls = 0, writtenBytes = 0;
      const sink = await createSemanticPartitionSink({ stagingRoot: root, source: input.source, sourceBytes: input.bytes,
        partitionId: input.partitionId, producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), diskAccount: account,
        batchRows: 64, batchBytes: 1024, signal: controller.signal });
      let raw = input.rows[0];
      if (selected === 'schema') raw.row.id = -1;
      if (selected === 'oversize') raw = { family: 'lookup', row: { kind: 'name', id: 0, value: 'x'.repeat(4096) } };
      let entry = arm === 'prepared' ? prepareSemanticBatchEntry(raw) : raw;
      let byteCount = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      if (selected === 'copied-receipt') {
        const actual = prepareSemanticBatchEntry(raw);
        entry = { ...actual, row: { ...actual.row, id: -1 }, rowJson: '{"id":0}', byteCount: 1 };
        byteCount = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      }
      if (selected === 'byte-count') byteCount++;
      if (selected === 'abort') controller.abort();
      if (selected === 'abort-write' || selected === 'write-error') fs.open = async (...args) => {
        const handle = await originalOpen(...args);
        if (String(args[0]).endsWith('.building')) {
          const write = handle.write.bind(handle);
          handle.write = async (...input) => {
            writeCalls++;
            if (selected === 'write-error') throw injected;
            const result = await write(...input); writtenBytes += result.bytesWritten;
            controller.abort(); return result;
          };
        }
        return handle;
      };
      try {
        await assert.rejects(sink.appendBatch({ partitionId: input.partitionId, sequence: 0, rows: [entry], byteCount }), error => {
          if (selected === 'write-error') assert.equal(error, injected);
          outcomes.push({ code: error.code, name: error.name }); return true;
        });
      } finally { fs.open = originalOpen; }
      if (selected === 'abort-write') { assert.equal(writeCalls, 1); assert.ok(writtenBytes > 0, 'abort follows an actual partial-family durable write'); }
      if (selected === 'write-error') assert.equal(writeCalls, 1);
      await sink.abort(); assert.equal(account.used, 0);
      assert.deepEqual(await fs.readdir(root), [], 'invalid rows cannot publish physical data');
    }
    assert.deepEqual(outcomes[0], outcomes[1], 'preserve plain/prepared rejection taxonomy');
    assert.equal(outcomes[0].code, selected.startsWith('abort') ? 'ABORT_ERR'
      : selected === 'write-error' ? 'FIXTURE_WRITE_FAILURE' : 'ERR_SEMANTIC_CONTRACT');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`semantic prepared sink ${selected} retains canonical bytes and admission`);
