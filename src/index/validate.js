import fs from 'node:fs';
import path from 'node:path';
import {
  getBuildsRoot,
  getIndexDir,
  getRepoRoot,
  loadUserConfig,
  resolveLmdbPaths,
  resolveSqlitePaths
} from '../../tools/dict-utils.js';
import { normalizePostingsConfig } from '../shared/postings-config.js';
import {
  loadChunkMeta,
  loadGraphRelations,
  loadJsonArrayArtifact,
  loadPiecesManifest,
  loadTokenPostings,
  readJsonFile,
  resolveArtifactPresence
} from '../shared/artifact-io.js';
import { checksumFile, sha1File } from '../shared/hash.js';
import { ARTIFACT_SCHEMA_DEFS, validateArtifact } from '../shared/artifact-schemas.js';
import { normalizeLanceDbConfig, resolveLanceDbPaths } from '../shared/lancedb.js';
import { Unpackr } from 'msgpackr';
import {
  ARTIFACT_SURFACE_VERSION,
  SHARDED_JSONL_META_SCHEMA_VERSION,
  isSupportedVersion
} from '../contracts/versioning.js';
import {
  LMDB_ARTIFACT_KEYS,
  LMDB_META_KEYS,
  LMDB_REQUIRED_ARTIFACT_KEYS,
  LMDB_SCHEMA_VERSION
} from '../storage/lmdb/schema.js';

const resolveIndexDir = (root, mode, userConfig, indexRoot = null, strict = false) => {
  const cached = getIndexDir(root, mode, userConfig, { indexRoot });
  if (strict) return cached;
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  const cachedMetaJsonl = path.join(cached, 'chunk_meta.jsonl');
  const cachedMetaParts = path.join(cached, 'chunk_meta.meta.json');
  if (fs.existsSync(cachedMeta) || fs.existsSync(cachedMetaJsonl) || fs.existsSync(cachedMetaParts)) {
    return cached;
  }
  const local = path.join(root, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  const localMetaJsonl = path.join(local, 'chunk_meta.jsonl');
  const localMetaParts = path.join(local, 'chunk_meta.meta.json');
  if (fs.existsSync(localMeta) || fs.existsSync(localMetaJsonl) || fs.existsSync(localMetaParts)) {
    return local;
  }
  return cached;
};

const normalizeManifestPath = (value) => String(value || '').split('\\').join('/');

const isManifestPathSafe = (value) => {
  if (typeof value !== 'string' || !value) return false;
  if (path.isAbsolute(value)) return false;
  if (value.startsWith('/')) return false;
  const normalized = normalizeManifestPath(value);
  if (normalized.includes('..')) return false;
  return true;
};

const extractArray = (raw, key) => {
  if (Array.isArray(raw?.[key])) return raw[key];
  if (Array.isArray(raw?.arrays?.[key])) return raw.arrays[key];
  return [];
};

const normalizeDenseVectors = (raw) => ({
  model: raw?.model ?? raw?.fields?.model ?? null,
  dims: Number.isFinite(Number(raw?.dims ?? raw?.fields?.dims))
    ? Number(raw?.dims ?? raw?.fields?.dims)
    : null,
  scale: Number.isFinite(Number(raw?.scale ?? raw?.fields?.scale))
    ? Number(raw?.scale ?? raw?.fields?.scale)
    : null,
  vectors: extractArray(raw, 'vectors')
});

const normalizeMinhash = (raw) => ({
  signatures: extractArray(raw, 'signatures')
});

const normalizeTokenPostings = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  return {
    vocab: Array.isArray(raw.vocab) ? raw.vocab : extractArray(raw, 'vocab'),
    postings: Array.isArray(raw.postings) ? raw.postings : extractArray(raw, 'postings'),
    docLengths: Array.isArray(raw.docLengths) ? raw.docLengths : extractArray(raw, 'docLengths'),
    avgDocLen: Number.isFinite(Number(raw.avgDocLen ?? raw.fields?.avgDocLen))
      ? Number(raw.avgDocLen ?? raw.fields?.avgDocLen)
      : null,
    totalDocs: Number.isFinite(Number(raw.totalDocs ?? raw.fields?.totalDocs))
      ? Number(raw.totalDocs ?? raw.fields?.totalDocs)
      : null
  };
};

const normalizeFieldPostings = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  return raw.fields ? raw : null;
};

const normalizePhrasePostings = (raw) => ({
  vocab: extractArray(raw, 'vocab'),
  postings: extractArray(raw, 'postings')
});

const normalizeFilterIndex = (raw) => raw && typeof raw === 'object' ? raw : null;

const unpackr = new Unpackr();
const decode = (value) => (value == null ? null : unpackr.unpack(value));

const hasLmdbStore = (storePath) => {
  if (!storePath || !fs.existsSync(storePath)) return false;
  return fs.existsSync(path.join(storePath, 'data.mdb'));
};

const addIssue = (report, mode, message, hint = null, bucket = 'issues') => {
  const tag = mode ? `[${mode}] ` : '';
  report[bucket].push(`${tag}${message}`);
  if (hint) report.hints.push(hint);
};

