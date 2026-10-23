import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRecoveryFixture, semanticNode } from './semantic-recovery.js';
import { writeSemanticQueryIndex } from '../../src/index/build/artifacts/writers/semantic/query-index.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../src/semantic/operation-index.js';
import { assertSemanticOperationIndex } from '../../src/contracts/validators/semantic-operation-index.js';
import { writePiecesManifest } from '../../src/index/build/artifacts/checksums.js';
import { getBuildsRoot, getRepoRoot } from '../../src/shared/repo-paths.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';

/** Real partition/index writers and registrations, without a repository index. */
export const createSemanticServingFixture = async ({ withOperands = false } = {}) => {
  const fixture = await createRecoveryFixture('first(); second();');
  const repoRoot = getRepoRoot(fixture.root);
  try {
    const rows = [semanticNode(0, 8), semanticNode(1, fixture.source.textLength)];
    if (withOperands) rows.push({ family: 'operand', row: {
      parent: { partitionId: fixture.partitionId, localId: 0 }, slot: 'argument', ordinal: 0,
      child: { partitionId: fixture.partitionId, localId: 1 }, flags: []
    } });
    const partition = await fixture.write(rows);
    const store = fixture.store([partition]);
    const options = { root: fixture.stagingRoot, generation: fixture.generation, partitions: [partition],
      store, diskAccount: fixture.account, batchRows: 128, batchBytes: 65536 };
    const queryIndex = await writeSemanticQueryIndex(options);
    const operationIndex = await writeSemanticQueryIndex({ ...options,
      entries: operationIndexEntries(store, [partition]), compareRows: compareOperationIndexRows,
      keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
      directoryPrefix: 'semantic-operation-index-', schemaVersion: 2 });
    const manifest = { schemaVersion: 1, semanticSchemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      generation: fixture.generation, status: 'partial', partitions: [partition], warnings: ['A'], completedTasks: [] };
    const indexDir = path.join(getBuildsRoot(repoRoot, {}), fixture.generation.baseBuildId, 'index-code');
    await fs.mkdir(indexDir, { recursive: true });
    await fs.rename(fixture.stagingRoot, path.join(indexDir, 'semantic'));
    const entries = [];
    const register = (name, relativePath, checksum = null) => entries.push({ name, path: relativePath,
      type: 'semantic', format: relativePath.endsWith('.json') ? 'json' : relativePath.endsWith('.jsonl') ? 'jsonl' : 'binary',
      count: 0, ...(checksum ? { checksum } : {}) });
    for (const [member, pieces] of Object.entries(partition.members)) for (const piece of pieces) {
      register(member, 'semantic/' + piece.path, 'sha256:' + piece.hash);
      register(member + '_offsets', 'semantic/' + piece.offsetsPath, 'sha256:' + piece.offsetsHash);
    }
    for (const [name, value] of Object.entries({ semantic_manifest: manifest,
      semantic_query_index: queryIndex, semantic_operation_index: operationIndex })) {
      const bytes = Buffer.from(JSON.stringify(value) + ' '.repeat(65536));
      await fs.writeFile(path.join(indexDir, name + '.json'), bytes);
      register(name, name + '.json', 'sha256:' + createHash('sha256').update(bytes).digest('hex'));
    }
    for (const [name, index] of [['query', queryIndex], ['operation', operationIndex]]) for (const piece of index.pieces) {
      register('semantic_' + name + '_index_rows', 'semantic/' + piece.path, 'sha256:' + piece.hash);
      register('semantic_' + name + '_index_offsets', 'semantic/' + piece.offsetsPath, 'sha256:' + piece.offsetsHash);
    }
    await writePiecesManifest({ pieceEntries: entries, outDir: indexDir, mode: 'code',
      indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: fixture.generation.baseBuildId } });
    const registrationPath = path.join(indexDir, 'pieces', 'manifest.json');
    const registration = JSON.parse(await fs.readFile(registrationPath, 'utf8'));
    const originals = new Map(await Promise.all(['semantic_manifest', 'semantic_query_index', 'semantic_operation_index']
      .map(async name => [name, await fs.readFile(path.join(indexDir, name + '.json'))])));
    const restore = async () => {
      for (const [name, bytes] of originals) await fs.writeFile(path.join(indexDir, name + '.json'), bytes);
      await fs.writeFile(registrationPath, JSON.stringify(registration));
    };
    return { ...fixture, root: repoRoot, indexDir, manifest, partition, queryIndex, operationIndex, originals, registration,
      registrationPath, restore, ref: { partitionId: partition.partitionId, localId: 0 } };
  } catch (error) { await fixture.cleanup(); throw error; }
};
