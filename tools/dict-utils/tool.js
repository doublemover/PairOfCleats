import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(__dirname, '..', '..');
let toolVersionCache = null;

/**
 * Resolve the installation root for PairOfCleats tooling.
 * @returns {string}
 */
export function resolveToolRoot() {
  return TOOL_ROOT;
}

/**
 * Resolve the current tool version from package.json.
 * @returns {string|null}
 */
export function getToolVersion() {
  if (toolVersionCache !== null) return toolVersionCache;
  try {
    const pkgPath = path.join(TOOL_ROOT, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    toolVersionCache = typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    toolVersionCache = null;
  }
  return toolVersionCache;
}
