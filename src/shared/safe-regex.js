import { RE2JS } from 're2js';

export const DEFAULT_SAFE_REGEX_CONFIG = {
  maxPatternLength: 512,
  maxInputLength: 10000,
  maxProgramSize: 2000,
  timeoutMs: 25,
  flags: ''
};

const normalizeLimit = (value, fallback) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

const normalizeFlags = (raw) => {
  if (!raw) return '';
  const seen = new Set();
  const out = [];
  for (const ch of String(raw)) {
    if (!'gimsu'.includes(ch) || seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out.join('');
};

const mergeFlags = (explicit, fallback) => {
  const primary = normalizeFlags(explicit);
  const defaults = normalizeFlags(fallback);
  if (!defaults) return primary;
  if (!primary) return defaults;
  const merged = [];
  const seen = new Set();
  for (const ch of `${defaults}${primary}`) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    merged.push(ch);
  }
  return merged.join('');
};

const toFlagMask = (flags) => {
  let mask = 0;
  if (flags.includes('i')) mask |= RE2JS.CASE_INSENSITIVE;
  if (flags.includes('m')) mask |= RE2JS.MULTILINE;
  if (flags.includes('s')) mask |= RE2JS.DOTALL;
  return mask;
};

class SafeRegex {
  constructor(re2, source, flags, config) {
    this.re2 = re2;
    this.source = source;
    this.flags = flags;
    this.config = config;
    this.lastIndex = 0;
    this.isGlobal = flags.includes('g');
  }

  exec(input) {
    const text = String(input ?? '');
    if (!text) {
      if (this.isGlobal) this.lastIndex = 0;
      return null;
    }
    const { maxInputLength, timeoutMs } = this.config || {};
    if (maxInputLength && text.length > maxInputLength) {
      if (this.isGlobal) this.lastIndex = 0;
      return null;
    }
    const startIndex = this.isGlobal && Number.isFinite(this.lastIndex)
      ? Math.max(0, this.lastIndex)
      : 0;
    const started = timeoutMs ? Date.now() : 0;
    const matcher = this.re2.matcher(text);
    const found = matcher.find(startIndex);
    if (timeoutMs && Date.now() - started > timeoutMs) {
      if (this.isGlobal) this.lastIndex = 0;
      return null;
    }
    if (!found) {
      if (this.isGlobal) this.lastIndex = 0;
      return null;
    }
    const groupCount = this.re2.groupCount();
    const result = new Array(groupCount + 1);
    for (let i = 0; i <= groupCount; i += 1) {
      result[i] = matcher.group(i);
    }
    result.index = matcher.start();
    result.input = text;
    if (this.isGlobal) this.lastIndex = matcher.end();
    return result;
  }

  test(input) {
    return !!this.exec(input);
  }
}

export function normalizeSafeRegexConfig(raw = {}, defaults = {}) {
  const base = { ...DEFAULT_SAFE_REGEX_CONFIG, ...defaults };
  const config = raw && typeof raw === 'object' ? raw : {};
  const hasFlagOverride = Object.prototype.hasOwnProperty.call(config, 'flags');
  return {
    maxPatternLength: normalizeLimit(config.maxPatternLength, base.maxPatternLength),
    maxInputLength: normalizeLimit(config.maxInputLength, base.maxInputLength),
    maxProgramSize: normalizeLimit(config.maxProgramSize, base.maxProgramSize),
    timeoutMs: normalizeLimit(config.timeoutMs, base.timeoutMs),
    flags: normalizeFlags(hasFlagOverride ? config.flags : base.flags)
  };
}

export function createSafeRegex(pattern, flags = '', config = {}) {
  const normalized = normalizeSafeRegexConfig(config);
  const source = String(pattern ?? '');
  if (!source) return null;
  if (normalized.maxPatternLength && source.length > normalized.maxPatternLength) {
    return null;
  }
  const combinedFlags = mergeFlags(flags, normalized.flags);
  const mask = toFlagMask(combinedFlags);
  try {
    const translated = RE2JS.translateRegExp(source);
    const compiled = RE2JS.compile(translated, mask);
    if (normalized.maxProgramSize && compiled.programSize() > normalized.maxProgramSize) {
      return null;
    }
    return new SafeRegex(compiled, source, combinedFlags, normalized);
  } catch {
    return null;
  }
}
