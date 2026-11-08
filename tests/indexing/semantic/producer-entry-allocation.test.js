import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { createSemanticCollector } from '../../../src/index/semantic/javascript-collector.js';
import { createTypeScriptSemanticCollector } from '../../../src/index/semantic/typescript-collector.js';
import { prepareNativeSemanticSyntax, createNativeSemanticCollector } from '../../../src/index/semantic/native-syntax.js';
import { writeSemanticAnalysis } from '../../../src/index/semantic/analysis-write.js';
import { collectSemanticOwnership } from '../../../src/index/semantic/ownership.js';
import { createPreparedWorkInput, writePreparedWork } from '../../helpers/semantic-prepared-work.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
ensureTestingEnv(process.env);
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['javascript', 'typescript', 'native', 'analysis', 'ownership'].includes(selected));
const identifier = 'identifier' + 'x'.repeat(16384), language = selected === 'native' ? 'c' : selected === 'typescript' ? 'typescript' : 'javascript';
const text = selected === 'native' ? `int ${identifier} = 0;` : `const ${identifier} = 0;`;
const bytes = Buffer.from(text), source = createSemanticSourceSnapshot({ bytes, repositoryNamespace: 'fixture:producer-allocation', path: 'input.' + (selected === 'native' ? 'c' : 'js'), language }).manifest;
const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId, parser: { family: 'fixture', version: '1', options: {} },
  extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' } });
const { dir } = await prepareIsolatedTestCacheDir('semantic-producer-allocation');
let syntax;
try {
  const ownedInput = selected === 'ownership' ? createPreparedWorkInput('small') : null;
  const owned = ownedInput ? await writePreparedWork(path.join(dir, 'syntax'), ownedInput, 'plain') : null;
  const typescript = selected === 'typescript' ? prepareTypeScriptSyntax(text, { ext: '.ts', fileName: 'input.ts' }) : null;
  const ast = selected === 'javascript' ? parse(text, { sourceType: 'module' }).program : typescript?.sourceFile;
  if (selected === 'native') {
    syntax = await prepareNativeSemanticSyntax({ text, language });
    assert.ok(syntax.tree, 'actual native parser returns an owned tree');
    assert.equal(syntax.tree.rootNode.hasError, false);
    assert.equal(syntax.textHash, source.textHash);
  }
  const stringify = JSON.stringify, stackTraceLimit = Error.stackTraceLimit; let largeEncodings = 0;
  Error.stackTraceLimit = 64;
  JSON.stringify = (value, ...args) => {
    // Ownership's separate chunk-policy identity legitimately includes the UID.
    // Attribute only the prepared-entry encoder, rather than counting that hash.
    if (typeof value === 'string' && value.includes(identifier)
      && (selected !== 'ownership' || new Error().stack.includes('prepared-batch.js:'))) largeEncodings++;
    return stringify(value, ...args);
  };
  let error;
  try {
    if (selected === 'ownership') {
      await collectSemanticOwnership({ facts: { source: ownedInput.source, partition: owned.descriptor, coverage: [] },
        chunks: [{ start: 0, end: ownedInput.source.textLength, chunkUid: identifier }], bytes: ownedInput.bytes,
        repositoryNamespace: dir, stagingRoot: path.join(dir, 'syntax'), diskAccount: owned.account,
        policy: { storage: { batchRows: 16, batchBytes: 1024 } } });
    } else if (selected === 'analysis') {
      await writeSemanticAnalysis({ rows: [{ family: 'lookup', row: { kind: 'name', id: 0, value: identifier } }],
        stagingRoot: dir, source, sourceBytes: bytes, partitionId, producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64),
        diskAccount: createSemanticDiskAccount(1024 * 1024), policy: { storage: { batchRows: 16, batchBytes: 1024, maxQueuedBytes: 2048 } } });
    } else {
      const create = selected === 'native' ? createNativeSemanticCollector : selected === 'typescript' ? createTypeScriptSemanticCollector : createSemanticCollector;
      const collector = create({ text, ast, ts: typescript?.ts, syntax, source, partitionId }, { batchRows: 16, batchBytes: 1024 });
      for (const batch of collector.batches) assert.ok(batch.byteCount <= 1024);
    }
  } catch (failure) { error = failure; }
  finally { JSON.stringify = stringify; Error.stackTraceLimit = stackTraceLimit; }
  assert.equal(error?.code, ['analysis', 'ownership'].includes(selected) ? 'ERR_SEMANTIC_CONTRACT' : 'ERR_SEMANTIC_RECORD_LIMIT', String(error));
  assert.equal(largeEncodings, 0, 'producer rejects the leaf before allocating its encoded JSON string');
  if (selected === 'ownership') {
    const syntaxFile = path.join(dir, 'syntax', owned.descriptor.members.semantic_records[0].path);
    assert.ok((await fs.stat(syntaxFile)).size > 0, 'failed ownership preserves the source syntax partition');
  } else assert.deepEqual(await fs.readdir(dir), [], 'refused analysis clears its task-owned staging');
} finally { await syntax?.close?.(); await fs.rm(dir, { recursive: true, force: true }); }
console.log(`${selected} semantic producer bounds prepared entry allocation`);
