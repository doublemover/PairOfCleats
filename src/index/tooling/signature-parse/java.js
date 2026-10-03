import { parseClikeSignature } from './clike.js';

const JAVA_MODIFIERS = /\b(public|protected|private|abstract|default|final|synchronized|native|strictfp|static)\b/gu;
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** JDT symbol names include their owner and parameter types, unlike C/C++ hints. */
export const parseJavaSignature = (detail, symbolName) => {
  if (typeof detail !== 'string') return null;
  const method = String(symbolName || '').split('(')[0].split('.').at(-1)?.trim();
  if (!method || !/^[A-Za-z_$][\w$]*$/u.test(method)) return parseClikeSignature(detail, symbolName);
  const signature = detail.replace(JAVA_MODIFIERS, '').replace(/\s+/gu, ' ').trim();
  const open = signature.indexOf('(');
  if (open < 0) return null;
  const before = signature.slice(0, open).trim().replace(
    new RegExp(`(?:[A-Za-z_$][\\w$]*\\.)*${escapePattern(method)}$`, 'u'), method
  );
  const parsed = parseClikeSignature(before + signature.slice(open), method);
  if (parsed && before === method) parsed.returnType = null;
  return parsed;
};
