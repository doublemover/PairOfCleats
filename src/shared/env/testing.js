import { isPlainObject } from '../config.js';
import {
  normalizeBoolean,
  normalizeNonNegativeInt,
  normalizeNumber,
  normalizeOptionalBoolean,
  normalizeString,
  normalizeStringList
} from './core.js';

const isTesting = (env) => env?.PAIROFCLEATS_TESTING === '1' || env?.PAIROFCLEATS_TESTING === 'true';

export const isTestingEnv = (env = process.env) => isTesting(env);

export function getTestEnvConfig(env = process.env) {
  if (!isTesting(env)) {
    return {
      testing: false,
      config: null,
      maxJsonBytes: null,
      allowMissingCompatKey: false,
      mcpDelayMs: null,
      mcpDelayToolNames: []
    };
  }
  const rawConfig = normalizeString(env.PAIROFCLEATS_TEST_CONFIG);
  let config = null;
  if (rawConfig) {
    let parsed;
    try {
      parsed = JSON.parse(rawConfig);
    } catch (err) {
      throw new Error(`Invalid PAIROFCLEATS_TEST_CONFIG: ${err?.message || err}`);
    }
    if (!isPlainObject(parsed)) {
      throw new Error('PAIROFCLEATS_TEST_CONFIG must be a JSON object.');
    }
    config = parsed;
  }
  return {
    testing: true,
    config,
    maxJsonBytes: normalizeNumber(env.PAIROFCLEATS_TEST_MAX_JSON_BYTES),
    allowMissingCompatKey: normalizeOptionalBoolean(env.PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY),
    mcpDelayMs: normalizeNumber(env.PAIROFCLEATS_TEST_MCP_DELAY_MS),
    mcpDelayToolNames: normalizeStringList(env.PAIROFCLEATS_TEST_MCP_DELAY_TOOL_NAMES)
  };
}

export function getDocumentExtractorTestConfig(env = process.env) {
  const testing = isTesting(env);
  if (!testing) {
    return {
      testing: false,
      forceDocxMissing: false,
      forcePdfMissing: false,
      stubDocxExtract: false,
      stubPdfExtract: false,
      stubPdfExtractDelayMs: 0
    };
  }
  return {
    testing: true,
    forceDocxMissing: normalizeBoolean(env.PAIROFCLEATS_TEST_FORCE_DOCX_MISSING),
    forcePdfMissing: normalizeBoolean(env.PAIROFCLEATS_TEST_FORCE_PDF_MISSING),
    stubDocxExtract: normalizeBoolean(env.PAIROFCLEATS_TEST_STUB_DOCX_EXTRACT),
    stubPdfExtract: normalizeBoolean(env.PAIROFCLEATS_TEST_STUB_PDF_EXTRACT),
    stubPdfExtractDelayMs: normalizeNonNegativeInt(env.PAIROFCLEATS_TEST_STUB_PDF_EXTRACT_DELAY_MS)
  };
}

export function getTreeSitterSchedulerCrashInjectionTokens(env = process.env) {
  const raw = normalizeString(env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH);
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((part) => normalizeString(part).toLowerCase())
      .filter(Boolean)
  );
}
