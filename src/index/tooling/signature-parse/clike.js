import { splitTopLevel } from './shared.js';

const splitClikeParams = (value) => splitTopLevel(value, ',');

const stripQualifiers = (value) => value
  .replace(/\b(static|inline|constexpr|virtual|extern|friend|typename)\b/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const inferReturnType = (before, symbolName) => {
  if (!before) return null;
  let candidate = before.trim();
  if (symbolName) {
    const idx = candidate.lastIndexOf(symbolName);
    if (idx > 0) {
      candidate = candidate.slice(0, idx).trim();
    } else {
      const scoped = candidate.lastIndexOf(`::${symbolName}`);
      if (scoped > 0) candidate = candidate.slice(0, scoped).trim();
    }
  }
  if (!candidate) return null;
  if (!symbolName) {
    const match = candidate.match(/^(.*)\b[A-Za-z_][\w]*$/);
    if (match?.[1]) candidate = match[1].trim();
  }
  candidate = stripQualifiers(candidate);
  if (!candidate || candidate.endsWith('::')) return null;
  return candidate;
};

const parseClikeParam = (value) => {
  const cleaned = value.trim();
  if (!cleaned || cleaned === 'void' || cleaned === '...') return null;
  const noDefault = cleaned.split('=').shift().trim();
  const funcPtrMatch = noDefault.match(/\(\s*\*\s*([A-Za-z_][\w]*)\s*\)/);
  if (funcPtrMatch) {
    const name = funcPtrMatch[1];
    const type = noDefault.replace(funcPtrMatch[0], '(*)').trim();
    return name && type ? { name, type } : null;
  }
  const nameMatch = noDefault.match(/([A-Za-z_][\w]*)\s*(?:\[[^\]]*\])?$/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const type = noDefault.slice(0, nameMatch.index).trim();
  if (!name || !type) return null;
  return { name, type };
};

export const parseClikeSignature = (detail, symbolName) => {
  if (!detail || typeof detail !== 'string') return null;
  const open = detail.indexOf('(');
  const close = detail.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const signature = detail.trim();
  const before = detail.slice(0, open).trim();
  const paramsText = detail.slice(open + 1, close).trim();
  const returnType = inferReturnType(before, symbolName);
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitClikeParams(paramsText)) {
    const parsed = parseClikeParam(part);
    if (!parsed) continue;
    paramNames.push(parsed.name);
    paramTypes[parsed.name] = parsed.type;
  }
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};

export { splitClikeParams };
