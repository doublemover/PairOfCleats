import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES, readJsonFile, resolveArtifactPresence } from '../../shared/artifact-io.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION, isSupportedVersion } from '../../contracts/versioning.js';
import { addIssue } from './issues.js';
import { validateSchema } from './schema.js';

export const createArtifactPresenceHelpers = ({
  dir,
  manifest,
  strict,
  mode,
  report,
  modeReport
}) => {
  const minJsonBytes = 64 * 1024;
  const resolveMaxBytes = (name) => {
    if (name === 'index_state' || name === 'filelists') {
      return Math.max(MAX_JSON_BYTES, minJsonBytes);
    }
    return MAX_JSON_BYTES;
  };
  const presenceCache = new Map();
  const resolvePresence = (name) => {
    if (!strict || !manifest) return null;
    if (presenceCache.has(name)) return presenceCache.get(name);
    const presence = resolveArtifactPresence(dir, name, { manifest, strict: true });
    presenceCache.set(name, presence);
    return presence;
  };

  const checkPresence = (name, { required = false } = {}) => {
    const presence = resolvePresence(name);
    if (!presence) return null;
    if (presence.error) {
      addIssue(report, mode, `manifest entry invalid for ${name}: ${presence.error.message}`);
      modeReport.ok = false;
      return presence;
    }
    if (presence.format === 'missing') {
      const label = `missing ${name}`;
      if (required) {
        modeReport.ok = false;
        modeReport.missing.push(name);
        report.issues.push(`[${mode}] ${label}`);
      } else {
        modeReport.warnings.push(name);
        report.warnings.push(`[${mode}] optional ${name} missing`);
      }
      return presence;
    }
    if (presence.missingMeta) {
      addIssue(report, mode, `${name} meta missing`, 'Rebuild index artifacts for this mode.');
      modeReport.ok = false;
    }
    if (presence.missingPaths.length) {
      presence.missingPaths.forEach((missing) => {
        addIssue(report, mode, `${name} shard missing: ${path.relative(dir, missing)}`);
      });
      modeReport.ok = false;
    }
    if (presence.meta && typeof presence.meta === 'object') {
      validateSchema(
        report,
        mode,
        `${name}_meta`,
        presence.meta,
        'Rebuild index artifacts for this mode.',
        { strictSchema: strict }
      );
      if (presence.meta.schemaVersion
        && !isSupportedVersion(presence.meta.schemaVersion, SHARDED_JSONL_META_SCHEMA_VERSION)) {
        addIssue(
          report,
          mode,
          `${name}_meta schemaVersion unsupported: ${presence.meta.schemaVersion}`,
          'Rebuild index artifacts for this mode.'
        );
      }
    }
    return presence;
  };

  const readJsonArtifact = (name, { required = false, allowOversize = false } = {}) => {
    try {
      if (strict && manifest) {
        const presence = resolvePresence(name);
        if (!presence || presence.format === 'missing') return null;
        if (presence.format !== 'json') {
          throw new Error(`Unexpected ${name} format: ${presence.format}`);
        }
        if (!presence.paths.length) {
          throw new Error(`Missing ${name} JSON path in manifest`);
        }
        if (presence.paths.length > 1) {
          throw new Error(`Ambiguous JSON sources for ${name}`);
        }
        return readJsonFile(presence.paths[0], { maxBytes: resolveMaxBytes(name) });
      }
      const jsonPath = path.join(dir, `${name}.json`);
      if (!fs.existsSync(jsonPath) && !fs.existsSync(`${jsonPath}.gz`) && !fs.existsSync(`${jsonPath}.zst`)) {
        return null;
      }
      return readJsonFile(jsonPath, { maxBytes: resolveMaxBytes(name) });
    } catch (err) {
      if (allowOversize && err?.code === 'ERR_JSON_TOO_LARGE') {
        const warning = `${name} load skipped (${err?.message || err})`;
        modeReport.warnings.push(warning);
        report.warnings.push(`[${mode}] ${warning}`);
        return null;
      }
      addIssue(report, mode, `${name} load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
      if (required) modeReport.ok = false;
      return null;
    }
  };

  const shouldLoadOptional = (name) => {
    if (!strict) return true;
    const presence = resolvePresence(name);
    return presence && presence.format !== 'missing' && !presence.error;
  };

  const hasLegacyArtifact = (name) => {
    const existsAny = (basePath) => (
      fs.existsSync(basePath)
      || fs.existsSync(`${basePath}.gz`)
      || fs.existsSync(`${basePath}.zst`)
    );
    const hasDenseVectorBinaryOrSharded = (baseName) => {
      const binMeta = path.join(dir, `${baseName}.bin.meta.json`);
      const binPayload = path.join(dir, `${baseName}.bin`);
      if (existsAny(binMeta) && existsAny(binPayload)) return true;
      const shardedMeta = path.join(dir, `${baseName}.meta.json`);
      const shardedParts = path.join(dir, `${baseName}.parts`);
      return existsAny(shardedMeta) && fs.existsSync(shardedParts);
    };
    if (name === 'chunk_meta') {
      const json = path.join(dir, 'chunk_meta.json');
      const jsonl = path.join(dir, 'chunk_meta.jsonl');
      const columnar = path.join(dir, 'chunk_meta.columnar.json');
      const meta = path.join(dir, 'chunk_meta.meta.json');
      const partsDir = path.join(dir, 'chunk_meta.parts');
      return existsAny(json)
        || existsAny(jsonl)
        || existsAny(columnar)
        || existsAny(meta)
        || fs.existsSync(partsDir);
    }
    const hasJsonlArtifact = (baseName) => {
      const json = path.join(dir, `${baseName}.json`);
      const jsonl = path.join(dir, `${baseName}.jsonl`);
      const columnar = path.join(dir, `${baseName}.columnar.json`);
      const meta = path.join(dir, `${baseName}.meta.json`);
      const partsDir = path.join(dir, `${baseName}.parts`);
      if (existsAny(json)) return true;
      if (existsAny(columnar)) return true;
      return existsAny(jsonl) || existsAny(meta) || fs.existsSync(partsDir);
    };
    if (name === 'file_relations') return hasJsonlArtifact('file_relations');
    if (name === 'call_sites') return hasJsonlArtifact('call_sites');
    if (name === 'risk_summaries') return hasJsonlArtifact('risk_summaries');
    if (name === 'risk_flows') return hasJsonlArtifact('risk_flows');
    if (name === 'symbols') return hasJsonlArtifact('symbols');
    if (name === 'symbol_occurrences') return hasJsonlArtifact('symbol_occurrences');
    if (name === 'symbol_edges') return hasJsonlArtifact('symbol_edges');
    if (name === 'graph_relations') return hasJsonlArtifact('graph_relations');
    if (name === 'repo_map') return hasJsonlArtifact('repo_map');
    if (name === 'token_postings') {
      const json = path.join(dir, 'token_postings.json');
      const gz = `${json}.gz`;
      const zst = `${json}.zst`;
      const meta = path.join(dir, 'token_postings.meta.json');
      const shardsDir = path.join(dir, 'token_postings.shards');
      return fs.existsSync(json)
        || fs.existsSync(gz)
        || fs.existsSync(zst)
        || fs.existsSync(meta)
        || fs.existsSync(shardsDir);
    }
    if (name === 'dense_vectors') {
      return hasDenseVectorBinaryOrSharded('dense_vectors_uint8');
    }
    if (name === 'dense_vectors_doc') {
      return hasDenseVectorBinaryOrSharded('dense_vectors_doc_uint8');
    }
    if (name === 'dense_vectors_code') {
      return hasDenseVectorBinaryOrSharded('dense_vectors_code_uint8');
    }
    if (name === 'index_state') {
      return fs.existsSync(path.join(dir, 'index_state.json'));
    }
    if (name === 'determinism_report') {
      return fs.existsSync(path.join(dir, 'determinism_report.json'));
    }
    if (name === 'filelists') {
      return fs.existsSync(path.join(dir, '.filelists.json'));
    }
    const filePath = path.join(dir, `${name}.json`);
    return existsAny(filePath);
  };

  return {
    resolvePresence,
    checkPresence,
    readJsonArtifact,
    shouldLoadOptional,
    hasLegacyArtifact
  };
};
