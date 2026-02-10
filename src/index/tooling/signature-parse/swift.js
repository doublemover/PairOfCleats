const splitSwiftParams = (value) => {
  if (!value) return [];
  const params = [];
  let current = '';
  let depthAngle = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  for (const ch of value) {
    if (ch === '<') depthAngle += 1;
    if (ch === '>' && depthAngle > 0) depthAngle -= 1;
    if (ch === '(') depthParen += 1;
    if (ch === ')' && depthParen > 0) depthParen -= 1;
    if (ch === '[') depthBracket += 1;
    if (ch === ']' && depthBracket > 0) depthBracket -= 1;
    if (ch === '{') depthBrace += 1;
    if (ch === '}' && depthBrace > 0) depthBrace -= 1;
    if (ch === ',' && depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      if (current.trim()) params.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(current.trim());
  return params;
};

const findTopLevelIndex = (value, targetChar) => {
  let depthAngle = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '<') depthAngle += 1;
    if (ch === '>' && depthAngle > 0) depthAngle -= 1;
    if (ch === '(') depthParen += 1;
    if (ch === ')' && depthParen > 0) depthParen -= 1;
    if (ch === '[') depthBracket += 1;
    if (ch === ']' && depthBracket > 0) depthBracket -= 1;
    if (ch === '{') depthBrace += 1;
    if (ch === '}' && depthBrace > 0) depthBrace -= 1;
    if (ch === targetChar && depthAngle === 0 && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      return i;
    }
  }
  return -1;
};

const findMatchingParen = (value, startIndex) => {
  if (!value || startIndex < 0) return -1;
  let depthParen = 0;
  for (let i = startIndex; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depthParen += 1;
    if (ch === ')') {
      depthParen -= 1;
      if (depthParen === 0) return i;
    }
  }
  return -1;
};

const stripDefaultValue = (value) => {
  const idx = findTopLevelIndex(value, '=');
  return idx === -1 ? value : value.slice(0, idx);
};

const normalizeSwiftType = (value) => {
  if (!value || typeof value !== 'string') return null;
  const normalized = value
    .replace(/\bSwift\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
};

const normalizeParamType = (value) => {
  if (!value || typeof value !== 'string') return null;
  const withoutAttrs = value
    .replace(/@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?/g, ' ')
    .replace(/\b(?:inout|borrowing|consuming|isolated|sending|escaping|autoclosure)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeSwiftType(withoutAttrs);
};

const normalizeSignatureLine = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const selectSignatureLine = (detail) => {
  const lines = String(detail || '')
    .split('\n')
    .map((line) => normalizeSignatureLine(line))
    .filter(Boolean);
  if (!lines.length) return '';
  const withParens = lines.filter((line) => line.includes('(') && line.includes(')'));
  if (!withParens.length) {
    return lines.find((line) => /\b(?:var|let)\b/.test(line) && line.includes(':')) || lines[0];
  }
  return withParens.find((line) => /\b(?:func|init|subscript)\b/.test(line) && line.includes('->'))
    || withParens.find((line) => line.includes('->'))
    || withParens.find((line) => /\b(?:func|init|subscript)\b/.test(line))
    || withParens[0];
};

const cleanReturnType = (value) => {
  if (!value || typeof value !== 'string') return null;
  let output = value.trim();
  if (!output) return null;
  output = output
    .replace(/\s+where\s+.+$/, '')
    .replace(/\{.*$/, '')
    .replace(/\b(?:get|set|willSet|didSet)\b.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!output) return null;
  if (output === '()') return 'Void';
  return normalizeSwiftType(output);
};

const parseVariableReturnType = (signature) => {
  if (!signature || !/\b(?:var|let)\b/.test(signature)) return null;
  const colonIdx = findTopLevelIndex(signature, ':');
  if (colonIdx === -1) return null;
  const raw = signature.slice(colonIdx + 1);
  return cleanReturnType(raw);
};

const parseSwiftParam = (value) => {
  const cleaned = stripDefaultValue(value).trim();
  if (!cleaned) return null;
  const colonIdx = findTopLevelIndex(cleaned, ':');
  if (colonIdx === -1) return null;

  const left = cleaned.slice(0, colonIdx).trim();
  const right = cleaned.slice(colonIdx + 1).trim();
  if (!left || !right) return null;
  if (right.endsWith(':')) return null;

  const normalizedRight = normalizeParamType(right);
  if (!normalizedRight || !/[A-Za-z_]/.test(normalizedRight)) return null;

  const leftTokens = left
    .replace(/@[A-Za-z_][A-Za-z0-9_]*(?:\([^)]*\))?/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let name = null;
  for (let i = leftTokens.length - 1; i >= 0; i -= 1) {
    const token = leftTokens[i];
    if (token === '_') continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
      name = token;
      break;
    }
  }
  if (!name) return null;

  return { name, type: normalizedRight };
};

const parseFunctionReturnType = (signature, closeParenIndex) => {
  const after = signature.slice(closeParenIndex + 1).trim();
  const afterArrow = after.lastIndexOf('->');
  if (afterArrow !== -1) {
    return cleanReturnType(after.slice(afterArrow + 2));
  }
  const fullArrow = signature.lastIndexOf('->');
  if (fullArrow !== -1) {
    return cleanReturnType(signature.slice(fullArrow + 2));
  }
  if (/\binit[?!]?\s*\(/.test(signature)) {
    return 'Self';
  }
  return 'Void';
};

export const parseSwiftSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;

  const signature = normalizeSignatureLine(selectSignatureLine(detail));
  if (!signature) return null;

  const open = signature.indexOf('(');
  const close = findMatchingParen(signature, open);

  if (open === -1 || close === -1 || close < open) {
    const returnType = parseVariableReturnType(signature);
    if (!returnType) return null;
    return {
      signature,
      returnType,
      paramTypes: {},
      paramNames: []
    };
  }

  const paramsText = signature.slice(open + 1, close).trim();
  const returnType = parseFunctionReturnType(signature, close);

  const paramTypes = {};
  const paramNames = [];
  for (const part of splitSwiftParams(paramsText)) {
    const parsed = parseSwiftParam(part);
    if (!parsed) continue;
    paramNames.push(parsed.name);
    paramTypes[parsed.name] = parsed.type;
  }

  if (!returnType && !paramNames.length) return null;
  return {
    signature,
    returnType,
    paramTypes,
    paramNames
  };
};

export { splitSwiftParams };
