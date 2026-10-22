import { findMatchingParen, splitTopLevel } from './shared.js';
import { setOwn } from '../../../shared/object-record.js';
import { normalizeTypeWhitespace } from '../../../shared/type-normalization.js';

const ZIG_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const normalizeType = (value) => normalizeTypeWhitespace(value);

const splitParams = (value) => splitTopLevel(value, ',');

const parseZigParam = (part) => {
  const cleaned = normalizeType(part);
  if (!cleaned) return null;
  const match = /^(?:comptime\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?<type>.+)$/u.exec(cleaned);
  if (!match?.groups) return null;
  const name = String(match.groups.name || '').trim();
  const type = normalizeType(match.groups.type);
  if (!ZIG_IDENT.test(name) || !type) return null;
  return { name, type };
};

/**
 * Parse Zig signature details from zls-like symbol strings.
 *
 * Supported examples:
 * 1. `fn add(a: i32, b: i32) i32`
 * 2. `pub fn run(self: *Self, input: []const u8) !void`
 * 3. `fn map(comptime T: type, values: []const T) []T`
 *
 * @param {string} detail
 * @returns {{signature:string,returnType:string|null,paramTypes:object,paramNames:string[]}|null}
 */
export const parseZigSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const signature = detail.trim();
  const fnIndex = signature.indexOf('fn ');
  if (fnIndex === -1) return null;
  const open = signature.indexOf('(', fnIndex);
  if (open === -1) return null;
  const close = findMatchingParen(signature,open);
  if (close === -1) return null;
  const paramsText = signature.slice(open + 1, close);
  const returnType = normalizeType(signature.slice(close + 1)) || null;
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const parsed = parseZigParam(part);
    if (!parsed) continue;
    paramNames.push(parsed.name);
    setOwn(paramTypes,parsed.name,parsed.type);
  }
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};
