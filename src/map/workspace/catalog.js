import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { SEMANTIC_MEMBER_NAMES } from '../../contracts/schemas/semantic-envelopes.js';
import { createHash, randomUUID } from 'node:crypto';
import { getIndexDir } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { loadPiecesManifest } from '../../shared/artifact-io/manifest.js';
import { loadJsonArrayArtifactRows, loadJsonObjectArtifact } from '../../shared/artifact-io/loaders/core.js';
import { ARTIFACT_SCHEMA_DEFS, MANIFEST_ONLY_ARTIFACT_NAMES } from '../../contracts/schemas/artifacts.js';
const MAX_READ_BYTES = 2 * 1024 * 1024;
const arraySchema = schema => schema?.type === 'array' || schema?.anyOf?.some(item => item.type === 'array');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const classify = name => /^(semantic|symbolic)/.test(name) ? 'semantic' : /^(symbols|symbol_|call_sites|graph_|file_relations)/.test(name) ? 'relations'
  : /risk|flow/.test(name) ? 'risk' : /dense_|token_|minhash|vocab|postings/.test(name) ? 'retrieval'
    : /chunk_|file_meta|repo_map|vfs|extraction/.test(name) ? 'source' : 'index';
export const artifactInventory = () => [...new Set([...Object.keys(ARTIFACT_SCHEMA_DEFS), ...MANIFEST_ONLY_ARTIFACT_NAMES])].sort().map(name => ({
  name, family: classify(name), logicalSchema: Boolean(ARTIFACT_SCHEMA_DEFS[name]),
  mode: MANIFEST_ONLY_ARTIFACT_NAMES.includes(name) ? 'metadata' : arraySchema(ARTIFACT_SCHEMA_DEFS[name]) ? 'rows' : 'object'
}));
async function* semanticRows(dir, repoRoot, name) {
  const { store, manifest } = await openPublishedSemanticStore({ indexDir: dir, repoRoot });
  for (const partition of manifest.partitions) {
    for await (const row of store.iterateRows(partition.partitionId, name)) {
      yield { partitionId: partition.partitionId, generation: manifest.generation, family: name, row,
        ...(name === 'semantic_records' ? { ref: { partitionId: partition.partitionId, localId: row.id } } : {}) };
    }
  }
}
/** Owns at most eight sequential readers. No expanded graph, source index or unlimited history is cached. */
export function createArtifactBrowser({ clock = () => Date.now() } = {}) {
  const readers = new Map();
  const close = async key => { const entry = readers.get(key); readers.delete(key); await entry?.iterator?.return(); };
  const prune = async () => { for (const [key, entry] of readers) if (clock() - entry.touched > 60000) await close(key); };
  const resolve = repoRoot => {
    const dir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
    const manifest = loadPiecesManifest(dir, { maxBytes: MAX_READ_BYTES, strict: true, repoRoot });
    return { dir, manifest, generation: hash(manifest) };
  };
  return {
    async close() { for (const key of readers.keys()) await close(key); },
    async catalog(repoRoot) {
      await prune(); const { manifest, generation } = resolve(repoRoot);
      const byName = new Map();
      for (const piece of manifest.pieces) { if (!byName.has(piece.name)) byName.set(piece.name, []); byName.get(piece.name).push(piece); }
      const inventory = artifactInventory();
      for (const name of byName.keys()) if (!inventory.some(item => item.name === name)) inventory.push({ name, family: classify(name), logicalSchema: false, mode: 'metadata' });
      return { kind: 'artifact-catalog', generation, artifactSurfaceVersion: manifest.artifactSurfaceVersion,
        artifacts: inventory.map(item => ({ ...item, available: byName.has(item.name), pieces: (byName.get(item.name) || []).length,
          bytes: byName.has(item.name) && byName.get(item.name).every(piece => Number.isFinite(piece.bytes))
            ? byName.get(item.name).reduce((sum, piece) => sum + piece.bytes, 0) : null })),
        warnings: ['Physical binary stores and offsets expose manifest provenance, not fabricated graph geometry.', 'Reads are capped at 2 MiB per artifact input; use semantic/search query services for larger stores.'] };
    },
    async read(repoRoot, { name, generation, cursor = null }, signal) {
      await prune(); const current = resolve(repoRoot);
      if (generation !== current.generation) throw Object.assign(new Error('Index generation changed. Refresh the catalog.'), { status: 409 });
      const descriptor = artifactInventory().find(item => item.name === name);
      const pieces = current.manifest.pieces.filter(piece => piece.name === name);
      if (!pieces.length) throw Object.assign(new Error('Artifact absent from this generation.'), { status: 404 });
      if (descriptor?.mode === 'metadata' || !descriptor) return { kind: 'artifact-page', generation, name, mode: 'metadata', rows: pieces, cursor: null, warnings: ['Inspect logical/query output for semantic values.'] };
      if (descriptor.mode === 'object') {
        const value = await loadJsonObjectArtifact(current.dir, name, { maxBytes: MAX_READ_BYTES, manifest: current.manifest, strict: true });
        if (hash(resolve(repoRoot).manifest) !== generation) throw Object.assign(new Error('Generation changed during read.'), { status: 409 });
        if (Buffer.byteLength(JSON.stringify(value)) > MAX_READ_BYTES) throw new Error('Artifact exceeds bounded view admission.');
        return { kind: 'artifact-page', generation, name, mode: 'object', value, cursor: null, provenance: pieces };
      }
      let entry;
      if (cursor) {
        entry = readers.get(cursor);
        if (!entry) throw Object.assign(new Error('Artifact cursor expired. Reopen the artifact.'), { status: 410 });
        if (entry.repoRoot !== repoRoot || entry.name !== name || entry.generation !== generation) throw Object.assign(new Error('Cursor scope mismatch.'), { status: 403 });
        readers.delete(cursor); // A page token is single-use, including concurrent duplicate clicks.
      } else entry = { repoRoot, name, generation, ordinal: 0,
        iterator: (SEMANTIC_MEMBER_NAMES.includes(name) ? semanticRows(current.dir, repoRoot, name)
          : loadJsonArrayArtifactRows(current.dir, name, { maxBytes: MAX_READ_BYTES, manifest: current.manifest, strict: true }))[Symbol.asyncIterator]() };
      const rows = []; let bytes = 0, done = false;
      try {
        while (rows.length < 128) {
          if (signal?.aborted) throw Object.assign(new Error('Cancelled.'), { name: 'AbortError' });
          const next = entry.pending || await entry.iterator.next(); entry.pending = null;
          if (next.done) { done = true; break; }
          const size = Buffer.byteLength(JSON.stringify(next.value));
          if (size > 65536) throw new Error('One artifact row exceeds the 64 KiB page budget. Use a field-projected query.');
          if (bytes + size > 65536) { entry.pending = next; break; }
          rows.push(next.value); bytes += size;
        }
        if (resolve(repoRoot).generation !== generation) throw Object.assign(new Error('Generation changed during read.'), { status: 409 });
        const ordinal = entry.ordinal; entry.ordinal += rows.length;
        let nextCursor = null;
        if (!done) { while (readers.size >= 8) await close(readers.keys().next().value);
          nextCursor = randomUUID(); entry.touched = clock(); readers.set(nextCursor, entry);
        } else await entry.iterator.return();
        return { kind: 'artifact-page', generation, name, mode: 'rows', rows, ordinal, cursor: nextCursor,
          coverage: { returned: rows.length, total: null, state: done ? 'complete' : 'partial' }, provenance: pieces.slice(0, 20) };
      } catch (error) { await entry.iterator.return(); throw error; }
    }
  };
}
