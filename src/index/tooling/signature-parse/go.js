import { splitTopLevel } from './shared.js';

const GO_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const splitParams = (value) => splitTopLevel(value, ',');

const normalizeType = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const parseGoParamPart = (part) => {
  const cleaned = normalizeType(part);
  if (!cleaned) return [];
  const match = /^(?<names>[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s+(?<type>.+)$/.exec(cleaned);
  if (!match?.groups) return [];
  const names = String(match.groups.names || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => GO_IDENT.test(entry));
  const type = normalizeType(match.groups.type);
  if (!names.length || !type) return [];
  return names.map((name) => ({ name, type }));
};

const findMatchingParen = (text, startIndex) => {
  if (!text || text[startIndex] !== '(') return -1;
  let depth = 0;
  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/**
 * Parse Go signature details from gopls-like symbol strings.
 *
 * Supported examples:
 * 1. `func Add(a int, b int) int`
 * 2. `func (s *Server) Run(ctx context.Context) error`
 * 3. `func Map[T any](in []T, fn func(T) T) []T`
 *
 * @param {string} detail
 * @returns {{signature:string,returnType:string|null,paramTypes:object,paramNames:string[]}|null}
 */
export const parseGoSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const signature = detail.trim();
  if (!signature.startsWith('func')) return null;
  let cursor = 4;
  while (cursor < signature.length && /\s/u.test(signature[cursor])) cursor += 1;

  // Method receiver: func (r *Receiver) Name(...)
  if (signature[cursor] === '(') {
    const receiverEnd = findMatchingParen(signature, cursor);
    if (receiverEnd === -1) return null;
    cursor = receiverEnd + 1;
    while (cursor < signature.length && /\s/u.test(signature[cursor])) cursor += 1;
  }

  // Optional function name.
  const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(signature.slice(cursor));
  if (nameMatch?.[0]) {
    cursor += nameMatch[0].length;
    // Optional generic signature: Name[T any]
    if (signature[cursor] === '[') {
      let depth = 0;
      let i = cursor;
      for (; i < signature.length; i += 1) {
        const char = signature[i];
        if (char === '[') depth += 1;
        else if (char === ']') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) return null;
      cursor = i + 1;
    }
    while (cursor < signature.length && /\s/u.test(signature[cursor])) cursor += 1;
  }

  if (signature[cursor] !== '(') return null;
  const paramsStart = cursor;
  const paramsEnd = findMatchingParen(signature, paramsStart);
  if (paramsEnd === -1) return null;
  const paramsText = signature.slice(paramsStart + 1, paramsEnd).trim();
  const returnsText = normalizeType(signature.slice(paramsEnd + 1));
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const entries = parseGoParamPart(part);
    for (const entry of entries) {
      paramNames.push(entry.name);
      paramTypes[entry.name] = entry.type;
    }
  }
  const returnType = returnsText || null;
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};
