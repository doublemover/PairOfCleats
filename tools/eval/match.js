const MATCH_MODES = new Set(['substring', 'exact']);

export function resolveMatchMode(raw) {
  if (raw == null) return 'substring';
  const mode = String(raw).trim();
  if (!MATCH_MODES.has(mode)) {
    throw new Error(`Invalid match mode "${mode}". Use exact|substring.`);
  }
  return mode;
}

export function matchExpected(hit, expected, matchMode) {
  if (!hit) return false;
  if (expected.file && hit.file !== expected.file) return false;
  if (expected.name) {
    const hitName = hit.name ? String(hit.name).toLowerCase() : '';
    const expectedName = String(expected.name).toLowerCase();
    if (matchMode === 'exact') {
      if (hitName !== expectedName) return false;
    } else {
      if (!hitName.includes(expectedName)) return false;
    }
  }
  if (expected.kind) {
    if (!hit.kind || String(hit.kind).toLowerCase() !== String(expected.kind).toLowerCase()) {
      return false;
    }
  }
  return true;
}
