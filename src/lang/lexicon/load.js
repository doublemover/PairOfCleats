import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  buildBuiltInGenericLexiconPayload,
  normalizeWordlistPayload
} from './normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORDLIST_DIR = path.join(__dirname, 'wordlists');
const DEFAULT_SCHEMA_PATH = path.join(__dirname, 'language-lexicon-wordlist.schema.json');

const validatorCache = new Map();
const lexiconCache = new Map();
const warnedKeys = new Set();

const emitWarningOnce = (key, message, log) => {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (typeof log === 'function') {
    log(message);
    return;
  }
  console.warn(message);
};

const resolveSchemaValidator = (schemaPath, log) => {
  const resolved = path.resolve(schemaPath);
  if (validatorCache.has(resolved)) return validatorCache.get(resolved);
  let validator = null;
  try {
    const schema = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    validator = ajv.compile(schema);
  } catch (error) {
    emitWarningOnce(
      `schema:${resolved}`,
      `[lexicon] schema unavailable path=${resolved} reason="${error?.message || error}"; running fail-open.`,
      log
    );
    validator = null;
  }
  validatorCache.set(resolved, validator);
  return validator;
};

const normalizeLanguageId = (value) => {
  if (typeof value !== 'string') return '_generic';
  const normalized = value.trim().toLowerCase();
  return normalized || '_generic';
};

const tryLoadWordlist = ({ languageId, wordlistsDir, schemaPath, validator, strict, log }) => {
  const filePath = path.join(wordlistsDir, `${languageId}.json`);
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'missing', filePath };
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    emitWarningOnce(
      `invalid-json:${filePath}`,
      `[lexicon] invalid_wordlist file=${filePath} reason="invalid-json: ${error?.message || error}"`,
      log
    );
    return { ok: false, reason: 'invalid', filePath };
  }

  if (validator && !validator(payload)) {
    const first = validator.errors && validator.errors.length ? validator.errors[0] : null;
    const detail = first
      ? `${first.instancePath || '#'} ${first.message || 'is invalid'}`
      : 'schema validation failed';
    emitWarningOnce(
      `invalid-schema:${filePath}`,
      `[lexicon] invalid_wordlist file=${filePath} reason="schema: ${detail}"`,
      log
    );
    return { ok: false, reason: 'invalid', filePath };
  }

  if (payload.languageId !== languageId) {
    emitWarningOnce(
      `invalid-language:${filePath}`,
      `[lexicon] invalid_wordlist file=${filePath} reason="languageId mismatch (expected ${languageId}, got ${payload.languageId ?? ''})"`,
      log
    );
    return { ok: false, reason: 'invalid', filePath };
  }

  try {
    const lexicon = normalizeWordlistPayload(payload, { filePath, strict });
    return { ok: true, filePath, lexicon };
  } catch (error) {
    emitWarningOnce(
      `invalid-normalize:${filePath}`,
      `[lexicon] invalid_wordlist file=${filePath} reason="normalize: ${error?.message || error}"`,
      log
    );
    return { ok: false, reason: 'invalid', filePath };
  }
};

const buildBuiltinFallback = ({ requestedLanguageId, strict, log }) => {
  const payload = buildBuiltInGenericLexiconPayload();
  const lexicon = normalizeWordlistPayload(payload, { filePath: '<builtin:_generic>', strict });
  emitWarningOnce(
    'builtin-fallback',
    '[lexicon] using built-in _generic fallback payload.',
    log
  );
  return {
    ...lexicon,
    requestedLanguageId,
    resolvedLanguageId: lexicon.languageId,
    fallback: requestedLanguageId !== lexicon.languageId,
    sourceFile: '<builtin:_generic>'
  };
};

export const clearLexiconLoadCaches = () => {
  validatorCache.clear();
  lexiconCache.clear();
  warnedKeys.clear();
};

export const loadLanguageLexicon = (languageId, options = {}) => {
  const requestedLanguageId = normalizeLanguageId(languageId);
  const allowFallback = options.allowFallback !== false;
  const wordlistsDir = path.resolve(options.wordlistsDir || DEFAULT_WORDLIST_DIR);
  const schemaPath = path.resolve(options.schemaPath || DEFAULT_SCHEMA_PATH);
  const strict = options.strict !== false;
  const useCache = options.cache !== false;
  const log = options.log;

  const cacheKey = `${wordlistsDir}|${schemaPath}|${requestedLanguageId}|${allowFallback ? '1' : '0'}|${strict ? '1' : '0'}`;
  if (useCache && lexiconCache.has(cacheKey)) {
    return lexiconCache.get(cacheKey);
  }

  const validator = resolveSchemaValidator(schemaPath, log);
  const lookupOrder = [requestedLanguageId];
  if (allowFallback && requestedLanguageId !== '_generic') {
    lookupOrder.push('_generic');
  }

  for (const candidate of lookupOrder) {
    const loaded = tryLoadWordlist({
      languageId: candidate,
      wordlistsDir,
      schemaPath,
      validator,
      strict,
      log
    });
    if (!loaded.ok) continue;

    const resolved = {
      ...loaded.lexicon,
      requestedLanguageId,
      resolvedLanguageId: candidate,
      fallback: candidate !== requestedLanguageId,
      sourceFile: loaded.filePath
    };

    if (useCache) lexiconCache.set(cacheKey, resolved);
    return resolved;
  }

  const fallback = buildBuiltinFallback({ requestedLanguageId, strict, log });
  if (useCache) lexiconCache.set(cacheKey, fallback);
  return fallback;
};
