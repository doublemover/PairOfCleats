import { splitTopLevel, findTopLevelIndex } from './shared.js';
import { setOwn } from '../../../shared/object-record.js';

const RUST_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const normalizeType = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const RUST_NESTING = Object.freeze({ rustLifetimes: true });
const splitParams = (value) => splitTopLevel(value, ',', RUST_NESTING);

const parseRustParam = (part) => {
  const cleaned = normalizeType(part);
  if (!cleaned) return null;
  if (cleaned === 'self' || cleaned === '&self' || cleaned === '&mut self' || cleaned === 'mut self') return null;
  const match = /^(?:mut\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?<type>.+)$/.exec(cleaned);
  if (!match?.groups) return null;
  const name = String(match.groups.name || '').trim();
  const type = normalizeType(match.groups.type);
  if (!RUST_IDENT.test(name) || !type) return null;
  return { name, type };
};

/**
 * Parse Rust signature details from rust-analyzer-like symbol strings.
 *
 * Supported examples:
 * 1. `fn add(a: i32, b: i32) -> i32`
 * 2. `pub fn map<T>(input: Vec<T>, f: impl Fn(T) -> T) -> Vec<T>`
 * 3. `fn run(&self, ctx: Context<'_>)`
 *
 * @param {string} detail
 * @returns {{signature:string,returnType:string|null,paramTypes:object,paramNames:string[]}|null}
 */
export const parseRustSignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const signature = detail.trim();
  const header = /\bfn\b(?:\s+(?:r#)?[A-Za-z_][A-Za-z0-9_]*)?\s*/u.exec(signature);
  if (!header) return null;
  let tail = signature.slice(header.index + header[0].length);
  if (tail.startsWith('<')) {
    const genericEnd = findTopLevelIndex(tail, '>', RUST_NESTING);
    if (genericEnd < 0) return null;
    tail = tail.slice(genericEnd + 1).trimStart();
  }
  if (!tail.startsWith('(')) return null;
  const close = findTopLevelIndex(tail, ')', RUST_NESTING);
  if (close < 0) return null;
  const paramsText = tail.slice(1, close);
  const suffix = tail.slice(close + 1).trim();
  const returnsRaw = normalizeType(suffix.startsWith('->') ? suffix.slice(2) : '');
  const returnType = returnsRaw
    ? normalizeType(returnsRaw.replace(/\s+where\s+[\s\S]*$/u, ''))
    : null;
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const parsed = parseRustParam(part);
    if (!parsed) continue;
    paramNames.push(parsed.name);
    setOwn(paramTypes,parsed.name,parsed.type);
  }
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};
