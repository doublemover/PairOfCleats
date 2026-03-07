import { splitTopLevel } from './shared.js';

const ELIXIR_PARAM = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const normalizeType = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const findMatchingParen = (text, startIndex) => {
  if (!text || text[startIndex] !== '(') return -1;
  let depth = 0;
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const stripDefault = (value) => {
  const text = normalizeType(value);
  const idx = text.indexOf('\\');
  return idx === -1 ? text : normalizeType(text.slice(0, idx));
};

const parseElixirParam = (part) => {
  const cleaned = stripDefault(part);
  if (!cleaned) return null;
  const match = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?:\s*::\s*(?<type>.+))?$/u.exec(cleaned);
  if (!match?.groups) return null;
  const name = String(match.groups.name || '').trim();
  if (!ELIXIR_PARAM.test(name)) return null;
  const type = normalizeType(match.groups.type || '');
  return { name, type: type || null };
};

/**
 * Parse Elixir signatures from ElixirLS hover/detail text.
 *
 * Supported examples:
 * 1. `greet(name :: String.t()) :: String.t()`
 * 2. `sum(a :: integer(), b :: integer()) :: integer()`
 * 3. `run(name, opts \\ [])`
 *
 * @param {string} detail
 * @returns {{signature:string,returnType:string|null,paramTypes:object,paramNames:string[]}|null}
 */
export const parseElixirSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const signature = detail.trim();
  const open = signature.indexOf('(');
  if (open === -1) return null;
  const close = findMatchingParen(signature, open);
  if (close === -1) return null;
  const paramsText = signature.slice(open + 1, close);
  const suffix = normalizeType(signature.slice(close + 1));
  const returnMatch = /^::\s*(.+)$/u.exec(suffix);
  const returnType = returnMatch ? normalizeType(returnMatch[1]) : null;
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitTopLevel(paramsText, ',')) {
    const parsed = parseElixirParam(part);
    if (!parsed?.name) continue;
    paramNames.push(parsed.name);
    if (parsed.type) paramTypes[parsed.name] = parsed.type;
  }
  if (!returnType && !paramNames.length) return null;
  return {
    signature,
    returnType,
    paramTypes,
    paramNames
  };
};
