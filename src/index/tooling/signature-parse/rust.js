import { splitTopLevel } from './shared.js';

const RUST_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const normalizeType = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const splitParams = (value) => splitTopLevel(value, ',');

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
  const match = /\bfn\b[\s\S]*?\((?<params>[\s\S]*)\)\s*(?:->\s*(?<returns>[\s\S]*))?$/u.exec(signature);
  if (!match?.groups) return null;
  const paramsText = String(match.groups.params || '');
  const returnsRaw = normalizeType(match.groups.returns || '');
  const returnType = returnsRaw
    ? normalizeType(returnsRaw.replace(/\s+where\s+[\s\S]*$/u, ''))
    : null;
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitParams(paramsText)) {
    const parsed = parseRustParam(part);
    if (!parsed) continue;
    paramNames.push(parsed.name);
    paramTypes[parsed.name] = parsed.type;
  }
  if (!returnType && !paramNames.length) return null;
  return { signature, returnType, paramTypes, paramNames };
};
