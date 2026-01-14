import { compileRe2js } from './safe-regex/backends/re2js.js';
import { compileRe2, isRe2Available } from './safe-regex/backends/re2.js';

export const DEFAULT_SAFE_REGEX_CONFIG = {
  engine: 'auto',
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

const normalizeEngine = (raw, fallback) => {
  if (!raw) return fallback;
  const key = String(raw).trim().toLowerCase();
  if (key === 'auto') return 'auto';
  if (key === 're2') return 're2';
  if (key === 're2js') return 're2js';
  return fallback;
};

const normalizeFlags = (raw) => {
  if (!raw) return '';
  const seen = new Set();
  const out = [];
  for (const ch of String(raw)) {
    if (!'gimsuy'.includes(ch) || seen.has(ch)) continue;
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

class SafeRegex {
  constructor(backend, source, flags, config, requestedEngine) {
    this.backend = backend;
    this.engine = backend?.engine || 're2js';
    this.requestedEngine = requestedEngine || 'auto';
    this.source = source;
    this.flags = flags;
    this.config = config;
    this.lastIndex = 0;
    this.isGlobal = flags.includes('g');
    this.isSticky = flags.includes('y');
    this.usesLastIndex = this.isGlobal || this.isSticky;
  }

  exec(input) {
    const text = String(input ?? '');
    if (!text) {
      if (this.usesLastIndex) this.lastIndex = 0;
      return null;
    }

    const { maxInputLength, timeoutMs } = this.config || {};
    if (maxInputLength && text.length > maxInputLength) {
      if (this.usesLastIndex) this.lastIndex = 0;
      return null;
    }

    const startIndex = this.usesLastIndex && Number.isFinite(this.lastIndex)
      ? Math.max(0, this.lastIndex)
      : 0;

    if (this.usesLastIndex && startIndex > text.length) {
      this.lastIndex = 0;
      return null;
    }

    const match = this.backend.match(text, startIndex, { timeoutMs, sticky: this.isSticky });
    if (!match) {
      if (this.usesLastIndex) this.lastIndex = 0;
      return null;
    }

    const groups = Array.isArray(match.groups) ? match.groups : [];
    const result = groups.slice();
    result.index = match.index;
    result.input = text;

    if (this.usesLastIndex) {
      if (Number.isFinite(match.nextLastIndex)) {
        this.lastIndex = match.nextLastIndex;
      } else {
        let next = match.end;
        if (Number.isFinite(next) && next === match.index) {
          next = Math.min(text.length, next + 1);
        }
        this.lastIndex = Number.isFinite(next) ? next : 0;
      }
    }

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
  const hasEngineOverride = Object.prototype.hasOwnProperty.call(config, 'engine');
  return {
    engine: normalizeEngine(hasEngineOverride ? config.engine : base.engine, base.engine),
    maxPatternLength: normalizeLimit(config.maxPatternLength, base.maxPatternLength),
    maxInputLength: normalizeLimit(config.maxInputLength, base.maxInputLength),
    maxProgramSize: normalizeLimit(config.maxProgramSize, base.maxProgramSize),
    timeoutMs: normalizeLimit(config.timeoutMs, base.timeoutMs),
    flags: normalizeFlags(hasFlagOverride ? config.flags : base.flags)
  };
}

let warnedMissingRe2 = false;
const warnMissingRe2Once = () => {
  if (warnedMissingRe2) return;
  warnedMissingRe2 = true;
  console.warn('SafeRegex: engine "re2" requested but optional dependency "re2" is not available; falling back to re2js.');
};

export function createSafeRegex(pattern, flags = '', config = {}) {
  const normalized = normalizeSafeRegexConfig(config);
  const source = String(pattern ?? '');
  if (!source) return null;
  if (normalized.maxPatternLength && source.length > normalized.maxPatternLength) {
    return null;
  }

  const combinedFlags = mergeFlags(flags, normalized.flags);
  const requestedEngine = normalized.engine || 'auto';

  // Try native RE2 if requested (auto or explicit) and available.
  if (requestedEngine !== 're2js') {
    const nativeAvailable = isRe2Available();
    if (nativeAvailable) {
      const backend = compileRe2(source, combinedFlags);
      if (backend) return new SafeRegex(backend, source, combinedFlags, normalized, requestedEngine);
    } else if (requestedEngine === 're2') {
      warnMissingRe2Once();
    }
  }

  // Fall back to RE2JS.
  const backend = compileRe2js(source, combinedFlags, normalized);
  if (!backend) return null;
  return new SafeRegex(backend, source, combinedFlags, normalized, requestedEngine);
}

export const isNativeRe2Available = isRe2Available;
