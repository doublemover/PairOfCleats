import { createRequire } from 'node:module';
import { getCapabilities } from '../../src/shared/capabilities.js';
import { skip } from './skip.js';

const require = createRequire(import.meta.url);

const canLoad = (name) => {
  try {
    require(name);
    return true;
  } catch (error) {
    if (error?.code === 'ERR_REQUIRE_ESM') return true;
    return false;
  }
};

const resolveCapability = (capability) => {
  switch (capability) {
    case 'sqlite':
      return canLoad('better-sqlite3');
    case 'lmdb':
      return canLoad('lmdb');
    case 'hnsw':
      return canLoad('hnswlib-node');
    case 'lancedb':
      return canLoad('@lancedb/lancedb');
    case 'tantivy':
      return canLoad('tantivy');
    default: {
      const caps = getCapabilities();
      return Boolean(caps?.[capability]);
    }
  }
};

export const requireOrSkip = ({ capability, reason = '', requiredInCi = false } = {}) => {
  if (!capability) throw new Error('requireOrSkip requires a capability name');
  const available = resolveCapability(capability);
  if (available) return true;
  if (requiredInCi && process.env.CI) {
    console.error(`Missing required capability: ${capability}`);
    process.exit(1);
  }
  skip(reason || `Skipping test; capability missing: ${capability}`);
  return false;
};
