import fs from 'node:fs';
import { readJsonlRows } from '../../../shared/merge.js';
import { loadVfsManifestBloomFilter } from './manifest.js';
import { loadVfsManifestIndex } from './manifest-index.js';
import { readVfsManifestRowAtOffset } from './offset-reader.js';

const scanVfsManifestRowByPath = async ({ manifestPath, virtualPath }) => {
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;
  for await (const row of readJsonlRows(manifestPath)) {
    if (row?.virtualPath === virtualPath) return row;
  }
  return null;
};

const emitVfsLookupTelemetry = (telemetry, event) => {
  if (!telemetry || !event) return;
  try {
    if (typeof telemetry === 'function') {
      telemetry(event);
      return;
    }
    if (Array.isArray(telemetry)) {
      telemetry.push(event);
      return;
    }
    if (typeof telemetry.record === 'function') {
      telemetry.record(event);
    }
  } catch {}
};

/**
 * Load a VFS manifest row by virtualPath using bloom + index fast paths.
 * @param {{manifestPath:string,indexPath?:string,index?:Map<string,object>|null,virtualPath:string,bloomPath?:string,bloom?:object|null,allowScan?:boolean,reader?:object|null,telemetry?:(Function|Array|object|null)}} input
 * @returns {Promise<object|null>}
 */
export const loadVfsManifestRowByPath = async ({
  manifestPath,
  indexPath = null,
  index = null,
  virtualPath,
  bloomPath = null,
  bloom = null,
  allowScan = false,
  reader = null,
  telemetry = null
}) => {
  if (!virtualPath) return null;
  const resolvedBloom = bloom || (bloomPath ? await loadVfsManifestBloomFilter({ bloomPath }) : null);
  if (resolvedBloom && !resolvedBloom.has(virtualPath)) {
    emitVfsLookupTelemetry(telemetry, {
      path: 'bloom',
      outcome: 'negative',
      virtualPath
    });
    return null;
  }
  if (resolvedBloom) {
    emitVfsLookupTelemetry(telemetry, {
      path: 'bloom',
      outcome: 'positive',
      virtualPath
    });
  }
  let resolvedIndex = index || null;
  if (!resolvedIndex && indexPath) {
    try {
      resolvedIndex = await loadVfsManifestIndex({ indexPath });
    } catch {
      emitVfsLookupTelemetry(telemetry, {
        path: 'vfsidx',
        outcome: 'load_error',
        virtualPath
      });
      if (!allowScan) return null;
    }
  }
  if (resolvedIndex) {
    const entry = resolvedIndex.get(virtualPath);
    if (!entry) {
      emitVfsLookupTelemetry(telemetry, {
        path: 'vfsidx',
        outcome: 'miss',
        virtualPath
      });
      if (!allowScan) return null;
    } else {
      const row = await readVfsManifestRowAtOffset({
        manifestPath,
        offset: entry.offset,
        bytes: entry.bytes,
        reader
      });
      const rowVirtualPath = String(row?.virtualPath || '');
      if (row && rowVirtualPath && rowVirtualPath !== virtualPath) {
        emitVfsLookupTelemetry(telemetry, {
          path: 'vfsidx',
          outcome: 'mismatch',
          virtualPath,
          rowVirtualPath
        });
        if (!allowScan) return null;
      } else {
        emitVfsLookupTelemetry(telemetry, {
          path: 'vfsidx',
          outcome: row ? 'hit' : 'miss',
          virtualPath
        });
        if (row) return row;
        if (!allowScan) return null;
      }
    }
  }
  if (!allowScan) {
    emitVfsLookupTelemetry(telemetry, {
      path: 'scan',
      outcome: 'disabled',
      virtualPath
    });
    return null;
  }
  const row = await scanVfsManifestRowByPath({ manifestPath, virtualPath });
  emitVfsLookupTelemetry(telemetry, {
    path: 'scan',
    outcome: row ? 'hit' : 'miss',
    virtualPath
  });
  return row;
};
