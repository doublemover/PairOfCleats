import path from 'node:path';
import { resolveRequiredArtifactsForProfile } from '../../src/contracts/index-profile.js';

export const normalizeManifestCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export const sumKnownCounts = values => {
  let total = 0;
  if (!values.length) return null;
  for (const value of values) {
    if (normalizeManifestCount(value) === null || !Number.isSafeInteger(total + value)) return null;
    total += value;
  }
  return total;
};

/** Whole-family/channel metadata repeats one total, never a shard-local sum. */
export const reconcileWholeFamilyCounts = values => {
  if (!values.length || normalizeManifestCount(values[0]) === null) return null;
  return values.every(value => value === values[0]) ? values[0] : null;
};

/** These producers register disjoint payload rows under their exact family
 * name: symbols/occurrences/edges/call-sites/graph rows and file/chunk metadata.
 * Phrase/chargram and unsharded postings register one vocabulary total instead.
 * Auxiliaries and compatibility encodings have distinct names. Compression
 * variants of the same physical payload repeat its count and are reconciled.
 * Multiple nonshard representations are alternatives, so they must agree.
 */
export const logicalPayloadRows = (pieces, family) => {
  const logical = new Map();
  for (const piece of pieces) {
    if (piece?.name !== family) continue;
    if (typeof piece.path !== 'string' || !piece.path) return null;
    const key = piece.path.replace(/\.(?:gz|zst)$/i, '');
    if (!logical.has(key)) logical.set(key, []);
    logical.get(key).push(piece.count);
  }
  const entries = [...logical];
  if (!entries.length) return null;
  const counts = entries.map(([, values]) => reconcileWholeFamilyCounts(values));
  if (entries.length === 1 || entries.every(([filename]) => /\.part-\d+\.(?:jsonl?|bin)$/i.test(filename))) {
    return sumKnownCounts(counts);
  }
  return reconcileWholeFamilyCounts(counts);
};

export const accumulateManifestBytes = (physicalPieces, indexDir, pieces) => {
  for (const piece of pieces) {
    if (typeof piece?.path !== 'string' || !piece.path) continue;
    const key = path.resolve(indexDir, piece.path);
    const bytes = Number.isSafeInteger(piece.bytes) && piece.bytes >= 0 ? piece.bytes : null;
    if (!physicalPieces.has(key)) physicalPieces.set(key, bytes);
    else if (physicalPieces.get(key) !== bytes) physicalPieces.set(key, null);
  }
  return physicalPieces;
};

export const summarizeManifestBytes = physicalPieces => {
  const counts = [...physicalPieces.values()];
  const unknownPieces = counts.filter(bytes => bytes === null).length;
  return { pieces: counts.length, unknownPieces,
    bytes: unknownPieces ? null : counts.reduce((sum, bytes) => sum + bytes, 0) };
};

export const buildPrefixedPieceStats = (pieces, family) => {
  const selected = pieces.filter(piece => String(piece?.name || '').startsWith(family));
  // Each logical payload part owns its row count; offsets/cold copies/meta and
  // alternative encodings cannot contribute a second copy of those rows.
  const payload = selected.filter(piece => piece.name === family);
  return { rows: logicalPayloadRows(payload, family),
    parts: payload.filter(piece => String(piece.path || '').includes('.part-')).length,
    bytes: selected.reduce((sum, piece) => sum + (Number(piece.bytes) || 0), 0) };
};

export const missingRequiredStatsFamilies = (pieces, profileId) => resolveRequiredArtifactsForProfile(profileId)
  .filter(name => !pieces.some(piece => piece?.name === name));
