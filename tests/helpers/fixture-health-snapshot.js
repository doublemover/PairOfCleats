import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertNoSymlinkPath, openContainedFile, verifyContainedFileHandle } from '../../src/shared/contained-file.js';
import { readExactAt } from '../../src/shared/io/read-exact.js';
import { artifactReadStamp, beginVerifiedArtifactRead, sameArtifactReadStamp, withVerifiedArtifactReadScope } from '../../src/shared/artifact-io/verified-read-scope.js';
import { loadPiecesManifest, MAX_JSON_BYTES, loadChunkMetaRows, loadMinhashSignatures, loadJsonArrayArtifactRows, readJsonFile } from '../../src/shared/artifact-io.js';
import { loadFileMetaRows } from '../../src/shared/artifact-io/loaders/core.js';
import { ARTIFACT_SURFACE_VERSION, isSupportedVersion } from '../../src/contracts/versioning.js';
import { SEMANTIC_OPERATION_INDEX_SCHEMA } from '../../src/contracts/schemas/semantic-operation-index.js';

const MAX_WITNESSES = 65536;
const METADATA_BYTES = 1024 * 1024;
const METADATA_TOTAL_BYTES = 8 * 1024 * 1024;
const changed = () => Object.assign(new Error('Fixture artifact changed during its health evaluation.'), { code: 'ERR_FILE_CHANGED' });
const isSqlFile = file => typeof file === 'string' && /\.(sql|psql|pgsql|mysql|sqlite)$/i.test(file);
const dialectByExtension = new Map([['.psql', 'postgres'], ['.pgsql', 'postgres'], ['.mysql', 'mysql'], ['.sqlite', 'sqlite']]);
const HEALTH_FAMILIES = ['chunk_meta', 'file_meta', 'minhash_signatures', 'minhash_signatures_meta'];

/** No persistent bytes/graphs: only integrity certificates and bounded decoded metadata. */
export const createFixtureHealthReadContext = (root, metrics = {}) => {
  const certificates = new Map();
  const metadata = new Map();
  let metadataBytes = 0;
  const resolvedRoot = path.resolve(root);
  const validate = (target, certificate) => {
    assertNoSymlinkPath(resolvedRoot, target);
    const current = fs.statSync(target);
    if (!sameArtifactReadStamp(certificate.stamp, artifactReadStamp(current))) throw changed();
  };
  return {
    root: resolvedRoot,
    certificates,
    record(target, certificate) {
      const previous = certificates.get(target);
      if (previous && (previous.hash !== certificate.hash || !sameArtifactReadStamp(previous.stamp, certificate.stamp))) throw changed();
      if (!previous && certificates.size >= MAX_WITNESSES) throw new Error('Fixture health witness limit exceeded.');
      certificates.set(target, Object.freeze(certificate));
      metrics.physicalReads = (metrics.physicalReads || 0) + 1;
      metrics.verifiedBytes = (metrics.verifiedBytes || 0) + certificate.bytes;
      const byPath = metrics.readsByPath ||= {};
      byPath[target] = (byPath[target] || 0) + 1;
    },
    readJson(target, options, load) {
      const key = JSON.stringify([target, options.maxBytes ?? MAX_JSON_BYTES, options.recoveryFallback === true]);
      const cached = metadata.get(key);
      if (cached) { validate(target, cached.certificate); return cached.value; }
      const value = load();
      const certificate = certificates.get(target);
      if (certificate && certificate.bytes <= METADATA_BYTES && metadataBytes + certificate.bytes <= METADATA_TOTAL_BYTES) {
        metadata.set(key, { value, certificate }); metadataBytes += certificate.bytes;
      }
      return value;
    },
    async ensure(target) {
      const resolved = path.resolve(target);
      const existing = certificates.get(resolved);
      if (existing) { validate(resolved, existing); return existing; }
      const handle = await openContainedFile(resolvedRoot, resolved);
      let primary = null;
      try {
        const stat = await handle.stat();
        if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_JSON_BYTES) throw new Error('Health artifact exceeds reader limit');
        const witness = beginVerifiedArtifactRead(resolvedRoot, resolved, handle.fd);
        const buffer = Buffer.alloc(Math.min(65536, Math.max(1, stat.size)));
        for (let position = 0; position < stat.size;) {
          const length = Math.min(buffer.length, stat.size - position);
          const { bytesRead } = await readExactAt(handle, buffer, 0, length, position);
          if (bytesRead !== length) throw changed();
          witness.update(buffer.subarray(0, bytesRead), position); position += bytesRead;
        }
        witness.finish(() => verifyContainedFileHandle(handle, resolvedRoot, resolved));
      } catch (error) { primary = error; throw error; }
      finally {
        try { await handle.close(); } catch (error) {
          if (primary && typeof primary === 'object') primary.closeError = error;
          else throw error;
        }
      }
      return certificates.get(resolved);
    },
    finish() {
      for (const [target, certificate] of certificates) validate(target, certificate);
      metadata.clear(); metadataBytes = 0;
    }
  };
};

