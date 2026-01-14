import fs from 'node:fs';
import path from 'node:path';
import {
  getIndexDir,
  loadUserConfig,
  resolveLmdbPaths,
  resolveRepoRoot,
  resolveSqlitePaths
} from '../../tools/dict-utils.js';
import { normalizePostingsConfig } from '../shared/postings-config.js';
import { loadChunkMeta, loadTokenPostings, readJsonFile } from '../shared/artifact-io.js';
import { checksumFile, sha1File } from '../shared/hash.js';
import { validateArtifact } from '../shared/artifact-schemas.js';
import { Unpackr } from 'msgpackr';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../storage/lmdb/schema.js';

const resolveIndexDir = (root, mode, userConfig, indexRoot = null) => {
  const cached = getIndexDir(root, mode, userConfig, { indexRoot });
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

const validateSchema = (report, mode, name, payload, hint) => {
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

export async function validateIndexArtifacts(input = {}) {
  const root = input.root ? path.resolve(input.root) : resolveRepoRoot(process.cwd());
  const indexRoot = input.indexRoot ? path.resolve(input.indexRoot) : null;
  const userConfig = input.userConfig || loadUserConfig(root);
  const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});
  const modes = Array.isArray(input.modes) && input.modes.length
    ? input.modes
    : ['code', 'prose'];

  const sqliteEnabled = typeof input.sqliteEnabled === 'boolean'
    ? input.sqliteEnabled
    : userConfig.sqlite?.use !== false;

  const report = {
    ok: true,
    root: path.resolve(root),
    indexRoot: indexRoot ? path.resolve(indexRoot) : null,
    modes: {},
    sqlite: { enabled: sqliteEnabled },
    issues: [],
    warnings: [],
    hints: []
  };

  const requiredFiles = ['chunk_meta', 'token_postings'];
  if (postingsConfig.enablePhraseNgrams) requiredFiles.push('phrase_ngrams.json');
  if (postingsConfig.enableChargrams) requiredFiles.push('chargram_postings.json');
  const optionalFiles = [
    'minhash_signatures.json',
    'file_relations.json',
    'graph_relations.json',
    'file_meta.json',
    'repo_map.json',
    'filter_index.json',
    'index_state.json'
  ];
  if (userConfig.search?.annDefault !== false) {
    optionalFiles.push('dense_vectors_uint8.json');
    optionalFiles.push('dense_vectors_doc_uint8.json');
    optionalFiles.push('dense_vectors_code_uint8.json');
  }

  for (const mode of modes) {
    const dir = resolveIndexDir(root, mode, userConfig, indexRoot);
    const modeReport = {
      path: path.resolve(dir),
      ok: true,
      missing: [],
      warnings: []
    };
    const manifestPath = path.join(dir, 'pieces', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const warning = 'pieces/manifest.json missing';
      modeReport.warnings.push(warning);
      report.warnings.push(`[${mode}] ${warning}`);
    } else {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        validateSchema(report, mode, 'pieces_manifest', manifest, 'Rebuild index artifacts for this mode.');
        if (!manifest || !Array.isArray(manifest.pieces)) {
          const issue = 'pieces/manifest.json invalid';
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        } else {
          for (const piece of manifest.pieces) {
            const relPath = piece?.path;
            if (!relPath) continue;
            const absPath = path.join(dir, relPath.split('/').join(path.sep));
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
      } catch {
        const issue = 'pieces/manifest.json invalid';
        modeReport.ok = false;
        modeReport.missing.push(issue);
        report.issues.push(`[${mode}] ${issue}`);
      }
    }

    const hasArtifact = (file) => {
      if (file === 'chunk_meta') {
        const json = path.join(dir, 'chunk_meta.json');
        const jsonl = path.join(dir, 'chunk_meta.jsonl');
        const meta = path.join(dir, 'chunk_meta.meta.json');
        const partsDir = path.join(dir, 'chunk_meta.parts');
        return fs.existsSync(json) || fs.existsSync(jsonl) || fs.existsSync(meta) || fs.existsSync(partsDir);
      }
      if (file === 'token_postings') {
        const json = path.join(dir, 'token_postings.json');
        const meta = path.join(dir, 'token_postings.meta.json');
        const shardsDir = path.join(dir, 'token_postings.shards');
        return fs.existsSync(json) || fs.existsSync(meta) || fs.existsSync(shardsDir);
      }
      const filePath = path.join(dir, file);
      if (fs.existsSync(filePath)) return true;
      if (file.endsWith('.json')) {
        const gzPath = `${filePath}.gz`;
        if (fs.existsSync(gzPath)) return true;
      }
      return false;
    };
    for (const file of requiredFiles) {
      if (!hasArtifact(file)) {
        modeReport.ok = false;
        modeReport.missing.push(file);
        report.issues.push(`[${mode}] missing ${file}`);
        report.hints.push('Run `pairofcleats index build` to rebuild missing artifacts.');
      }
    }
    for (const file of optionalFiles) {
      if (!hasArtifact(file)) {
        modeReport.warnings.push(file);
        report.warnings.push(`[${mode}] optional ${file} missing`);
      }
    }
    try {
      const chunkMeta = loadChunkMeta(dir);
      validateSchema(report, mode, 'chunk_meta', chunkMeta, 'Rebuild index artifacts for this mode.');
      validateChunkIds(report, mode, chunkMeta);
      validateMetaV2(report, mode, chunkMeta);

      if (postingsConfig.fielded && chunkMeta.length > 0) {
        const missingFieldArtifacts = [];
        if (!hasArtifact('field_postings.json')) missingFieldArtifacts.push('field_postings.json');
        if (!hasArtifact('field_tokens.json')) missingFieldArtifacts.push('field_tokens.json');
        if (missingFieldArtifacts.length) {
          modeReport.ok = false;
          modeReport.missing.push(...missingFieldArtifacts);
          missingFieldArtifacts.forEach((artifact) => {
            report.issues.push(`[${mode}] missing ${artifact}`);
            report.hints.push('Run `pairofcleats index build` to rebuild missing artifacts.');
          });
        }
      }

      const tokenIndex = loadTokenPostings(dir);
      const tokenNormalized = normalizeTokenPostings(tokenIndex);
      if (tokenNormalized) {
        validateSchema(report, mode, 'token_postings', tokenNormalized, 'Rebuild index artifacts for this mode.');
        const docLengths = tokenNormalized.docLengths || [];
        if (docLengths.length && chunkMeta.length !== docLengths.length) {
          const issue = `docLengths mismatch (${docLengths.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
        validatePostingsDocIds(report, mode, 'token_postings', tokenNormalized.postings, chunkMeta.length);
      }

      const fileMetaPath = path.join(dir, 'file_meta.json');
      if (fs.existsSync(fileMetaPath) || fs.existsSync(`${fileMetaPath}.gz`)) {
        const fileMeta = readJsonFile(fileMetaPath);
        validateSchema(report, mode, 'file_meta', fileMeta, 'Rebuild index artifacts for this mode.');
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

      const repoMapPath = path.join(dir, 'repo_map.json');
      if (fs.existsSync(repoMapPath) || fs.existsSync(`${repoMapPath}.gz`)) {
        const repoMap = readJsonFile(repoMapPath);
        validateSchema(report, mode, 'repo_map', repoMap, 'Rebuild index artifacts for this mode.');
      }

      const graphPath = path.join(dir, 'graph_relations.json');
      if (fs.existsSync(graphPath) || fs.existsSync(`${graphPath}.gz`)) {
        const graphRelations = readJsonFile(graphPath);
        validateSchema(report, mode, 'graph_relations', graphRelations, 'Rebuild index artifacts for this mode.');
      }

      const filterIndexPath = path.join(dir, 'filter_index.json');
      if (fs.existsSync(filterIndexPath)) {
        const filterIndex = normalizeFilterIndex(readJsonFile(filterIndexPath));
        if (filterIndex) {
          validateSchema(report, mode, 'filter_index', filterIndex, 'Rebuild index artifacts for this mode.');
          const fileChunks = Array.isArray(filterIndex.fileChunksById) ? filterIndex.fileChunksById : [];
          validateIdPostings(report, mode, 'filter_index', fileChunks, chunkMeta.length);
        }
      }

      const statePath = path.join(dir, 'index_state.json');
      if (fs.existsSync(statePath)) {
        const indexState = readJsonFile(statePath);
        validateSchema(report, mode, 'index_state', indexState, 'Rebuild index artifacts for this mode.');
      }

      const relationsPath = path.join(dir, 'file_relations.json');
      if (fs.existsSync(relationsPath)) {
        const relations = readJsonFile(relationsPath);
        validateSchema(report, mode, 'file_relations', relations, 'Rebuild index artifacts for this mode.');
      }

      const minhashPath = path.join(dir, 'minhash_signatures.json');
      if (fs.existsSync(minhashPath) || fs.existsSync(`${minhashPath}.gz`)) {
        const minhashRaw = readJsonFile(minhashPath);
        const minhash = normalizeMinhash(minhashRaw);
        validateSchema(report, mode, 'minhash_signatures', minhash, 'Rebuild index artifacts for this mode.');
        const signatures = minhash.signatures || [];
        if (signatures.length && signatures.length !== chunkMeta.length) {
          const issue = `minhash mismatch (${signatures.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
      }

      const fieldTokensPath = path.join(dir, 'field_tokens.json');
      if (fs.existsSync(fieldTokensPath) || fs.existsSync(`${fieldTokensPath}.gz`)) {
        const fieldTokens = readJsonFile(fieldTokensPath);
        validateSchema(report, mode, 'field_tokens', fieldTokens, 'Rebuild index artifacts for this mode.');
        if (Array.isArray(fieldTokens) && fieldTokens.length !== chunkMeta.length) {
          const issue = `field_tokens mismatch (${fieldTokens.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
      }

      const fieldPostingsPath = path.join(dir, 'field_postings.json');
      if (fs.existsSync(fieldPostingsPath) || fs.existsSync(`${fieldPostingsPath}.gz`)) {
        const fieldPostingsRaw = readJsonFile(fieldPostingsPath);
        const fieldPostings = normalizeFieldPostings(fieldPostingsRaw);
        if (fieldPostings) {
          validateSchema(report, mode, 'field_postings', fieldPostings, 'Rebuild index artifacts for this mode.');
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
      }

      const phrasePath = path.join(dir, 'phrase_ngrams.json');
      if (fs.existsSync(phrasePath) || fs.existsSync(`${phrasePath}.gz`)) {
        const phraseRaw = readJsonFile(phrasePath);
        const phrase = normalizePhrasePostings(phraseRaw);
        validateSchema(report, mode, 'phrase_ngrams', phrase, 'Rebuild index artifacts for this mode.');
        validateIdPostings(report, mode, 'phrase_ngrams', phrase.postings, chunkMeta.length);
      }

      const chargramPath = path.join(dir, 'chargram_postings.json');
      if (fs.existsSync(chargramPath) || fs.existsSync(`${chargramPath}.gz`)) {
        const chargramRaw = readJsonFile(chargramPath);
        const chargram = normalizePhrasePostings(chargramRaw);
        validateSchema(report, mode, 'chargram_postings', chargram, 'Rebuild index artifacts for this mode.');
        validateIdPostings(report, mode, 'chargram_postings', chargram.postings, chunkMeta.length);
      }

      const denseTargets = [
        { label: 'dense_vectors', file: 'dense_vectors_uint8.json' },
        { label: 'dense_vectors_doc', file: 'dense_vectors_doc_uint8.json' },
        { label: 'dense_vectors_code', file: 'dense_vectors_code_uint8.json' }
      ];
      for (const target of denseTargets) {
        const densePath = path.join(dir, target.file);
        if (!fs.existsSync(densePath) && !fs.existsSync(`${densePath}.gz`)) continue;
        const denseRaw = readJsonFile(densePath);
        const dense = normalizeDenseVectors(denseRaw);
        validateSchema(report, mode, 'dense_vectors', dense, 'Rebuild embeddings for this mode.');
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
        validateSchema(report, mode, 'dense_vectors_hnsw_meta', hnswMeta, 'Rebuild embeddings for this mode.');
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
    } catch (err) {
      const warning = `validation skipped (${err?.code || err?.message || 'error'})`;
      modeReport.warnings.push(warning);
      report.warnings.push(`[${mode}] ${warning}`);
    }
    report.modes[mode] = modeReport;
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
        const requiredArtifacts = [
          LMDB_ARTIFACT_KEYS.chunkMeta,
          LMDB_ARTIFACT_KEYS.tokenPostings
        ];
        for (const key of requiredArtifacts) {
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
