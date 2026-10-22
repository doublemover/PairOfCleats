import path from 'node:path';
import { resolveRequiredArtifactsForProfile } from '../../src/contracts/index-profile.js';

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
  const counts = payload.map(piece => piece.count);
  return { rows: counts.length && counts.every(value => Number.isSafeInteger(value) && value >= 0)
    ? counts.reduce((sum, value) => sum + value, 0) : null,
  parts: payload.filter(piece => String(piece.path || '').includes('.part-')).length,
  bytes: selected.reduce((sum, piece) => sum + (Number(piece.bytes) || 0), 0) };
};

export const missingRequiredStatsFamilies = (pieces, profileId) => resolveRequiredArtifactsForProfile(profileId)
  .filter(name => !pieces.some(piece => piece?.name === name));
