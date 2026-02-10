import fs from 'node:fs';
import path from 'node:path';
import { Unpackr } from 'msgpackr';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from './schema.js';

export const hasLmdbStore = (storePath) => {
  if (!storePath || !fs.existsSync(storePath)) return false;
  return fs.existsSync(path.join(storePath, 'data.mdb'));
};

export const createLmdbCodec = () => {
  const unpackr = new Unpackr();
  return {
    unpackr,
    decode(value) {
      return value == null ? null : unpackr.unpack(value);
    }
  };
};

const defaultCodec = createLmdbCodec();
export const decodeLmdbValue = defaultCodec.decode.bind(defaultCodec);

export const validateLmdbSchemaAndMode = ({
  db,
  label,
  decode = decodeLmdbValue,
  metaKeys = LMDB_META_KEYS,
  schemaVersion = LMDB_SCHEMA_VERSION
}) => {
  const issues = [];
  const version = decode(db.get(metaKeys.schemaVersion));
  if (version !== schemaVersion) {
    issues.push(`schema mismatch (expected ${schemaVersion}, got ${version ?? 'missing'})`);
  }
  const mode = decode(db.get(metaKeys.mode));
  if (mode && mode !== label) {
    issues.push(`mode mismatch (expected ${label}, got ${mode})`);
  }
  return { ok: issues.length === 0, issues, version, mode };
};

export const validateLmdbArtifactKeys = ({
  db,
  requiredKeys,
  decode = decodeLmdbValue,
  metaKeys = LMDB_META_KEYS
}) => {
  const artifacts = decode(db.get(metaKeys.artifacts));
  if (!Array.isArray(artifacts)) {
    return {
      ok: false,
      artifacts: null,
      missingMeta: true,
      missingArtifactKeys: [],
      missingArtifactValues: []
    };
  }
  const required = Array.isArray(requiredKeys) ? requiredKeys.filter(Boolean) : [];
  const missingArtifactKeys = required.filter((key) => !artifacts.includes(key));
  const missingArtifactValues = required.filter((key) => db.get(key) == null);
  return {
    ok: missingArtifactKeys.length === 0 && missingArtifactValues.length === 0,
    artifacts,
    missingMeta: false,
    missingArtifactKeys,
    missingArtifactValues
  };
};
