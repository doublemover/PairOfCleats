const splitPythonParams = (value) => {
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

const parsePythonParam = (value) => {
  let cleaned = stripDefaultValue(value).trim();
  if (!cleaned || cleaned === '/' || cleaned === '*') return null;
  if (cleaned.startsWith('**')) cleaned = cleaned.slice(2).trim();
  else if (cleaned.startsWith('*')) cleaned = cleaned.slice(1).trim();
  if (!cleaned) return null;
  const colonIdx = findTopLevelIndex(cleaned, ':');
  const name = (colonIdx === -1 ? cleaned : cleaned.slice(0, colonIdx)).trim();
  const type = colonIdx === -1 ? null : cleaned.slice(colonIdx + 1).trim();
  if (!name) return null;
  return { name, type };
};

const normalizePythonType = (value) => {
  if (!value) return value;
  return value.replace(/\b(?:builtins|typing)\./g, '');
};

export const parsePythonSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const candidate = detail.split('\n').find((line) => line.includes('(') && line.includes(')')) || detail;
  const signature = candidate.trim().replace(/:\s*$/, '');
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const paramsText = signature.slice(open + 1, close).trim();
  const after = signature.slice(close + 1).trim();

  let returnType = null;
  const arrowIdx = after.indexOf('->');
  if (arrowIdx !== -1) {
    const tail = after.slice(arrowIdx + 2).trim();
    returnType = tail.replace(/:\s*$/, '').trim() || null;
    returnType = normalizePythonType(returnType);
  }

  const paramTypes = {};
  const paramNames = [];
  for (const part of splitPythonParams(paramsText)) {
    const parsed = parsePythonParam(part);
    if (!parsed) continue;
    paramNames.push(parsed.name);
    if (parsed.type) paramTypes[parsed.name] = normalizePythonType(parsed.type);
  }

  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};

export { splitPythonParams };
