import { TS_MODIFIERS } from './constants.js';

export function extractTypeScriptModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (TS_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractParamSection(signature) {
  const start = signature.indexOf('(');
  if (start === -1) return null;
  let depth = 0;
  let paramStart = -1;
  let inString = null;
  let escaped = false;
  for (let i = start; i < signature.length; i += 1) {
    const ch = signature[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') {
      if (depth === 0) paramStart = i + 1;
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0 && paramStart >= 0) {
        return { text: signature.slice(paramStart, i), endIndex: i };
      }
      continue;
    }
  }
  return null;
}

function splitTopLevel(text, delimiter) {
  const parts = [];
  let buf = '';
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let depthAngle = 0;
  let inString = null;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      buf += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depthParen += 1;
    if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    if (ch === '[') depthBracket += 1;
    if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    if (ch === '{') depthBrace += 1;
    if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    if (ch === '<') depthAngle += 1;
    if (ch === '>' && depthAngle > 0) depthAngle -= 1;
    if (ch === delimiter && !depthParen && !depthBracket && !depthBrace && !depthAngle) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length) parts.push(buf);
  return parts;
}

function splitTopLevelOnce(text, delimiter) {
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let depthAngle = 0;
  let inString = null;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') depthParen += 1;
    if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    if (ch === '[') depthBracket += 1;
    if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
    if (ch === '{') depthBrace += 1;
    if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    if (ch === '<') depthAngle += 1;
    if (ch === '>' && depthAngle > 0) depthAngle -= 1;
    if (ch === delimiter && !depthParen && !depthBracket && !depthBrace && !depthAngle) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
  }
  return [text, null];
}

function stripModifiers(segment) {
  return segment.replace(/\b(public|private|protected|readonly|override)\b/g, '').trim();
}

function stripDefaultValue(segment) {
  const [before] = splitTopLevelOnce(segment, '=');
  return (before || '').trim();
}

export function extractTypeScriptParams(signature) {
  const section = extractParamSection(signature);
  if (!section) return [];
  const params = [];
  for (const part of splitTopLevel(section.text, ',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = stripDefaultValue(seg);
    seg = stripModifiers(seg);
    seg = seg.replace(/^\.\.\./, '').trim();
    const [rawName] = splitTopLevelOnce(seg, ':');
    if (!rawName) continue;
    const nameSeg = rawName.replace(/\?/g, '').trim();
    const tokens = nameSeg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    let name = tokens[tokens.length - 1];
    name = name.replace(/[^A-Za-z0-9_$]/g, '');
    if (!name || !/^[A-Za-z_$]/.test(name)) continue;
    params.push(name);
  }
  return params;
}

export function extractTypeScriptParamTypes(signature) {
  const section = extractParamSection(signature);
  if (!section) return {};
  const paramTypes = {};
  for (const part of splitTopLevel(section.text, ',')) {
    let seg = part.trim();
    if (!seg) continue;
    seg = stripDefaultValue(seg);
    seg = stripModifiers(seg);
    seg = seg.replace(/^\.\.\./, '').trim();
    const [rawName, rawType] = splitTopLevelOnce(seg, ':');
    if (!rawName || !rawType) continue;
    const name = rawName.replace(/\?/g, '').replace(/[^A-Za-z0-9_$]/g, '').trim();
    const type = rawType.trim();
    if (!name || !type) continue;
    paramTypes[name] = type;
  }
  return paramTypes;
}

export function extractTypeScriptReturns(signature) {
  const section = extractParamSection(signature);
  if (!section) return null;
  const after = signature.slice(section.endIndex + 1);
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
