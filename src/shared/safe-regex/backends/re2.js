import { tryRequire } from '../../optional-deps.js';

export function createRe2Backend() {
  const result = tryRequire('re2');
  const Re2 = result.ok ? (result.mod?.default ?? result.mod) : null;
  return {
    name: 're2',
    available: result.ok && typeof Re2 === 'function',
    compile({ source, flags }) {
      if (!Re2 || typeof Re2 !== 'function') return null;
      try {
        return new Re2(source, flags);
      } catch {
        return null;
      }
    },
    exec(compiled, text, startIndex, isGlobal) {
      if (isGlobal) {
        compiled.lastIndex = startIndex;
      } else {
        compiled.lastIndex = 0;
      }
      const match = compiled.exec(text);
      if (!match) return null;
      const nextIndex = isGlobal ? compiled.lastIndex : 0;
      if (!match.input) match.input = text;
      return { match, nextIndex };
    }
  };
}
