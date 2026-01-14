import { createRequire } from 'node:module';

let cachedRe2 = undefined;

const loadRe2 = () => {
  if (cachedRe2 !== undefined) return cachedRe2;
  try {
    const require = createRequire(import.meta.url);
    const mod = require('re2');
    const RE2 = (mod && typeof mod === 'object' && 'default' in mod) ? mod.default : mod;
    cachedRe2 = typeof RE2 === 'function' ? RE2 : null;
  } catch {
    cachedRe2 = null;
  }
  return cachedRe2;
};

export const isRe2Available = () => Boolean(loadRe2());

export const compileRe2 = (source, flags) => {
  const RE2 = loadRe2();
  if (!RE2) return null;
  try {
    const compiled = new RE2(source, flags);
    if (!compiled) return null;
    return {
      engine: 're2',
      source,
      flags,
      match(text, startIndex, { timeoutMs = 0, sticky = false } = {}) {
        const started = timeoutMs ? Date.now() : 0;

        // Keep lastIndex behavior consistent with JS RegExp semantics:
        // only meaningful for global (g) or sticky (y).
        const usesLastIndex = flags.includes('g') || flags.includes('y') || sticky;
        if (typeof compiled.lastIndex === 'number') {
          compiled.lastIndex = usesLastIndex ? startIndex : 0;
        }

        const result = compiled.exec(text);

        if (timeoutMs && Date.now() - started > timeoutMs) return null;
        if (!result) return null;

        const index = Number.isFinite(result.index) ? result.index : 0;

        // Some RE2 builds may ignore 'y'; enforce sticky if requested.
        if (sticky && index !== startIndex) return null;

        const groups = Array.from(result);
        const matchText = groups[0] ?? '';
        const end = index + String(matchText).length;

        const nextLastIndex = (typeof compiled.lastIndex === 'number' && Number.isFinite(compiled.lastIndex))
          ? compiled.lastIndex
          : null;

        return { groups, index, end, nextLastIndex };
      }
    };
  } catch {
    return null;
  }
};
