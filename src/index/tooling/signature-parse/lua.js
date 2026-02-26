import { splitTopLevel } from './shared.js';

const LUA_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const normalizeType = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const splitParams = (value) => splitTopLevel(value, ',');

const stripLuaNamePrefix = (value) => (
  String(value || '')
    .replace(/^local\s+/u, '')
    .replace(/^(?:function|fun)\s+/u, '')
    .trim()
);

const parseLuaParam = (part) => {
  const cleaned = normalizeType(part);
  if (!cleaned || cleaned === '...') return null;
  const match = /^(?<name>[A-Za-z_][A-Za-z0-9_]*\??)\s*:\s*(?<type>.+)$/u.exec(cleaned);
  if (!match?.groups) return null;
  const rawName = String(match.groups.name || '').trim();
  const type = normalizeType(match.groups.type);
  const name = rawName.endsWith('?') ? rawName.slice(0, -1) : rawName;
  if (!LUA_IDENT.test(name) || !type) return null;
  return { name, type };
};

/**
 * Parse Lua signature details from lua-language-server style strings.
 *
 * Supported examples:
 * 1. `function greet(name: string): string`
 * 2. `local function module.run(path: string, opts: table): boolean`
 * 3. `fun(name: string): string`
 *
 * @param {string} detail
 * @returns {{signature:string,returnType:string|null,paramTypes:object,paramNames:string[]}|null}
 */
export const parseLuaSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const signature = detail.trim();
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const before = stripLuaNamePrefix(signature.slice(0, open));
  if (!before) return null;
  const paramsText = signature.slice(open + 1, close);
  const returnMatch = /^\s*:\s*([\s\S]+)$/u.exec(signature.slice(close + 1));
  const returnType = returnMatch ? normalizeType(returnMatch[1]) : null;
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const parsed = parseLuaParam(part);
    if (!parsed) continue;
    paramNames.push(parsed.name);
    paramTypes[parsed.name] = parsed.type;
  }
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};
