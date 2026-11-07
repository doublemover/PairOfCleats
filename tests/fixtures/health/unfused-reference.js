import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_JSON_BYTES, loadPiecesManifest, loadMinhashSignatures, loadChunkMeta,
  loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { createFixtureHealthReadContext } from '../../helpers/fixture-health-snapshot.js';
import { withVerifiedArtifactReadScope } from '../../../src/shared/artifact-io/verified-read-scope.js';

// Independent consumption control for the original9a238036 fixture-health
// algorithm: compatibility, full authority, risk, SQL and UID passes. Current
// contained readers and current authority framing are retained deliberately;
// this is an unfolded current-contract control, not an executable old checkout.
export const readUnfusedHealthReference = async ({ modeDirs, requiredModes, prior = null, metrics = {} }) => {
  const modes = {}, authorityByMode = {}, keyByMode = {};
  for (const mode of requiredModes) {
    const dir = modeDirs[mode], manifest = loadPiecesManifest(dir, { strict: true });
    const options = { manifest, strict: true, maxBytes: MAX_JSON_BYTES };
    await loadMinhashSignatures(dir, options);
    keyByMode[mode] = manifest.compatibilityKey;
    const selected = new Set([path.join(dir, 'pieces/manifest.json')]);
    const families = ['chunk_meta', 'file_meta', 'minhash_signatures', 'minhash_signatures_meta', ...(mode === 'code' ? ['risk_flows'] : [])];
    for (const piece of manifest.pieces) if (families.some(name => piece.name === name || piece.name.startsWith(name + '_') || piece.name.startsWith(name + '.'))) selected.add(path.resolve(dir, piece.path));
    const context = createFixtureHealthReadContext(dir);
    const hash = createHash('sha256').update(fs.realpathSync(dir));
    await withVerifiedArtifactReadScope(context, async () => {
      for (const file of [...selected].sort()) {
        const certificate = await context.ensure(file);
        hash.update(JSON.stringify([path.relative(dir, file), certificate.bytes, certificate.hash]));
      }
      context.finish();
    });
    const authority = hash.digest('hex'); authorityByMode[mode] = authority;
    if (prior?.authorityByMode[mode] === authority) { modes[mode] = { ...prior.modes[mode], authority }; continue; }
    let risk = [], flows = [], missingSqlDialects = false, hasRiskTags = false;
    if (mode === 'code') {
      risk = await loadChunkMeta(dir, options); metrics.chunkDecodePasses = (metrics.chunkDecodePasses || 0) + 1;
      hasRiskTags = risk.some(row => { const value = row.metaV2?.risk || row.docmeta?.risk; return value?.tags?.length > 0 || value?.flows?.length > 0; });
      risk = null;
      flows = await loadJsonArrayArtifact(dir, 'risk_flows', options);
      let sqlChunks = await loadChunkMeta(dir, options); metrics.chunkDecodePasses++;
      let fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', options);
      const sqlFile = file => typeof file === 'string' && /\.(sql|psql|pgsql|mysql|sqlite)$/i.test(file);
      const fileById = new Map(fileMeta.map(row => [row.id, row.file]));
      const sqlFiles = new Set(fileMeta.map(row => row.file).filter(sqlFile)), observed = new Set();
      const dialectByExt = new Map([['.psql', 'postgres'], ['.pgsql', 'postgres'], ['.mysql', 'mysql'], ['.sqlite', 'sqlite']]);
      for (const row of sqlChunks) {
        const file = row.file || fileById.get(row.fileId);
        if (String(row.lang || '').toLowerCase() !== 'sql' && !sqlFile(file)) continue;
        if (file) observed.add(file);
        const dialect = typeof row.docmeta?.dialect === 'string' ? row.docmeta.dialect.trim().toLowerCase() : '';
        const expected = dialectByExt.get(path.extname(String(file || '')).toLowerCase());
        if (!dialect || expected && expected !== dialect) missingSqlDialects = true;
      }
      if (sqlChunks.length) for (const file of sqlFiles) if (!observed.has(file)) missingSqlDialects = true;
      sqlChunks = null; fileMeta = null;
    }
    const uidChunks = await loadChunkMeta(dir, options); metrics.chunkDecodePasses = (metrics.chunkDecodePasses || 0) + 1;
    modes[mode] = { compatibilityKey: manifest.compatibilityKey, authority,
      hasChunkUids: uidChunks.length > 0 && uidChunks.every(row => row.chunkUid || row.metaV2?.chunkUid),
      hasRiskTags,
      hasRiskWatchByStep: flows.length > 0 && flows.every(row => Array.isArray(row.path?.watchByStep)
        && row.path.watchByStep.length === (Array.isArray(row.path.callSiteIdsByStep) ? row.path.callSiteIdsByStep.length : 0)),
      missingSqlDialects };
  }
  const keys = Object.values(keyByMode), baseline = keys.find(Boolean) || null;
  return { modes, authorityByMode, compatibility: { keyByMode, baseline, compatible: Boolean(baseline && keys.every(key => !key || key === baseline)) }, metrics };
};
