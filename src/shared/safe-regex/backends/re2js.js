import { RE2JS } from 're2js';

const toFlagMask = (flags) => {
  let mask = 0;
  if (flags.includes('i')) mask |= RE2JS.CASE_INSENSITIVE;
  if (flags.includes('m')) mask |= RE2JS.MULTILINE;
  if (flags.includes('s')) mask |= RE2JS.DOTALL;
  return mask;
};

export function checkProgramSize(source, flags, maxProgramSize) {
  if (!maxProgramSize) return true;
  try {
    const translated = RE2JS.translateRegExp(source);
    const compiled = RE2JS.compile(translated, toFlagMask(flags));
    return compiled.programSize() <= maxProgramSize;
  } catch {
    return false;
  }
}

export function createRe2jsBackend() {
  return {
    name: 're2js',
    compile({ source, flags, maxProgramSize }) {
      try {
        const translated = RE2JS.translateRegExp(source);
        const compiled = RE2JS.compile(translated, toFlagMask(flags));
        if (maxProgramSize && compiled.programSize() > maxProgramSize) {
          return null;
        }
        return compiled;
      } catch {
        return null;
      }
    },
    exec(compiled, text, startIndex) {
      const matcher = compiled.matcher(text);
      const found = matcher.find(startIndex);
      if (!found) return null;
      const groupCount = compiled.groupCount();
      const match = new Array(groupCount + 1);
      for (let i = 0; i <= groupCount; i += 1) {
        match[i] = matcher.group(i);
      }
      match.index = matcher.start();
      match.input = text;
      return { match, nextIndex: matcher.end() };
    }
  };
}
