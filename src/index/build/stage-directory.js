import path from 'node:path';
import { createHash } from 'node:crypto';
import { inventoryBackendPayload, BACKEND_INVENTORY_LIMITS } from '../../shared/artifact-io/backend-payload-inventory.js';
import { resolveArtifactPath } from '../../shared/artifact-io/contained-path.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { assertLanceDbPayload } from '../../shared/lancedb.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';

const digest = value => createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const invalid = message => Object.assign(new Error(message), { code: 'ERR_COMPLETED_STAGE_INVALID' });
const variants = { dense_vectors_lancedb: 'merged', dense_vectors_doc_lancedb: 'doc', dense_vectors_code_lancedb: 'code' };
export const isStageDirectoryFamily = piece => Object.hasOwn(variants, piece?.name || '');

/** Final backend families are independent of the Stage2 file-copy contract.
 * No native module is activated; this qualifies shape and exact physical bytes. */
export const inventoryStageDirectory = async ({ outDir, piece, piecesByName, ambiguousNames, signal }) => {
  const variant = variants[piece.name];
  if (!isStageDirectoryFamily(piece) || ambiguousNames.has(piece.name) || ambiguousNames.has(piece.name + '_meta') || piece.type !== 'embeddings' || piece.format !== 'dir' || piece.bytes !== null
    || piece.checksum != null) throw invalid('Unsupported completed-stage directory family or representation.');
  const basename = variant === 'merged' ? 'dense_vectors.lancedb' : `dense_vectors_${variant}.lancedb`;
  const generation = /^\.embeddings-backends\/([a-f0-9]{64})-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.exec(path.posix.dirname(piece.path));
  if (!generation || path.posix.basename(piece.path) !== basename) throw invalid('Directory member lacks an immutable backend-generation path.');
  const metadataPiece = piecesByName.get(piece.name + '_meta');
  if (!metadataPiece || metadataPiece.type !== 'embeddings' || metadataPiece.format !== 'json'
    || metadataPiece.path !== piece.path + '.meta.json') throw invalid('Directory member lacks its canonical backend metadata member.');
  const dir = resolveArtifactPath(outDir, piece.path), metadataPath = resolveArtifactPath(outDir, metadataPiece.path);
  const { buffer, hash: metadataHash } = await readVerifiedContainedFile(outDir, metadataPath, { maxBytes: 1024 * 1024, signal });
  if (!Number.isSafeInteger(metadataPiece.bytes) || metadataPiece.bytes !== buffer.length
    || typeof metadataPiece.checksum === 'string' && metadataPiece.checksum.startsWith('sha256:')
      && metadataPiece.checksum !== 'sha256:' + metadataHash) throw invalid('Directory metadata extent/checksum differs from its manifest member.');
  const metadata = JSON.parse(buffer.toString('utf8')), identity = metadata.embeddingIdentity;
  if (metadata.version !== 1 || metadata.variant !== variant || metadata.backendGeneration !== path.posix.dirname(piece.path)
    || metadata.embeddingGeneration !== generation[1] || !identity || !Number.isSafeInteger(identity.version)
    || typeof metadata.model !== 'string' || !metadata.model || identity.modelId !== metadata.model
    || !Number.isSafeInteger(metadata.dims) || metadata.dims <= 0 || identity.dims !== metadata.dims
    || !Number.isSafeInteger(metadata.count) || metadata.count <= 0 || metadata.expectedCount !== metadata.count
    || metadata.count !== piece.count || metadata.dims !== piece.dims
    || metadataPiece.count !== piece.count || metadataPiece.dims !== piece.dims) throw invalid('Directory metadata differs from its backend/model/generation receipt.');
  const payload = await inventoryBackendPayload({ dir, signal });
  if (!payload) throw Object.assign(new Error('Directory inventory is unavailable within the native backend inventory bounds; publication is not admitted.'), {
    code: 'ERR_STAGE_DIRECTORY_INVENTORY_UNAVAILABLE', limits: BACKEND_INVENTORY_LIMITS
  });
  if (!payload.entries.length) throw invalid('A nonempty backend receipt cannot describe an empty directory.');
  const recorded = metadata.extensions?.nativePayloadInventory;
  if (recorded != null && digest(recorded) !== digest(payload)) throw invalid('Native backend inventory differs from the closed-writer receipt.');
  assertLanceDbPayload(dir, { table: metadata.table, count: metadata.count });
  // Metadata must remain the same after all payload reads and descriptor closes.
  await readVerifiedContainedFile(outDir, metadataPath, { maxBytes: 1024 * 1024, expectedHash: metadataHash, signal });
  let bytes = 0;
  for (const entry of payload.entries) if (entry.kind === 'file') {
    bytes += entry.bytes;
    if (!Number.isSafeInteger(bytes)) throw invalid('Directory inventory byte extent exceeds the safe integer range.');
  }
  const binding = { contract: 'lancedb-directory.v1', metadataPath: metadataPiece.path, metadataHash,
    embeddingGeneration: metadata.embeddingGeneration, backendGeneration: metadata.backendGeneration,
    embeddingIdentity: identity, variant, count: metadata.count, dims: metadata.dims, payload };
  return { path: piece.path, representation: 'directory', family: piece.name, bytes, hash: digest(binding), binding };
};
