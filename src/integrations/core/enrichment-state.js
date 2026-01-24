import fs from 'node:fs/promises';
import path from 'node:path';

const resolveEnrichmentStatePath = (repoCacheRoot) => path.join(repoCacheRoot, 'enrichment_state.json');

export const updateEnrichmentState = async (repoCacheRoot, patch) => {
  if (!repoCacheRoot) return null;
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(resolveEnrichmentStatePath(repoCacheRoot), 'utf8'));
  } catch {}
  const next = {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  try {
    await fs.mkdir(repoCacheRoot, { recursive: true });
    await fs.writeFile(resolveEnrichmentStatePath(repoCacheRoot), JSON.stringify(next, null, 2));
  } catch {}
  return next;
};
