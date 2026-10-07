import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const readBoundedJson = (file, maxBytes) => {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'r');
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const buffer = Buffer.alloc(stat.size + 1);
    const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytes > stat.size) return null;
    return JSON.parse(buffer.subarray(0, bytes).toString('utf8'));
  } catch { return null; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
};
const pathKey = (value) => {
  if (typeof value !== 'string' || !value) return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/** A zero-state receipt must match its current mode, database target and ready state. */
export const resolveBenchSqliteModeStatus = ({ mode, indexDir, dbPath }) => {
  const zeroStateManifestPath = path.join(indexDir, 'pieces', 'sqlite-zero-state.json');
  const receipt = readBoundedJson(zeroStateManifestPath, 64 * 1024);
  const state = readBoundedJson(path.join(indexDir, 'index_state.json'), 1024 * 1024);
  const { checksum, ...payload } = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : {};
  const generatedAt = Date.parse(receipt?.generatedAt);
  const stateGeneratedAt = Date.parse(state?.generatedAt);
  const zeroState = receipt?.schemaVersion === '1.0.0' && receipt.mode === mode
    && receipt.chunkCount === 0 && receipt.denseCount === 0
    && pathKey(receipt.outputPath) === pathKey(dbPath) && pathKey(dbPath) !== null
    && typeof checksum === 'string' && checksum === createHash('sha1').update(JSON.stringify(payload)).digest('hex')
    && state?.mode === mode && state.sqlite?.status === 'ready'
    && state.sqlite.ready !== false && state.sqlite.pending !== true
    && state.sqlite?.stats?.reason === `empty-${mode}-artifacts`
    && pathKey(state.sqlite?.stats?.zeroStateManifestPath) === pathKey(zeroStateManifestPath)
    && Number.isFinite(generatedAt) && Number.isFinite(stateGeneratedAt) && stateGeneratedAt <= generatedAt;
  return { dbExists: fs.existsSync(dbPath), zeroState, zeroStateManifestPath,
    zeroStateObservation: zeroState ? 'confirmed-empty' : receipt ? 'unverified-receipt' : 'absent-or-invalid' };
};
