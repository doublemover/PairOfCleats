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

const stripDefaultValue = (value) => {
  const idx = findTopLevelIndex(value, '=');
  return idx === -1 ? value : value.slice(0, idx);
};

const normalizeSwiftType = (value) => {
  if (!value || typeof value !== 'string') return value;
  return value.replace(/\bSwift\./g, '');
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
  if (!/[A-Za-z_]/.test(right)) return null;
  const tokens = left.split(/\s+/).filter(Boolean);
  let name = tokens.length ? tokens[tokens.length - 1] : null;
  if (name === '_' && tokens.length > 1) {
    name = tokens[tokens.length - 2] || null;
  }
  if (!name || name === '_') return null;
  return { name, type: normalizeSwiftType(right) };
};

export const parseSwiftSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const candidate = detail.split('\n').find((line) => line.includes('(') && line.includes(')')) || detail;
  const open = candidate.indexOf('(');
  const close = candidate.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const signature = candidate.trim();
  const paramsText = candidate.slice(open + 1, close).trim();
  const after = candidate.slice(close + 1).trim();
  const arrowIndex = after.lastIndexOf('->');
  let returnType = null;
  if (arrowIndex !== -1) {
    returnType = normalizeSwiftType(after.slice(arrowIndex + 2).trim());
  }

  const paramTypes = {};
  const paramNames = [];
  for (const part of splitSwiftParams(paramsText)) {
    const parsed = parseSwiftParam(part);
    if (!parsed) continue;
    paramNames.push(parsed.name);
    paramTypes[parsed.name] = parsed.type;
  }

  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};

export { splitSwiftParams };
