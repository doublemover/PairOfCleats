import { resolveRequiredArtifactsForProfile } from '../../src/contracts/index-profile.js';

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
