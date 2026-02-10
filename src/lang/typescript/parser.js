import {
  TS_PARSERS,
  TSX_CLOSE_TAG,
  TSX_FRAGMENT_CLOSE,
  TSX_FRAGMENT_OPEN,
  TSX_SELF_CLOSING
} from './constants.js';
import { loadTypeScriptModule } from '../../index/tooling/typescript/load.js';

export { loadTypeScriptModule };

export function resolveTypeScriptParser(options = {}) {
  const raw = options.parser || options.typescript?.parser || options.typescriptParser;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return TS_PARSERS.has(normalized) ? normalized : 'auto';
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