const validateManifestEntries = (report, mode, dir, manifest, { strictSchema = true } = {}) => {
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  const seenPaths = new Set();
  const root = path.resolve(dir);
  for (const entry of pieces) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!name) {
      addIssue(report, mode, 'manifest entry missing name');
    } else if (strictSchema && !ARTIFACT_SCHEMA_DEFS[name]) {
      addIssue(report, mode, `manifest entry uses unknown artifact name: ${name}`);
    }

    const relPath = typeof entry?.path === 'string' ? entry.path : '';
    if (!relPath) {
      addIssue(report, mode, `manifest entry missing path (${name || 'unknown'})`);
      continue;
    }
    if (relPath.includes('\\')) {
      addIssue(report, mode, `manifest path must use '/' separators: ${relPath}`);
    }
    if (!isManifestPathSafe(relPath)) {
      addIssue(report, mode, `manifest path is not safe: ${relPath}`);
      continue;
    }
    const normalized = normalizeManifestPath(relPath);
    if (seenPaths.has(normalized)) {
      addIssue(report, mode, `manifest path duplicated: ${relPath}`);
    } else {
      seenPaths.add(normalized);
    }
    const resolved = path.resolve(dir, normalized.split('/').join(path.sep));
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      addIssue(report, mode, `manifest path escapes index root: ${relPath}`);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      addIssue(report, mode, `manifest path missing: ${relPath}`);
    }
  }
};

const validateSchema = (report, mode, name, payload, hint, { strictSchema = false } = {}) => {
  if (strictSchema && !ARTIFACT_SCHEMA_DEFS[name]) {
    addIssue(report, mode, `unknown artifact schema: ${name}`, hint);
    return false;
  }
  const result = validateArtifact(name, payload);
  if (!result.ok) {
    const detail = result.errors.length ? ` (${result.errors.join('; ')})` : '';
    addIssue(report, mode, `${name} schema invalid${detail}`, hint);
  }
  return result.ok;
};

const validatePostingsDocIds = (report, mode, label, postings, chunkCount) => {
  const maxErrors = 20;
  let errors = 0;
  for (const posting of postings || []) {
    if (!Array.isArray(posting)) continue;
    for (const entry of posting) {
      const docId = Array.isArray(entry) ? entry[0] : null;
      if (!Number.isFinite(docId) || docId < 0 || docId >= chunkCount) {
        if (errors < maxErrors) {
          addIssue(report, mode, `${label} docId out of range (${docId})`, 'Rebuild index artifacts for this mode.');
        }
        errors += 1;
        if (errors >= maxErrors) return;
      }
    }
  }
};

const validateIdPostings = (report, mode, label, postings, chunkCount) => {
  const maxErrors = 20;
  let errors = 0;
  for (const posting of postings || []) {
    if (!Array.isArray(posting)) continue;
    for (const docId of posting) {
      if (!Number.isFinite(docId) || docId < 0 || docId >= chunkCount) {
        if (errors < maxErrors) {
          addIssue(report, mode, `${label} docId out of range (${docId})`, 'Rebuild index artifacts for this mode.');
        }
        errors += 1;
        if (errors >= maxErrors) return;
      }
    }
  }
};

const validateChunkIds = (report, mode, chunkMeta) => {
  const seen = new Set();
  for (let i = 0; i < chunkMeta.length; i += 1) {
    const entry = chunkMeta[i];
    const id = Number.isFinite(entry?.id) ? entry.id : null;
    if (id === null) {
      addIssue(report, mode, `chunk_meta missing id at index ${i}`, 'Rebuild index artifacts for this mode.');
      return;
    }
    if (seen.has(id)) {
      addIssue(report, mode, `chunk_meta duplicate id ${id}`, 'Rebuild index artifacts for this mode.');
      return;
    }
    seen.add(id);
    if (id !== i) {
      addIssue(report, mode, `chunk_meta id mismatch at index ${i} (id=${id})`, 'Rebuild index artifacts for this mode.');
      return;
    }
  }
};

const validateMetaV2 = (report, mode, chunkMeta) => {
  const maxErrors = 20;
  let errors = 0;
  for (let i = 0; i < chunkMeta.length; i += 1) {
    const entry = chunkMeta[i];
    const meta = entry?.metaV2;
    if (!meta) continue;
    if (typeof meta.chunkId !== 'string' || !meta.chunkId) {
      addIssue(report, mode, `metaV2 missing chunkId at index ${i}`, 'Rebuild index artifacts for this mode.');
      errors += 1;
    }
    if (typeof meta.file !== 'string' || !meta.file) {
      addIssue(report, mode, `metaV2 missing file at index ${i}`, 'Rebuild index artifacts for this mode.');
      errors += 1;
    }
    if (meta.risk?.flows) {
      for (const flow of meta.risk.flows || []) {
        if (!flow || !flow.source || !flow.sink) {
          addIssue(report, mode, `metaV2 risk flow missing source/sink at index ${i}`, 'Rebuild index artifacts for this mode.');
          errors += 1;
          break;
        }
      }
    }
    if (meta.types && typeof meta.types === 'object') {
      const checkTypeEntries = (bucket) => {
        if (!bucket || typeof bucket !== 'object') return;
        for (const entries of Object.values(bucket)) {
          const list = Array.isArray(entries) ? entries : [];
          for (const typeEntry of list) {
            if (!typeEntry?.type) {
              addIssue(report, mode, `metaV2 type entry missing type at index ${i}`, 'Rebuild index artifacts for this mode.');
              errors += 1;
              return;
            }
          }
        }
      };
      checkTypeEntries(meta.types.declared);
      checkTypeEntries(meta.types.inferred);
      checkTypeEntries(meta.types.tooling);
    }
    if (errors >= maxErrors) return;
  }
};

