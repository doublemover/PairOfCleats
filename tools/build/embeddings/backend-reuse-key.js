import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { normalizeHnswConfig } from '../../../src/shared/hnsw.js';
import { normalizeLanceDbConfig } from '../../../src/shared/lancedb.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runtimeIdentity = backend => {
  const name = backend === 'hnsw' ? 'hnswlib-node' : '@lancedb/lancedb';
  try {
    let dir = path.dirname(require.resolve(name));
    for (let depth = 0; depth < 8; depth++) {
      const filename = path.join(dir, 'package.json');
      try {
        const stat = fs.statSync(filename);
        if (stat.size > 65536) return null;
        const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (metadata.name === name && typeof metadata.version === 'string') return {
          package: name, version: metadata.version, node: process.versions.node,
          modules: process.versions.modules, platform: process.platform, arch: process.arch };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const parent = path.dirname(dir); if (parent === dir) break; dir = parent;
    }
  } catch { /* Unknown runtime cannot authorize reuse. */ }
  return null;
};

/** Physical construction proof. Embedding generation separately binds every
 * source ordinal/channel byte and the complete model/format identity. */
export const buildNativeBackendReuseKey = ({ backend, config, normalize = true, dims, modelId, quantization, scale }) => {
  const normalized = backend === 'hnsw' ? normalizeHnswConfig(config) : normalizeLanceDbConfig(config);
  const runtime = runtimeIdentity(backend);
  if (!runtime) return null;
  return createHash('sha256').update(stableStringify({ version: 1, backend, config: normalized,
    runtime, normalize: normalize !== false, dims, modelId: modelId || null, quantization: quantization || null, scale })).digest('hex');
};
