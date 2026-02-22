#!/usr/bin/env node
import { preflightNativeTreeSitterGrammars } from '../../../src/lang/tree-sitter/native-runtime.js';

export const getUnavailableNativeGrammars = (languageIds = []) => {
  const preflight = preflightNativeTreeSitterGrammars(languageIds);
  const unavailable = Array.from(new Set([
    ...(Array.isArray(preflight.missing) ? preflight.missing : []),
    ...(Array.isArray(preflight.unavailable) ? preflight.unavailable : [])
  ])).sort();
  return { preflight, unavailable };
};

export const skipIfNativeGrammarsUnavailable = (languageIds, label) => {
  const { unavailable } = getUnavailableNativeGrammars(languageIds);
  if (!unavailable.length) return false;
  console.log(`${label}: native tree-sitter grammars unavailable (${unavailable.join(', ')}); skipping.`);
  return true;
};
