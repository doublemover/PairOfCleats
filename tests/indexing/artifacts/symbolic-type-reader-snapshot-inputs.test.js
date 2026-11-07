import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTypeIrArena, serializeTypeIrRoots } from '../../../src/index/tooling/typescript/type-ir/index.js';
import { createSymbolicTypeGraph } from '../../../src/shared/symbolic-types.js';
import { enqueueSymbolicTypeArtifacts } from '../../../src/index/build/artifacts/writers/symbolic-types.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { loadPiecesManifest } from '../../../src/shared/artifact-io/manifest-read.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { openPublishedSymbolicTypeStore } from '../../../src/semantic/symbolic-type-store.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-symbolic-reader-input-'));
const originalOpen = fs.open;
try {
  applyTestEnv({ cacheRoot: path.join(root, 'cache') });
  const generation = { baseBuildId: 'symbolic-reader-input', semanticRevision: 0 };
  const arena = createTypeIrArena({ contextKey: 'typescript:owned-reader-input' }), word = arena.literal('fixture');
  const graph = createSymbolicTypeGraph(serializeTypeIrRoots(arena, [word]));
  const ref = { schemaVersion: 1, domain: 'finite-string', graphId: graph.graphId, contextKey: arena.contextKey, nodeId: word.id };
  const registry = createArtifactPieceRegistry({ outDir: root }), jobs = [];
  enqueueSymbolicTypeArtifacts({ state: { chunks: [], symbolicTypeGraphs: [graph] }, outDir: root,
    indexState: { buildId: generation.baseBuildId }, addPieceFile: registry.addPieceFile,
    declareArtifactFamily() {}, enqueueWrite: (_name, run) => jobs.push(run) });
  for (const run of jobs) await run();
  await writePiecesManifest({ pieceEntries: registry.listPieceEntries(), outDir: root, mode: 'code',
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: generation.baseBuildId } });
  const manifestFile = path.join(root, 'symbolic_type_manifest.json');
  const open = (inputGeneration = generation, signal = null) => openPublishedSymbolicTypeStore({
    indexDir: root, repoRoot: root, generation: inputGeneration, signal });
  const query = { ref, operation: 'membership', value: 'fixture' };
  {
    const input = { ...generation }, cached = loadPiecesManifest(root, { repoRoot: root, maxBytes: 2 * 1024 * 1024 });
    const piece = cached.pieces.find(piece => piece.name === 'symbolic_type_manifest'), checksum = piece.checksum;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args), read = handle.read;
      handle.read = function (...readArgs) {
        input.baseBuildId = 'mutated'; piece.checksum = 'xxh64:' + '0'.repeat(16);
        return read.call(handle, ...readArgs);
      };
      return handle;
    };
    try { assert.equal((await (await open(input)).query(query)).contains, true); }
    finally { fs.open = originalOpen; piece.checksum = checksum; }
  }
  for (const count of [NaN, -1, 65537, 0]) {
    let closes = 0;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args), close = handle.close;
      handle.read = async () => ({ bytesRead: count });
      handle.close = async function () { closes++; return close.call(handle); };
      return handle;
    };
    try { await assert.rejects(open(), error => error.reason === 'symbolic_type_corrupt'); }
    finally { fs.open = originalOpen; }
    assert.equal(closes, 1, 'invalid read counts fail inside the original descriptor owner');
  }
  {
    let closes = 0, reads = 0;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args), read = handle.read, close = handle.close;
      handle.read = async function (...readArgs) { reads++; return reads === 1 ? read.call(handle, ...readArgs) : { bytesRead: NaN }; };
      handle.close = async function () { closes++; return close.call(handle); };
      return handle;
    };
    try { await assert.rejects(open(), error => error.reason === 'symbolic_type_corrupt'); }
    finally { fs.open = originalOpen; }
    assert.equal(reads, 2); assert.equal(closes, 1);
  }
  {
    const controller = new AbortController(); let reads = 0, closes = 0;
    fs.open = async (file, ...args) => {
      assert.equal(String(file), manifestFile);
      const handle = await originalOpen(file, ...args), read = handle.read, close = handle.close;
      handle.read = async function (...readArgs) { reads++; const result = await read.call(handle, ...readArgs); controller.abort(); return result; };
      handle.close = async function () { closes++; return close.call(handle); };
      return handle;
    };
    try { await assert.rejects(open(generation, controller.signal), { code: 'ABORT_ERR' }); }
    finally { fs.open = originalOpen; }
    assert.equal(reads, 1, 'cancellation avoids a further EOF or checksum pass'); assert.equal(closes, 1);
  }
} finally { fs.open = originalOpen; await fs.rm(root, { recursive: true, force: true }); }
console.log('Symbolic readers own registration/generation inputs and bound original read counts and cancellation.');
