import { findTopLevelIndex, splitTopLevel, stripTopLevelAssignment } from './shared.js';

const splitPythonParams = (value) => splitTopLevel(value, ',');

const stripDefaultValue = (value) => stripTopLevelAssignment(value);

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
  return value.replace(/\b(?:builtins|typing|typing_extensions|collections\.abc)\./g, '');
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
