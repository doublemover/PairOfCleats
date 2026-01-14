import { RE2JS } from 're2js';

const toFlagMask = (flags) => {
  let mask = 0;
  if (flags.includes('i')) mask |= RE2JS.CASE_INSENSITIVE;
  if (flags.includes('m')) mask |= RE2JS.MULTILINE;
  if (flags.includes('s')) mask |= RE2JS.DOTALL;
  return mask;
};

export const compileRe2js = (source, flags, config = {}) => {
  const mask = toFlagMask(flags);
  try {
    const translated = RE2JS.translateRegExp(source);
    const compiled = RE2JS.compile(translated, mask);
    if (config.maxProgramSize && compiled.programSize() > config.maxProgramSize) {
      return null;
    }
    const groupCount = compiled.groupCount();
    return {
      engine: 're2js',
      source,
      flags,
      match(text, startIndex, { timeoutMs = 0, sticky = false } = {}) {
        const started = timeoutMs ? Date.now() : 0;
        const matcher = compiled.matcher(text);
        const found = matcher.find(startIndex);
        if (timeoutMs && Date.now() - started > timeoutMs) return null;
        if (!found) return null;
        const index = matcher.start();
        if (sticky && index !== startIndex) return null;
        const end = matcher.end();
        const groups = new Array(groupCount + 1);
        for (let i = 0; i <= groupCount; i += 1) {
          groups[i] = matcher.group(i);
        }
        return { groups, index, end };
      }
    };
  } catch {
    return null;
  }
};
