import { createRe2Backend } from './safe-regex/backends/re2.js';
import { checkProgramSize, createRe2jsBackend } from './safe-regex/backends/re2js.js';
import { normalizeCapNullOnZero } from './limits.js';

export const DEFAULT_SAFE_REGEX_CONFIG = {
  maxPatternLength: 512,
  maxInputLength: 10000,
  maxProgramSize: 2000,
  timeoutMs: null,
  flags: ''
};

const normalizeLimit = (value, fallback) => (
  normalizeCapNullOnZero(value, fallback)
);

const FLAG_ORDER = ['g', 'i', 'm', 's'];
const FLAG_SET = new Set(FLAG_ORDER);

const normalizeFlags = (raw) => {
  if (!raw) return '';
  const seen = new Set();
  for (const ch of String(raw)) {
    if (!FLAG_SET.has(ch)) continue;
    seen.add(ch);
  }
  return FLAG_ORDER.filter((flag) => seen.has(flag)).join('');
};

const mergeFlags = (explicit, fallback) => {
  const primary = normalizeFlags(explicit);
  const defaults = normalizeFlags(fallback);
  if (!defaults) return primary;
  if (!primary) return defaults;
  return normalizeFlags(`${defaults}${primary}`);
};

const re2jsBackend = createRe2jsBackend();
const re2Backend = createRe2Backend();
let warnedMissingRe2 = false;

const normalizeEngine = (engine) => {
  if (engine === 're2' || engine === 're2js' || engine === 'auto') return engine;
  return 'auto';
};

const warnMissingRe2 = () => {
  if (warnedMissingRe2) return;
  warnedMissingRe2 = true;
  console.warn('[safe-regex] re2 requested but not available; falling back to re2js.');
};

const selectBackend = (engine) => {
  if (engine === 're2') {
    if (re2Backend.available) return re2Backend;
    warnMissingRe2();
    return re2jsBackend;
  }
  if (engine === 're2js') return re2jsBackend;
  return re2Backend.available ? re2Backend : re2jsBackend;
};

class SafeRegex {
  constructor(backend, compiled, source, flags, config) {
    this.backend = backend;
    this.compiled = compiled;
    this.source = source;
    this.flags = flags;
    this.config = config;
    this.engine = backend?.name || 're2js';
    this.lastIndex = 0;
    this.isGlobal = flags.includes('g');
  }

  exec(input) {
    const text = String(input ?? '');
    if (!text) {
      if (this.isGlobal) this.lastIndex = 0;
      return null;
    }
    const { maxInputLength } = this.config || {};
    if (maxInputLength && text.length > maxInputLength) {
      if (this.isGlobal) this.lastIndex = 0;
      return null;
    }
    const startIndex = this.isGlobal && Number.isFinite(this.lastIndex)
      ? Math.max(0, this.lastIndex)
      : 0;
    const outcome = this.backend.exec(this.compiled, text, startIndex, this.isGlobal);
    if (!outcome || !outcome.match) {
      if (this.isGlobal) this.lastIndex = 0;
      return null;
    }
    const result = outcome.match;
    if (result.index === undefined || result.index === null) {
      result.index = startIndex;
    }
    if (!result.input) result.input = text;
    if (this.isGlobal) this.lastIndex = Number.isFinite(outcome.nextIndex) ? outcome.nextIndex : 0;
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
    timeoutMs: null,
    flags: normalizeFlags(hasFlagOverride ? config.flags : base.flags)
  };
}

const buildUnsupportedFlags = (explicit, defaults) => {
  const invalid = new Set();
  const combined = `${explicit || ''}${defaults || ''}`;
  for (const ch of combined) {
    if (!FLAG_SET.has(ch)) invalid.add(ch);
  }
  return Array.from(invalid);
};

const tryCompileWithoutSize = (backend, source, flags, config) => {
  try {
    return backend.compile({
      source,
      flags,
      maxProgramSize: null
    });
  } catch {
    return null;
  }
};

