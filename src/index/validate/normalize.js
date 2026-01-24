export const extractArray = (raw, key) => {
  if (Array.isArray(raw?.[key])) return raw[key];
  if (Array.isArray(raw?.arrays?.[key])) return raw.arrays[key];
  return [];
};

export const normalizeDenseVectors = (raw) => ({
  model: raw?.model ?? raw?.fields?.model ?? null,
  dims: Number.isFinite(Number(raw?.dims ?? raw?.fields?.dims))
    ? Number(raw?.dims ?? raw?.fields?.dims)
    : null,
  scale: Number.isFinite(Number(raw?.scale ?? raw?.fields?.scale))
    ? Number(raw?.scale ?? raw?.fields?.scale)
    : null,
  vectors: extractArray(raw, 'vectors')
});

export const normalizeMinhash = (raw) => ({
  signatures: extractArray(raw, 'signatures'),
  width: Number.isFinite(Number(raw?.width)) ? Number(raw.width) : null
});

export const normalizeTokenPostings = (raw) => ({
  vocab: extractArray(raw, 'vocab'),
  postings: extractArray(raw, 'postings'),
  docLengths: extractArray(raw, 'docLengths'),
  avgDocLen: Number.isFinite(Number(raw?.avgDocLen)) ? Number(raw.avgDocLen) : null
});

export const normalizeFieldPostings = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
    return raw;
  }
  return { fields: raw };
};

export const normalizePhrasePostings = (raw) => {
  const vocab = extractArray(raw, 'vocab');
  return {
    vocab: vocab.length ? vocab : extractArray(raw, 'tokens'),
    postings: extractArray(raw, 'postings')
  };
};

export const normalizeFilterIndex = (raw) => raw && typeof raw === 'object' ? raw : null;
