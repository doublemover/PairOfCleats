import { openPublishedSemanticStore } from '../../../semantic/published-store.js';
import { ingestSemanticPartition } from './ingest.js';

/** Called inside the existing artifact build transaction, before its commit. */
export const ingestPublishedSemanticFamily = async ({ db, indexDir, repoRoot, signal }) => {
  const { store, manifest } = await openPublishedSemanticStore({ indexDir, repoRoot });
  for (const descriptor of manifest.partitions) await ingestSemanticPartition({ db, store, descriptor, signal });
  db.prepare('INSERT OR REPLACE INTO index_format_meta(key,value) VALUES (?,?)')
    .run('semanticGeneration', JSON.stringify(manifest.generation));
  return manifest;
};