export function compileSafeRegex(pattern, flags = '', config = {}) {
  const configInput = config && typeof config === 'object' ? config : {};
  const normalized = normalizeSafeRegexConfig(configInput);
  const engine = normalizeEngine(configInput?.engine);
  const source = String(pattern ?? '');
  if (!source) {
    return { regex: null, error: { code: 'EMPTY_PATTERN', message: 'Pattern is empty.' } };
  }
  if (normalized.maxPatternLength && source.length > normalized.maxPatternLength) {
    return {
      regex: null,
      error: {
        code: 'PATTERN_TOO_LONG',
        message: `Pattern exceeds max length (${source.length} > ${normalized.maxPatternLength}).`
      }
    };
  }
  const unsupportedFlags = buildUnsupportedFlags(flags, configInput?.flags);
  if (unsupportedFlags.length) {
    return {
      regex: null,
      error: {
        code: 'UNSUPPORTED_FLAGS',
        message: `Unsupported regex flags: ${unsupportedFlags.join('')}`
      }
    };
  }
  const combinedFlags = mergeFlags(flags, normalized.flags);
  const backend = selectBackend(engine);
  if (!backend || !backend.compile) {
    return {
      regex: null,
      error: { code: 'ENGINE_UNAVAILABLE', message: 'Regex engine unavailable.' }
    };
  }
  if (backend.name === 're2' && normalized.maxProgramSize) {
    if (!checkProgramSize(source, combinedFlags, normalized.maxProgramSize)) {
      const probe = tryCompileWithoutSize(backend, source, combinedFlags, normalized);
      if (!probe) {
        return {
          regex: null,
          error: { code: 'INVALID_PATTERN', message: 'Invalid regex pattern.' }
        };
      }
      return {
        regex: null,
        error: { code: 'PROGRAM_TOO_LARGE', message: 'Regex program exceeds size cap.' }
      };
    }
  }
  if (backend.name !== 're2' && normalized.maxProgramSize) {
    if (!checkProgramSize(source, combinedFlags, normalized.maxProgramSize)) {
      const probe = tryCompileWithoutSize(backend, source, combinedFlags, normalized);
      if (!probe) {
        return {
          regex: null,
          error: { code: 'INVALID_PATTERN', message: 'Invalid regex pattern.' }
        };
      }
      return {
        regex: null,
        error: { code: 'PROGRAM_TOO_LARGE', message: 'Regex program exceeds size cap.' }
      };
    }
  }
  try {
    const compiled = backend.compile({
      source,
      flags: combinedFlags,
      maxProgramSize: normalized.maxProgramSize
    });
    if (!compiled) {
      return {
        regex: null,
        error: { code: 'INVALID_PATTERN', message: 'Invalid regex pattern.' }
      };
    }
    return { regex: new SafeRegex(backend, compiled, source, combinedFlags, normalized), error: null };
  } catch {
    return {
      regex: null,
      error: { code: 'INVALID_PATTERN', message: 'Invalid regex pattern.' }
    };
  }
}

export function createSafeRegex(pattern, flags = '', config = {}) {
  const configInput = config && typeof config === 'object' ? config : {};
  const normalized = normalizeSafeRegexConfig(configInput);
  const engine = normalizeEngine(configInput?.engine);
  const source = String(pattern ?? '');
  if (!source) return null;
  if (normalized.maxPatternLength && source.length > normalized.maxPatternLength) {
    return null;
  }
  const combinedFlags = mergeFlags(flags, normalized.flags);
  const backend = selectBackend(engine);
  if (backend.name === 're2' && normalized.maxProgramSize) {
    if (!checkProgramSize(source, combinedFlags, normalized.maxProgramSize)) {
      return null;
    }
  }
  try {
    const compiled = backend.compile({
      source,
      flags: combinedFlags,
      maxProgramSize: normalized.maxProgramSize
    });
    if (!compiled) {
      return null;
    }
    return new SafeRegex(backend, compiled, source, combinedFlags, normalized);
  } catch {
    return null;
  }
}