const validateFileNameCollisions = (report, mode, repoMap) => {
  const seen = new Set();
  for (const entry of Array.isArray(repoMap) ? repoMap : []) {
    const file = entry?.file;
    const name = entry?.name;
    if (!file || !name) continue;
    const key = `${file}::${name}`;
    if (seen.has(key)) {
      addIssue(
        report,
        mode,
        `ERR_ID_COLLISION duplicate file::name identifier: ${key}`,
        'Resolve symbol name collisions or update artifact generation.'
      );
      return;
    }
    seen.add(key);
  }
};

export async function validateIndexArtifacts(input = {}) {
  const root = getRepoRoot(input.root);
  const indexRoot = input.indexRoot ? path.resolve(input.indexRoot) : null;
  const userConfig = input.userConfig || loadUserConfig(root);
  const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});
  const modes = Array.isArray(input.modes) && input.modes.length
    ? input.modes
    : ['code', 'prose', 'extracted-prose', 'records'];

  const sqliteEnabled = typeof input.sqliteEnabled === 'boolean'
    ? input.sqliteEnabled
    : userConfig.sqlite?.use !== false;
  const strict = input.strict !== false;

  const report = {
    ok: true,
    root: path.resolve(root),
    indexRoot: indexRoot ? path.resolve(indexRoot) : null,
    modes: {},
    sqlite: { enabled: sqliteEnabled },
    strict,
    issues: [],
    warnings: [],
    hints: []
  };

  const requiredArtifacts = ['chunk_meta', 'token_postings'];
  const strictOnlyRequiredArtifacts = ['index_state', 'filelists'];
  if (postingsConfig.enablePhraseNgrams) requiredArtifacts.push('phrase_ngrams');
  if (postingsConfig.enableChargrams) requiredArtifacts.push('chargram_postings');
  const optionalArtifacts = [
    'minhash_signatures',
    'file_relations',
    'graph_relations',
    'file_meta',
    'repo_map',
    'filter_index',
    'field_postings',
    'field_tokens'
  ];
  if (userConfig.search?.annDefault !== false) {
    optionalArtifacts.push('dense_vectors');
    optionalArtifacts.push('dense_vectors_doc');
    optionalArtifacts.push('dense_vectors_code');
  }
  const lanceConfig = normalizeLanceDbConfig(userConfig.indexing?.embeddings?.lancedb || {});
  if (lanceConfig.enabled) {
    optionalArtifacts.push('dense_vectors.lancedb.meta.json');
    optionalArtifacts.push('dense_vectors_doc.lancedb.meta.json');
    optionalArtifacts.push('dense_vectors_code.lancedb.meta.json');
  }

  for (const mode of modes) {
    const dir = resolveIndexDir(root, mode, userConfig, indexRoot, strict);
    const modeReport = {
      path: path.resolve(dir),
      ok: true,
      missing: [],
      warnings: []
    };
    let manifest = null;
    const manifestPath = path.join(dir, 'pieces', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const message = 'pieces/manifest.json missing';
      if (strict) {
        modeReport.ok = false;
        modeReport.missing.push(message);
        report.issues.push(`[${mode}] ${message}`);
      } else {
        modeReport.warnings.push(message);
        report.warnings.push(`[${mode}] ${message}`);
      }
    } else {
      try {
        manifest = loadPiecesManifest(dir, { strict });
        validateSchema(
          report,
          mode,
          'pieces_manifest',
          manifest,
          'Rebuild index artifacts for this mode.',
          { strictSchema: strict }
        );
        if (strict) {
          if (!isSupportedVersion(manifest?.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION)) {
            addIssue(
              report,
              mode,
              `artifactSurfaceVersion unsupported: ${manifest?.artifactSurfaceVersion ?? 'missing'}`,
              'Rebuild index artifacts for this mode.'
            );
          }
          validateManifestEntries(report, mode, dir, manifest, { strictSchema: true });
        }
        if (!manifest || !Array.isArray(manifest.pieces)) {
          const issue = 'pieces/manifest.json invalid';
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        } else {
          for (const piece of manifest.pieces) {
            const relPath = piece?.path;
            if (!relPath) continue;
            const absPath = path.join(dir, normalizeManifestPath(relPath).split('/').join(path.sep));
            if (!fs.existsSync(absPath)) {
              const issue = `piece missing: ${relPath}`;
              modeReport.ok = false;
              modeReport.missing.push(issue);
              report.issues.push(`[${mode}] ${issue}`);
              continue;
            }
            const checksum = typeof piece?.checksum === 'string' ? piece.checksum : '';
            if (checksum) {
              const [algo, expected] = checksum.split(':');
              if (!algo || !expected) {
                const warning = `piece checksum invalid: ${relPath}`;
                modeReport.warnings.push(warning);
                report.warnings.push(`[${mode}] ${warning}`);
                continue;
              }
              if (algo === 'sha1') {
                const actual = await sha1File(absPath);
                if (actual !== expected) {
                  const issue = `piece checksum mismatch: ${relPath}`;
                  modeReport.ok = false;
                  modeReport.missing.push(issue);
                  report.issues.push(`[${mode}] ${issue}`);
                  report.hints.push('Run `pairofcleats index build` to refresh index artifacts.');
                }
              } else if (algo === 'xxh64') {
                const actual = await checksumFile(absPath);
                if (!actual || actual.value !== expected) {
                  const issue = `piece checksum mismatch: ${relPath}`;
                  modeReport.ok = false;
                  modeReport.missing.push(issue);
                  report.issues.push(`[${mode}] ${issue}`);
                  report.hints.push('Run `pairofcleats index build` to refresh index artifacts.');
                }
              } else {
                const warning = `piece checksum unsupported: ${relPath}`;
                modeReport.warnings.push(warning);
                report.warnings.push(`[${mode}] ${warning}`);
              }
            }
          }
        }
      } catch (err) {
        const issue = 'pieces/manifest.json invalid';
        modeReport.ok = false;
        modeReport.missing.push(issue);
        report.issues.push(`[${mode}] ${issue}`);
        if (strict) {
          report.hints.push('Rebuild index artifacts for this mode.');
        }
      }
    }

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

    const readJsonArtifact = (name, { required = false } = {}) => {
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
          return readJsonFile(presence.paths[0]);
        }
        const jsonPath = path.join(dir, `${name}.json`);
        if (!fs.existsSync(jsonPath) && !fs.existsSync(`${jsonPath}.gz`) && !fs.existsSync(`${jsonPath}.zst`)) {
          return null;
        }
        return readJsonFile(jsonPath);
      } catch (err) {
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
      if (name === 'chunk_meta') {
        const json = path.join(dir, 'chunk_meta.json');
        const jsonl = path.join(dir, 'chunk_meta.jsonl');
        const meta = path.join(dir, 'chunk_meta.meta.json');
        const partsDir = path.join(dir, 'chunk_meta.parts');
        return fs.existsSync(json) || fs.existsSync(jsonl) || fs.existsSync(meta) || fs.existsSync(partsDir);
      }
      const hasJsonlArtifact = (baseName) => {
        const json = path.join(dir, `${baseName}.json`);
        const jsonl = path.join(dir, `${baseName}.jsonl`);
        const meta = path.join(dir, `${baseName}.meta.json`);
        const partsDir = path.join(dir, `${baseName}.parts`);
        if (fs.existsSync(json) || fs.existsSync(`${json}.gz`)) return true;
        return fs.existsSync(jsonl) || fs.existsSync(meta) || fs.existsSync(partsDir);
      };
      if (name === 'file_relations') return hasJsonlArtifact('file_relations');
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
        const json = path.join(dir, 'dense_vectors_uint8.json');
        return fs.existsSync(json) || fs.existsSync(`${json}.gz`);
      }
      if (name === 'dense_vectors_doc') {
        const json = path.join(dir, 'dense_vectors_doc_uint8.json');
        return fs.existsSync(json) || fs.existsSync(`${json}.gz`);
      }
      if (name === 'dense_vectors_code') {
        const json = path.join(dir, 'dense_vectors_code_uint8.json');
        return fs.existsSync(json) || fs.existsSync(`${json}.gz`);
      }
      if (name === 'index_state') {
        return fs.existsSync(path.join(dir, 'index_state.json'));
      }
      if (name === 'filelists') {
        return fs.existsSync(path.join(dir, '.filelists.json'));
      }
      const filePath = path.join(dir, `${name}.json`);
      if (fs.existsSync(filePath)) return true;
      const gzPath = `${filePath}.gz`;
      const zstPath = `${filePath}.zst`;
      if (fs.existsSync(zstPath) || fs.existsSync(gzPath)) return true;
      return false;
    };

    if (strict) {
      for (const name of requiredArtifacts) {
        checkPresence(name, { required: true });
      }
      for (const name of strictOnlyRequiredArtifacts) {
        checkPresence(name, { required: true });
      }
      for (const name of optionalArtifacts) {
        checkPresence(name, { required: false });
      }
    } else {
      for (const name of requiredArtifacts) {
        if (!hasLegacyArtifact(name)) {
          modeReport.ok = false;
          modeReport.missing.push(name);
          report.issues.push(`[${mode}] missing ${name}`);
          report.hints.push('Run `pairofcleats index build` to rebuild missing artifacts.');
        }
      }
      for (const name of optionalArtifacts) {
        if (!hasLegacyArtifact(name)) {
          modeReport.warnings.push(name);
          report.warnings.push(`[${mode}] optional ${name} missing`);
        }
      }
    }
    try {
      let chunkMeta = null;
      try {
        chunkMeta = await loadChunkMeta(dir, { manifest, strict });
      } catch (err) {
        addIssue(report, mode, `chunk_meta load failed (${err?.code || err?.message || err})`, 'Rebuild index artifacts for this mode.');
        modeReport.ok = false;
      }
      if (!chunkMeta) {
        report.modes[mode] = modeReport;
        continue;
      }
      validateSchema(report, mode, 'chunk_meta', chunkMeta, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      validateChunkIds(report, mode, chunkMeta);
      validateMetaV2(report, mode, chunkMeta);

      if (postingsConfig.fielded && chunkMeta.length > 0) {
        const missingFieldArtifacts = [];
        const isMissingFieldArtifact = (name) => {
          if (strict) {
            const presence = resolvePresence(name);
            return !presence || presence.format === 'missing' || presence.error;
          }
          return !hasLegacyArtifact(name);
        };
        if (isMissingFieldArtifact('field_postings')) missingFieldArtifacts.push('field_postings');
        if (isMissingFieldArtifact('field_tokens')) missingFieldArtifacts.push('field_tokens');
        if (missingFieldArtifacts.length) {
          modeReport.ok = false;
          modeReport.missing.push(...missingFieldArtifacts);
          missingFieldArtifacts.forEach((artifact) => {
            report.issues.push(`[${mode}] missing ${artifact}`);
            report.hints.push('Run `pairofcleats index build` to rebuild missing artifacts.');
          });
        }
      }

      let tokenNormalized = null;
      try {
        const tokenIndex = loadTokenPostings(dir, { manifest, strict });
        tokenNormalized = normalizeTokenPostings(tokenIndex);
      } catch (err) {
        addIssue(report, mode, `token_postings load failed (${err?.code || err?.message || err})`, 'Rebuild index artifacts for this mode.');
        modeReport.ok = false;
      }
      if (tokenNormalized) {
        validateSchema(
          report,
          mode,
          'token_postings',
          tokenNormalized,
          'Rebuild index artifacts for this mode.',
          { strictSchema: strict }
        );
        const docLengths = tokenNormalized.docLengths || [];
        if (docLengths.length && chunkMeta.length !== docLengths.length) {
          const issue = `docLengths mismatch (${docLengths.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
        validatePostingsDocIds(report, mode, 'token_postings', tokenNormalized.postings, chunkMeta.length);
      }

      const fileMeta = readJsonArtifact('file_meta');
      if (fileMeta) {
        validateSchema(report, mode, 'file_meta', fileMeta, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        const fileIds = new Set();
        for (const entry of Array.isArray(fileMeta) ? fileMeta : []) {
          if (!Number.isFinite(entry?.id)) continue;
          if (fileIds.has(entry.id)) {
            addIssue(report, mode, `file_meta duplicate id ${entry.id}`, 'Rebuild index artifacts for this mode.');
            break;
          }
          fileIds.add(entry.id);
        }
        for (const chunk of chunkMeta) {
          const fileId = chunk?.fileId;
          if (fileId == null) continue;
          if (!fileIds.has(fileId)) {
            addIssue(report, mode, `chunk_meta fileId missing in file_meta (${fileId})`, 'Rebuild index artifacts for this mode.');
            break;
          }
        }
      }

      let repoMap = null;
      if (shouldLoadOptional('repo_map')) {
        try {
          repoMap = await loadJsonArrayArtifact(dir, 'repo_map', { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `repo_map load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (repoMap) {
        validateSchema(report, mode, 'repo_map', repoMap, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        validateFileNameCollisions(report, mode, repoMap);
      }

      let graphRelations = null;
      if (shouldLoadOptional('graph_relations')) {
        try {
          graphRelations = await loadGraphRelations(dir, { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `graph_relations load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (graphRelations) {
        validateSchema(report, mode, 'graph_relations', graphRelations, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      }

      const filterIndexRaw = readJsonArtifact('filter_index');
      const filterIndex = normalizeFilterIndex(filterIndexRaw);
      if (filterIndex) {
        validateSchema(report, mode, 'filter_index', filterIndex, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        const fileChunks = Array.isArray(filterIndex.fileChunksById) ? filterIndex.fileChunksById : [];
        validateIdPostings(report, mode, 'filter_index', fileChunks, chunkMeta.length);
      }

      const indexState = readJsonArtifact('index_state', { required: strict });
      if (indexState) {
        validateSchema(report, mode, 'index_state', indexState, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        if (strict && !isSupportedVersion(indexState?.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION)) {
          addIssue(
            report,
            mode,
            `index_state artifactSurfaceVersion unsupported: ${indexState?.artifactSurfaceVersion ?? 'missing'}`,
            'Rebuild index artifacts for this mode.'
          );
        }
      }

      const fileLists = readJsonArtifact('filelists', { required: strict });
      if (fileLists) {
        validateSchema(report, mode, 'filelists', fileLists, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      }

      let relations = null;
      if (shouldLoadOptional('file_relations')) {
        try {
          relations = await loadJsonArrayArtifact(dir, 'file_relations', { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `file_relations load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (relations) {
        validateSchema(report, mode, 'file_relations', relations, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      }

      const minhashRaw = readJsonArtifact('minhash_signatures');
      if (minhashRaw) {
        const minhash = normalizeMinhash(minhashRaw);
        validateSchema(report, mode, 'minhash_signatures', minhash, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        const signatures = minhash.signatures || [];
        if (signatures.length && signatures.length !== chunkMeta.length) {
          const issue = `minhash mismatch (${signatures.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
      }

      let fieldTokens = null;
      if (shouldLoadOptional('field_tokens')) {
        try {
          fieldTokens = await loadJsonArrayArtifact(dir, 'field_tokens', { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `field_tokens load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (fieldTokens) {
        validateSchema(report, mode, 'field_tokens', fieldTokens, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        if (Array.isArray(fieldTokens) && fieldTokens.length !== chunkMeta.length) {
          const issue = `field_tokens mismatch (${fieldTokens.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
      }

      const fieldPostingsRaw = readJsonArtifact('field_postings');
      const fieldPostings = normalizeFieldPostings(fieldPostingsRaw);
      if (fieldPostings) {
        validateSchema(report, mode, 'field_postings', fieldPostings, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        const fields = fieldPostings.fields || {};
        for (const entry of Object.values(fields)) {
          validatePostingsDocIds(report, mode, 'field_postings', entry?.postings, chunkMeta.length);
          const lengths = Array.isArray(entry?.docLengths) ? entry.docLengths : [];
          if (lengths.length && lengths.length !== chunkMeta.length) {
            const issue = `field_postings docLengths mismatch (${lengths.length} !== ${chunkMeta.length})`;
            modeReport.ok = false;
            modeReport.missing.push(issue);
            report.issues.push(`[${mode}] ${issue}`);
          }
        }
      }

      const phraseRaw = readJsonArtifact('phrase_ngrams');
      if (phraseRaw) {
        const phrase = normalizePhrasePostings(phraseRaw);
        validateSchema(report, mode, 'phrase_ngrams', phrase, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        validateIdPostings(report, mode, 'phrase_ngrams', phrase.postings, chunkMeta.length);
      }

      const chargramRaw = readJsonArtifact('chargram_postings');
      if (chargramRaw) {
        const chargram = normalizePhrasePostings(chargramRaw);
        validateSchema(report, mode, 'chargram_postings', chargram, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        validateIdPostings(report, mode, 'chargram_postings', chargram.postings, chunkMeta.length);
      }

      const denseTargets = [
        { label: 'dense_vectors', name: 'dense_vectors', file: 'dense_vectors_uint8.json' },
        { label: 'dense_vectors_doc', name: 'dense_vectors_doc', file: 'dense_vectors_doc_uint8.json' },
        { label: 'dense_vectors_code', name: 'dense_vectors_code', file: 'dense_vectors_code_uint8.json' }
      ];
      for (const target of denseTargets) {
        const denseRaw = strict
          ? readJsonArtifact(target.name)
          : (() => {
            const densePath = path.join(dir, target.file);
            if (!fs.existsSync(densePath) && !fs.existsSync(`${densePath}.gz`)) return null;
            return readJsonFile(densePath);
          })();
        if (!denseRaw) continue;
        const dense = normalizeDenseVectors(denseRaw);
        validateSchema(report, mode, target.name, dense, 'Rebuild embeddings for this mode.', { strictSchema: strict });
        const vectors = dense.vectors || [];
        if (vectors.length && vectors.length !== chunkMeta.length) {
          const issue = `${target.label} mismatch (${vectors.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
        if (dense.dims) {
          for (let i = 0; i < Math.min(vectors.length, 25); i += 1) {
            if (!Array.isArray(vectors[i]) || vectors[i].length !== dense.dims) {
              addIssue(report, mode, `${target.label} dims mismatch at ${i}`, 'Rebuild embeddings for this mode.');
              break;
            }
          }
        }
      }
      const hnswMetaPath = path.join(dir, 'dense_vectors_hnsw.meta.json');
      if (fs.existsSync(hnswMetaPath)) {
        const hnswMeta = readJsonFile(hnswMetaPath);
        validateSchema(
          report,
          mode,
          'dense_vectors_hnsw_meta',
          hnswMeta,
          'Rebuild embeddings for this mode.',
          { strictSchema: strict }
        );
        if (Number.isFinite(hnswMeta?.count) && hnswMeta.count !== chunkMeta.length) {
          const issue = `dense_vectors_hnsw count mismatch (${hnswMeta.count} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
        const hnswIndexPath = path.join(dir, 'dense_vectors_hnsw.bin');
        if (!fs.existsSync(hnswIndexPath)) {
          addIssue(report, mode, 'dense_vectors_hnsw index missing', 'Rebuild embeddings for this mode.');
        }
      }
      if (lanceConfig.enabled) {
        const lancePaths = resolveLanceDbPaths(dir);
        const lanceTargets = [
          { label: 'dense_vectors_lancedb', metaPath: lancePaths.merged.metaPath, dir: lancePaths.merged.dir },
          { label: 'dense_vectors_doc_lancedb', metaPath: lancePaths.doc.metaPath, dir: lancePaths.doc.dir },
          { label: 'dense_vectors_code_lancedb', metaPath: lancePaths.code.metaPath, dir: lancePaths.code.dir }
        ];
        for (const target of lanceTargets) {
          if (!fs.existsSync(target.metaPath)) continue;
          const meta = readJsonFile(target.metaPath);
          validateSchema(
            report,
            mode,
            'dense_vectors_lancedb_meta',
            meta,
            'Rebuild embeddings for this mode.',
            { strictSchema: strict }
          );
          if (Number.isFinite(meta?.count) && meta.count !== chunkMeta.length) {
            const issue = `${target.label} count mismatch (${meta.count} !== ${chunkMeta.length})`;
            modeReport.ok = false;
            modeReport.missing.push(issue);
            report.issues.push(`[${mode}] ${issue}`);
          }
          if (!fs.existsSync(target.dir)) {
            addIssue(report, mode, `${target.label} directory missing`, 'Rebuild embeddings for this mode.');
          }
        }
      }
    } catch (err) {
      const issue = `validation failed (${err?.code || err?.message || 'error'})`;
      modeReport.ok = false;
      modeReport.missing.push(issue);
      report.issues.push(`[${mode}] ${issue}`);
    }
    report.modes[mode] = modeReport;
  }

  const buildsRoot = getBuildsRoot(root, userConfig);
  const currentPath = path.join(buildsRoot, 'current.json');
  if (fs.existsSync(currentPath)) {
    try {
      const current = readJsonFile(currentPath);
      validateSchema(
        report,
        null,
        'builds_current',
        current,
        'Rebuild index artifacts for this repo.',
        { strictSchema: strict }
      );
      if (strict && !isSupportedVersion(current?.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION)) {
        addIssue(
          report,
          null,
          `current.json artifactSurfaceVersion unsupported: ${current?.artifactSurfaceVersion ?? 'missing'}`,
          'Rebuild index artifacts for this repo.'
        );
      }
      if (strict) {
        const repoCacheRoot = path.resolve(path.dirname(buildsRoot));
        const ensureSafeRoot = (value, label) => {
          if (!value) return;
          const resolved = path.isAbsolute(value) ? value : path.join(repoCacheRoot, value);
          const normalized = path.resolve(resolved);
          if (!normalized.startsWith(repoCacheRoot + path.sep) && normalized !== repoCacheRoot) {
            addIssue(report, null, `current.json ${label} escapes repo cache root`);
          }
        };
        ensureSafeRoot(current?.buildRoot, 'buildRoot');
        const rootsByMode = current?.buildRootsByMode || null;
        if (rootsByMode && typeof rootsByMode === 'object' && !Array.isArray(rootsByMode)) {
          for (const value of Object.values(rootsByMode)) {
            ensureSafeRoot(value, 'buildRootsByMode');
          }
        }
      }
    } catch (err) {
      addIssue(report, null, `current.json invalid (${err?.message || err})`);
    }
  }

  const lmdbEnabled = typeof input.lmdbEnabled === 'boolean'
    ? input.lmdbEnabled
    : userConfig.lmdb?.use !== false;
  const lmdbPaths = resolveLmdbPaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const lmdbTargets = new Set(modes.filter((mode) => mode === 'code' || mode === 'prose'));
  const lmdbReport = {
    enabled: lmdbEnabled,
    ok: true,
    code: lmdbPaths.codePath,
    prose: lmdbPaths.prosePath,
    issues: [],
    warnings: []
  };
  lmdbReport.enabled = lmdbReport.enabled && lmdbTargets.size > 0;

  if (lmdbReport.enabled) {
    let openLmdb = null;
    try {
      ({ open: openLmdb } = await import('lmdb'));
    } catch {}
    const addLmdbIssue = (label, message, hint) => {
      lmdbReport.ok = false;
      lmdbReport.issues.push(`${label}: ${message}`);
      addIssue(report, `lmdb/${label}`, message, hint);
    };
    const addLmdbWarning = (label, message) => {
      lmdbReport.warnings.push(`${label}: ${message}`);
      report.warnings.push(`[lmdb/${label}] ${message}`);
    };
    const validateStore = (label, storePath) => {
      if (!hasLmdbStore(storePath)) {
        addLmdbWarning(label, 'db missing');
        return;
      }
      if (!openLmdb) {
        addLmdbWarning(label, 'lmdb dependency unavailable; integrity check skipped');
        return;
      }
      const db = openLmdb({ path: storePath, readOnly: true });
      try {
        const version = decode(db.get(LMDB_META_KEYS.schemaVersion));
        if (version !== LMDB_SCHEMA_VERSION) {
          addLmdbIssue(
            label,
            `schema mismatch (expected ${LMDB_SCHEMA_VERSION}, got ${version ?? 'missing'})`,
            'Run `npm run build-lmdb-index` to rebuild LMDB artifacts.'
          );
        }
        const modeValue = decode(db.get(LMDB_META_KEYS.mode));
        if (modeValue && modeValue !== label) {
          addLmdbIssue(
            label,
            `mode mismatch (expected ${label}, got ${modeValue})`,
            'Run `npm run build-lmdb-index` to rebuild LMDB artifacts.'
          );
        }
        const chunkCount = decode(db.get(LMDB_META_KEYS.chunkCount));
        if (chunkCount != null && !Number.isFinite(Number(chunkCount))) {
          addLmdbWarning(label, 'meta:chunkCount invalid');
        }
        const artifacts = decode(db.get(LMDB_META_KEYS.artifacts));
        if (!Array.isArray(artifacts)) {
          addLmdbIssue(
            label,
            'meta:artifacts missing or invalid',
            'Run `npm run build-lmdb-index` to rebuild LMDB artifacts.'
          );
          return;
        }
        for (const key of LMDB_REQUIRED_ARTIFACT_KEYS) {
          if (!artifacts.includes(key)) {
            addLmdbIssue(
              label,
              `missing artifact key ${key}`,
              'Run `npm run build-lmdb-index` to rebuild LMDB artifacts.'
            );
          }
          if (db.get(key) == null) {
            addLmdbIssue(
              label,
              `artifact missing: ${key}`,
              'Run `npm run build-lmdb-index` to rebuild LMDB artifacts.'
            );
          }
        }
      } finally {
        db.close();
      }
    };
    if (lmdbTargets.has('code')) validateStore('code', lmdbPaths.codePath);
    if (lmdbTargets.has('prose')) validateStore('prose', lmdbPaths.prosePath);
  }

  const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const sqliteMode = userConfig.sqlite?.scoreMode === 'fts' ? 'fts' : 'bm25';
  const sqliteTargets = new Set(modes.filter((mode) => mode === 'code' || mode === 'prose'));
  const requireCodeDb = sqliteTargets.has('code');
  const requireProseDb = sqliteTargets.has('prose');
  const sqliteRequiredTables = sqliteMode === 'fts'
    ? ['chunks', 'chunks_fts', 'minhash_signatures', 'dense_vectors', 'dense_meta']
    : [
      'chunks',
      'token_vocab',
      'token_postings',
      'doc_lengths',
      'token_stats',
      'phrase_vocab',
      'phrase_postings',
      'chargram_vocab',
      'chargram_postings',
      'minhash_signatures',
      'dense_vectors',
      'dense_meta'
    ];

  const sqliteReport = {
    enabled: report.sqlite.enabled,
    mode: sqliteMode,
    ok: true,
    code: sqlitePaths.codePath,
    prose: sqlitePaths.prosePath,
    issues: []
  };
  sqliteReport.enabled = sqliteReport.enabled && sqliteTargets.size > 0;

  if (sqliteReport.enabled) {
    const sqliteIssues = [];
    if (requireCodeDb && !fs.existsSync(sqlitePaths.codePath)) sqliteIssues.push('code db missing');
    if (requireProseDb && !fs.existsSync(sqlitePaths.prosePath)) sqliteIssues.push('prose db missing');
    if (sqliteIssues.length) {
      sqliteReport.ok = false;
      sqliteReport.issues.push(...sqliteIssues);
      sqliteIssues.forEach((issue) => report.issues.push(`[sqlite] ${issue}`));
      report.hints.push('Run `npm run build-sqlite-index` to rebuild SQLite artifacts.');
    } else {
      let Database = null;
      try {
        ({ default: Database } = await import('better-sqlite3'));
      } catch {
        sqliteReport.ok = false;
        const issue = 'better-sqlite3 not available';
        sqliteReport.issues.push(issue);
        report.issues.push(`[sqlite] ${issue}`);
        report.hints.push('Run `npm install` to install better-sqlite3.');
      }
      if (Database) {
        const checkTables = (dbPath, label) => {
          const db = new Database(dbPath, { readonly: true });
          try {
            const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = new Set(rows.map((row) => row.name));
            const missing = sqliteRequiredTables.filter((name) => !tableNames.has(name));
            if (missing.length) {
              sqliteReport.ok = false;
              const issue = `${label} missing tables: ${missing.join(', ')}`;
              sqliteReport.issues.push(issue);
              report.issues.push(`[sqlite] ${issue}`);
              report.hints.push('Run `npm run build-sqlite-index` to rebuild SQLite artifacts.');
            }
          } finally {
            db.close();
          }
        };
        if (requireCodeDb) checkTables(sqlitePaths.codePath, 'code');
        if (requireProseDb) checkTables(sqlitePaths.prosePath, 'prose');
      }
    }
  }

  report.lmdb = lmdbReport;
  report.sqlite = sqliteReport;
  report.ok = report.issues.length === 0;
  return report;
}
