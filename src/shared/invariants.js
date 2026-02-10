import { createOrderingHasher } from './order.js';

export const compareWithAntisymmetryInvariant = (compare, left, right) => {
  if (typeof compare !== 'function') {
    throw new TypeError('compareWithAntisymmetryInvariant requires a compare function');
  }
  const result = compare(left, right);
  const reverse = compare(right, left);
  if (result === 0 && reverse !== 0) {
    throw new Error('Comparator is not antisymmetric (0 vs non-zero)');
  }
  if (result !== 0 && reverse !== 0 && Math.sign(result) !== -Math.sign(reverse)) {
    throw new Error('Comparator is not antisymmetric');
  }
  return result;
};

export const registerTokenIdInvariant = ({
  tokenIdMap,
  tokenIdCollisions,
  id,
  token
} = {}) => {
  if (!(tokenIdMap instanceof Map)) {
    return { collision: false, added: false, existing: null };
  }
  if (!id || token == null) {
    return { collision: false, added: false, existing: null };
  }
  const existing = tokenIdMap.get(id);
  if (existing === undefined) {
    tokenIdMap.set(id, token);
    return { collision: false, added: true, existing: null };
  }
  if (existing !== token) {
    if (Array.isArray(tokenIdCollisions)) {
      tokenIdCollisions.push({ id, existing, token });
    }
    return { collision: true, added: false, existing };
  }
  return { collision: false, added: false, existing };
};

export const hashDeterministicLines = (lines, { encodeLine = (value) => String(value ?? '') } = {}) => {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const hasher = createOrderingHasher();
  for (const line of lines) {
    hasher.update(encodeLine(line));
  }
  return hasher.digest();
};

export const hashDeterministicJsonRows = (rows, { serialize = JSON.stringify } = {}) =>
  hashDeterministicLines(rows, {
    encodeLine: (row) => serialize(row)
  });

export const hashDeterministicValues = (values) =>
  hashDeterministicLines(values, {
    encodeLine: (value) => value
  });
