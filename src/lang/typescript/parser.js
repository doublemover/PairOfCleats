import { createRequire } from 'node:module';
import path from 'node:path';
import {
  TS_PARSERS,
  TSX_CLOSE_TAG,
  TSX_FRAGMENT_CLOSE,
  TSX_FRAGMENT_OPEN,
  TSX_SELF_CLOSING
} from './constants.js';

const nodeRequire = createRequire(import.meta.url);
const typeScriptCache = new Map();

export function resolveTypeScriptParser(options = {}) {
  const raw = options.parser || options.typescript?.parser || options.typescriptParser;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return TS_PARSERS.has(normalized) ? normalized : 'auto';
}

export function loadTypeScriptModule(rootDir) {
  const key = rootDir || '__default__';
  if (typeScriptCache.has(key)) return typeScriptCache.get(key);
  let resolved = null;
  if (rootDir) {
    try {
      const requireFromRoot = createRequire(path.join(rootDir, 'package.json'));
      const mod = requireFromRoot('typescript');
      resolved = mod?.default || mod;
    } catch {
      resolved = null;
    }
  }
  if (!resolved) {
    try {
      const mod = nodeRequire('typescript');
      resolved = mod?.default || mod;
    } catch {
      resolved = null;
    }
  }
  typeScriptCache.set(key, resolved);
  return resolved;
}

export function isLikelyTsx(text, ext) {
  const normalized = ext ? ext.toLowerCase() : '';
  if (normalized === '.tsx') return true;
  if (normalized && normalized !== '.tsx') return false;
  if (TSX_CLOSE_TAG.test(text)) return true;
  if (TSX_SELF_CLOSING.test(text)) return true;
  return TSX_FRAGMENT_OPEN.test(text) || TSX_FRAGMENT_CLOSE.test(text);
}

export function resolveTypeScriptFilename(ext, isTsx) {
  if (ext) return `module${ext}`;
  return isTsx ? 'module.tsx' : 'module.ts';
}

export function stripTypeScriptComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}