const readModeSnapshot = async (dir, mode, metrics) => {
  const context = createFixtureHealthReadContext(dir, metrics);
  return withVerifiedArtifactReadScope(context, async () => {
    // The scoped reader bypasses global stat-keyed caches and records these exact manifest bytes.
    const manifest = loadPiecesManifest(dir, { strict: true });
    const common = { maxBytes: MAX_JSON_BYTES, manifest, strict: true };
    await loadMinhashSignatures(dir, common);
    const operationPath = path.join(dir, 'semantic_operation_index.json');
    if (fs.existsSync(operationPath)) {
      const operation = readJsonFile(operationPath, { maxBytes: MAX_JSON_BYTES, containedRoot: dir });
      if (operation.schemaVersion !== SEMANTIC_OPERATION_INDEX_SCHEMA.properties.schemaVersion.const) throw new Error('Unsupported semantic operation index.');
    }
    let compatibilityKey = typeof manifest.compatibilityKey === 'string' ? manifest.compatibilityKey.trim() : null;
    if (!compatibilityKey) {
      try {
        const state = readJsonFile(path.join(dir, 'index_state.json'), { maxBytes: MAX_JSON_BYTES, containedRoot: dir });
        if (!isSupportedVersion(state?.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION)) throw new Error('Unsupported fixture index state.');
        compatibilityKey = typeof state?.compatibilityKey === 'string' ? state.compatibilityKey.trim() || null : null;
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const sqlFileById = new Map();
    const sqlFiles = new Set();
    for await (const row of loadFileMetaRows(dir, common)) {
      if (mode === 'code' && isSqlFile(row.file)) { sqlFileById.set(row.id, row.file); sqlFiles.add(row.file); }
    }
    let chunkCount = 0;
    let hasChunkUids = true;
    let hasRiskTags = false;
    let missingSqlDialects = false;
    const sqlFilesWithChunks = new Set();
    for await (const entry of loadChunkMetaRows(dir, { ...common, enforceBinaryDataBudget: true })) {
      chunkCount += 1; metrics.chunkRows = (metrics.chunkRows || 0) + 1;
      if (!entry?.chunkUid && !entry?.metaV2?.chunkUid) hasChunkUids = false;
      if (mode !== 'code') continue;
      const risk = entry?.metaV2?.risk || entry?.docmeta?.risk || null;
      if ((Array.isArray(risk?.tags) && risk.tags.length) || (Array.isArray(risk?.flows) && risk.flows.length)) hasRiskTags = true;
      const file = entry?.file || sqlFileById.get(entry?.fileId) || null;
      if (String(entry?.lang || '').toLowerCase() !== 'sql' && !isSqlFile(file)) continue;
      if (file) sqlFilesWithChunks.add(file);
      const dialect = typeof entry?.docmeta?.dialect === 'string' ? entry.docmeta.dialect.trim().toLowerCase() : '';
      const expected = dialectByExtension.get(path.extname(String(file || '')).toLowerCase()) || null;
      if (!dialect || (expected && expected !== dialect)) missingSqlDialects = true;
    }
    if (chunkCount) for (const file of sqlFiles) if (!sqlFilesWithChunks.has(file)) missingSqlDialects = true;
    let flowCount = 0;
    let hasRiskWatchByStep = true;
    if (mode === 'code' && manifest.pieces.some(piece => piece?.name === 'risk_flows')) {
      for await (const entry of loadJsonArrayArtifactRows(dir, 'risk_flows', common)) {
        flowCount += 1;
        const calls = Array.isArray(entry?.path?.callSiteIdsByStep) ? entry.path.callSiteIdsByStep : [];
        const watch = entry?.path?.watchByStep;
        if (!Array.isArray(watch) || watch.length !== calls.length) hasRiskWatchByStep = false;
      }
    }
    const families = [...HEALTH_FAMILIES, ...(mode === 'code' ? ['risk_flows'] : [])];
    const selected = new Set([path.join(dir, 'pieces', 'manifest.json'), ...context.certificates.keys()]);
    for (const piece of manifest.pieces) {
      if (!families.some(name => piece?.name === name || piece?.name?.startsWith(`${name}_`) || piece?.name?.startsWith(`${name}.`))) continue;
      if (typeof piece.path !== 'string' || !piece.path) throw new Error('Invalid fixture health piece path.');
      selected.add(path.resolve(dir, piece.path));
    }
    const hash = crypto.createHash('sha256').update(fs.realpathSync(dir));
    for (const target of [...selected].sort()) {
      const certificate = await context.ensure(target);
      hash.update(JSON.stringify([path.relative(dir, target), certificate.bytes, certificate.hash]));
    }
    context.finish();
    return { compatibilityKey, authority: hash.digest('hex'), hasChunkUids: chunkCount > 0 && hasChunkUids,
      hasRiskTags, hasRiskWatchByStep: flowCount > 0 && hasRiskWatchByStep, missingSqlDialects: chunkCount > 0 && missingSqlDialects };
  });
};

/** Each call owns independent generation/content evidence, including evaluations on either side of a rebuild lock. */
export const readFixtureHealthSnapshot = async ({ modeDirs, requiredModes, metrics = {} }) => {
  const modes = {};
  const authorityByMode = {};
  const keyByMode = {};
  let valid = true;
  for (const mode of requiredModes) {
    try {
      modes[mode] = await readModeSnapshot(modeDirs[mode], mode, metrics);
      authorityByMode[mode] = modes[mode].authority;
      keyByMode[mode] = modes[mode].compatibilityKey;
    } catch (error) {
      valid = false; authorityByMode[mode] = null; keyByMode[mode] = null;
      modes[mode] = { error: error?.code || error?.message || String(error), hasChunkUids: false,
        hasRiskTags: false, hasRiskWatchByStep: false, missingSqlDialects: true };
    }
  }
  const keys = Object.values(keyByMode);
  const baseline = keys.find(Boolean) || null;
  const testing = process.env.PAIROFCLEATS_TESTING === '1' || process.env.PAIROFCLEATS_TESTING === 'true';
  const allowMissing = testing && !['0', 'false'].includes(process.env.PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY);
  return { modes, authorityByMode, compatibility: { keyByMode, baseline,
    compatible: valid && (baseline ? keys.every(key => !key || key === baseline) : allowMissing) }, metrics };
};
