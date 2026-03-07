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

const normalizeLine = (value) => String(value || '')
  .replace(/^\s*[-*]\s+/, '')
  .replace(/\s+/g, ' ')
  .trim();

const stripCodeFenceMarkers = (detail) => String(detail || '')
  .split(/\r?\n/)
  .map((line) => String(line || ''))
  .filter((line) => !/^\s*```/.test(line));

const parenDelta = (value) => {
  let open = 0;
  for (const ch of String(value || '')) {
    if (ch === '(') open += 1;
    else if (ch === ')') open -= 1;
  }
  return open;
};

const cleanSignatureCandidate = (value) => normalizeLine(value)
  .replace(/^\((?:function|method|class|property|variable|module)\)\s*/i, '')
  .replace(/^\s*@\w+\s+/, '')
  .replace(/:\s*$/, '');

const collectSignatureCandidates = (detail) => {
  const lines = stripCodeFenceMarkers(detail)
    .map((line) => normalizeLine(line))
    .filter(Boolean);
  if (!lines.length) return [];

  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    const normalized = cleanSignatureCandidate(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('(')) continue;
    push(line);
    let combined = line;
    let depth = parenDelta(line);
    let j = i + 1;
    while (depth > 0 && j < lines.length) {
      combined = `${combined} ${lines[j]}`;
      depth += parenDelta(lines[j]);
      j += 1;
    }
    if (combined !== line) push(combined);
  }

  push(lines.join(' '));
  return candidates;
};

const selectSignatureCandidate = (detail) => {
  const candidates = collectSignatureCandidates(detail);
  if (!candidates.length) return '';
  const byPattern = (pattern) => candidates.find((entry) => pattern.test(entry));
  return byPattern(/^(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)/)
    || byPattern(/^[A-Za-z_][A-Za-z0-9_.]*\s*\([^)]*\)\s*(?:->|:|$)/)
    || byPattern(/\([^)]*\)\s*->\s*/)
    || candidates[0];
};

export const parsePythonSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const candidate = selectSignatureCandidate(detail);
  if (!candidate) return null;
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
    returnType = tail
      .replace(/:\s*\.\.\.\s*$/, '')
      .replace(/\s+\.\.\.\s*$/, '')
      .replace(/:\s*$/, '')
      .trim() || null;
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
