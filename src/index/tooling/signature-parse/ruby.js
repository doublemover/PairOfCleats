import { findTopLevelIndex, splitTopLevel, stripTopLevelAssignment } from './shared.js';

const RUBY_PARAM = /^[*&]*([A-Za-z_][A-Za-z0-9_]*)[!?=]?$/u;

const normalizeType = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const parseRubyParam = (part) => {
  const cleaned = normalizeType(part);
  if (!cleaned) return null;
  const noDefault = normalizeType(stripTopLevelAssignment(cleaned));
  if (!noDefault) return null;
  const colonIdx = findTopLevelIndex(noDefault, ':');
  if (colonIdx !== -1) {
    const left = normalizeType(noDefault.slice(0, colonIdx));
    const right = normalizeType(noDefault.slice(colonIdx + 1));
    const typedMatch = RUBY_PARAM.exec(left);
    if (!typedMatch?.[1]) return null;
    return {
      name: typedMatch[1],
      type: right || null
    };
  }
  const nameMatch = RUBY_PARAM.exec(noDefault);
  if (!nameMatch?.[1]) return null;
  return {
    name: nameMatch[1],
    type: null
  };
};

/**
 * Parse Ruby signatures from Solargraph-like details.
 *
 * Supported examples:
 * 1. `greet(name, title = nil) -> String`
 * 2. `User#greet(name : String) -> String`
 * 3. `self.build(attrs: Hash) => User`
 *
 * @param {string} detail
 * @returns {{signature:string,returnType:string|null,paramTypes:object,paramNames:string[]}|null}
 */
export const parseRubySignature = (detail) => {
  if (!detail || typeof detail !== 'string') return null;
  const signature = detail.trim();
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  const paramsText = signature.slice(open + 1, close);
  const returnSuffix = normalizeType(signature.slice(close + 1));
  const returnMatch = /^(?:->|=>)\s*(.+)$/u.exec(returnSuffix);
  const returnType = returnMatch ? normalizeType(returnMatch[1]) : null;
  const paramTypes = {};
  const paramNames = [];
  for (const part of splitTopLevel(paramsText, ',')) {
    const parsed = parseRubyParam(part);
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
