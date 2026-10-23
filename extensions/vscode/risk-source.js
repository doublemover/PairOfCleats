const path = require('node:path');
const fs = require('node:fs');
const { readCurrentSource } = require('./document-authority.js');

const samePath = (left, right) => {
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
};
const text = value => typeof value === 'string' ? value.trim() : '';
const retryMessage = 'Run Risk Explain again to deliberately select the current generation.';

// Context-pack owns repository/configuration/per-mode root selection. This
// adapter consumes its provenance; it never reconstructs cache directory names.
function resolveRiskSource(payload, { repoRoot, seed }) {
  const provenance = payload?.provenance;
  const index = text(provenance?.indexDir), signature = text(provenance?.indexSignature);
  const repo = text(provenance?.repo);
  if (!index || !signature || !repo || !samePath(path.resolve(repoRoot, repo), repoRoot)) {
    throw new Error(`Risk seed resolution returned no qualified code generation. ${retryMessage}`);
  }
  const chunkUid = text(payload?.risk?.anchor?.chunkUid || payload?.primary?.ref?.chunkUid
    || payload?.primary?.ref?.resolved?.chunkUid || payload?.risk?.summary?.chunkUid);
  if (!chunkUid) throw new Error(`The selected seed has no chunk in this generation. ${retryMessage}`);
  if (seed?.startsWith('chunk:') && seed.slice('chunk:'.length) !== chunkUid) {
    throw new Error(`Risk seed resolution returned a different chunk from the selected seed. ${retryMessage}`);
  }
  const indexDir = path.resolve(repoRoot, index);
  const manifest = readCurrentSource({ repoRoot: indexDir, file: path.join(indexDir, 'pieces', 'manifest.json') });
  return { chunkUid, indexDir, sourceQualification: {
    source: 'context-pack', repoRoot: path.resolve(repoRoot), mode: 'code', indexDir,
    indexSignature: signature, indexCompatKey: text(provenance.indexCompatKey) || null, seed,
    manifestHash: manifest.sourceHash
  } };
}

function validateRiskSource(input, repoRoot) {
  const source = input?.sourceQualification;
  if (!source || source.source !== 'context-pack' || source.mode !== 'code'
    || !text(source.indexSignature) || !text(source.repoRoot) || !text(source.indexDir)
    || !text(source.seed) || !text(input.seed) || !text(input.chunkUid)
    || !/^[a-f0-9]{64}$/.test(source.manifestHash || '')
    || !text(input.indexDir) || !samePath(source.repoRoot, repoRoot)
    || !samePath(source.indexDir, input.indexDir) || source.seed !== input.seed
    || source.seed.startsWith('chunk:') && source.seed.slice('chunk:'.length) !== input.chunkUid) {
    return `Saved risk request has no matching source-generation qualification. ${retryMessage}`;
  }
  if (!fs.existsSync(path.join(source.indexDir, 'pieces', 'manifest.json'))) {
    return `The selected code generation is no longer available. ${retryMessage}`;
  }
  try {
    const manifest = readCurrentSource({ repoRoot: source.indexDir,
      file: path.join(source.indexDir, 'pieces', 'manifest.json') });
    if (manifest.sourceHash !== source.manifestHash) {
      return `The selected code generation manifest changed. ${retryMessage}`;
    }
  } catch (error) { return `The selected code generation cannot be verified: ${error.message}. ${retryMessage}`; }
  return null;
}

module.exports = { resolveRiskSource, validateRiskSource };
