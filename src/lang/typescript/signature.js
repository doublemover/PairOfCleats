import { TS_MODIFIERS } from './constants.js';

export function extractTypeScriptModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (TS_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

export function extractTypeScriptParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=.+$/g, '').trim();
    seg = seg.replace(/:[^,]+/g, '').trim();
    seg = seg.replace(/\b(public|private|protected|readonly|override)\b/g, '').trim();
    seg = seg.replace(/\?/g, '').trim();
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    let name = tokens[tokens.length - 1];
    name = name.replace(/[^A-Za-z0-9_$]/g, '');
    if (!name || !/^[A-Za-z_$]/.test(name)) continue;
    params.push(name);
  }
  return params;
}

export function extractTypeScriptParamTypes(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return {};
  const paramTypes = {};
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=.+$/g, '').trim();
    seg = seg.replace(/\b(public|private|protected|readonly|override)\b/g, '').trim();
    seg = seg.replace(/^\.\.\./, '').trim();
    const [rawName, ...rest] = seg.split(':');
    if (!rawName || !rest.length) continue;
    const name = rawName.replace(/\?/g, '').replace(/[^A-Za-z0-9_$]/g, '').trim();
    const type = rest.join(':').trim();
    if (!name || !type) continue;
    paramTypes[name] = type;
  }
  return paramTypes;
}

export function extractTypeScriptReturns(signature) {
  const idx = signature.indexOf(')');
  if (idx === -1) return null;
  const after = signature.slice(idx + 1);
  const match = after.match(/:\s*([^=;{]+)/);
  if (!match) return null;
  const ret = match[1].trim();
  return ret || null;
}

export function parseTypeScriptSignature(signature) {
  const idx = signature.indexOf('(');
  if (idx === -1) return { name: '', returns: null };
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const match = before.match(/([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (!match) return { name: '', returns: null };
  const name = match[1];
  const returns = extractTypeScriptReturns(signature);
  return { name, returns };
}

export function readSignatureLines(lines, startLine) {
  const parts = [];
  let hasBrace = false;
  let hasSemi = false;
  let endLine = startLine;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    parts.push(line.trim());
    if (line.includes('{')) {
      hasBrace = true;
      endLine = i;
      break;
    }
    if (line.includes(';')) {
      hasSemi = true;
      endLine = i;
      break;
    }
    endLine = i;
  }
  const signature = parts.join(' ');
  const braceIdx = signature.indexOf('{');
  const semiIdx = signature.indexOf(';');
  const hasBody = hasBrace && (semiIdx === -1 || (braceIdx !== -1 && braceIdx < semiIdx));
  return { signature, endLine, hasBody };
}

export function extractTypeScriptInheritance(signature) {
  const extendsList = [];
  const implementsList = [];
  const extendsMatch = signature.match(/\bextends\s+([^\{]+)/);
  if (extendsMatch) {
    const raw = extendsMatch[1].split(/\bimplements\b/)[0];
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => extendsList.push(s));
  }
  const implMatch = signature.match(/\bimplements\s+([^\{]+)/);
  if (implMatch) {
    implMatch[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => implementsList.push(s));
  }
  return { extendsList, implementsList };
}

export function extractVisibility(modifiers) {
  if (modifiers.includes('private')) return 'private';
  if (modifiers.includes('protected')) return 'protected';
  return 'public';
}

export function mergeParamTypes(base, extra) {
  const out = { ...(base || {}) };
  for (const [name, value] of Object.entries(extra || {})) {
    if (!name || !value) continue;
    if (!out[name]) {
      out[name] = value;
      continue;
    }
    if (out[name] === value) continue;
    out[name] = Array.from(new Set([out[name], value])).join(' | ');
  }
  return out;
}
