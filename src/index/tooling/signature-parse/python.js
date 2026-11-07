import { findTopLevelIndex, splitTopLevel, stripTopLevelAssignment } from './shared.js';
import { setOwn } from '../../../shared/object-record.js';
import { normalizeTypeWhitespace, transformTypeTextOutsideLiterals } from '../../../shared/type-normalization.js';

const PYTHON_NESTING = Object.freeze({ angleBrackets: false });
const splitPythonParams = (value) => splitTopLevel(value, ',', PYTHON_NESTING);

const stripDefaultValue = (value) => stripTopLevelAssignment(value, PYTHON_NESTING);

const parsePythonParam = (value) => {
  let cleaned = stripDefaultValue(value).trim();
  if (!cleaned || cleaned === '/' || cleaned === '*') return null;
  if (cleaned.startsWith('**')) cleaned = cleaned.slice(2).trim();
  else if (cleaned.startsWith('*')) cleaned = cleaned.slice(1).trim();
  if (!cleaned) return null;
  const colonIdx = findTopLevelIndex(cleaned, ':', PYTHON_NESTING);
  const name = (colonIdx === -1 ? cleaned : cleaned.slice(0, colonIdx)).trim();
  const type = colonIdx === -1 ? null : cleaned.slice(colonIdx + 1).trim();
  if (!name) return null;
  return { name, type };
};

const normalizePythonType = (value) => {
  if (!value) return value;
  return transformTypeTextOutsideLiterals(value, text => text.replace(
    /(?<![\p{ID_Continue}.])[\p{ID_Start}_][\p{ID_Continue}]*(?:\s*\.\s*[\p{ID_Start}_][\p{ID_Continue}]*)+/gu,
    name => {
      const parts=name.split(/\s*\.\s*/u);
      if (['builtins','typing','typing_extensions'].includes(parts[0])) return parts.slice(1).join('.');
      if (parts.length>2 && parts[0]==='collections' && parts[1]==='abc') return parts.slice(2).join('.');
      return name;
    }
  ));
};

const normalizeLine = (value) => normalizeTypeWhitespace(String(value || '')
  .replace(/^\s*(?:>\s*)+/, '')
  .replace(/^\s*[-*]\s+/, '')
  .replace(/^`+/, '')
  .replace(/`+$/, '')
  .trim());

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
  .replace(/^(?:@\w+(?:\([^)]*\))?\s+)+/i, '')
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
  // The last parenthesis can belong to a return annotation or function body.
  const closingOffset = open < 0 ? -1 : findTopLevelIndex(signature.slice(open), ')', PYTHON_NESTING);
  const close = closingOffset < 0 ? -1 : open + closingOffset;
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
    if (parsed.type) setOwn(paramTypes,parsed.name,normalizePythonType(parsed.type));
  }

  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};

export { splitPythonParams };
