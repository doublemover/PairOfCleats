#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import seedrandom from 'seedrandom';
import { createCli } from '../../src/shared/cli.js';
import { loadChunkMeta } from '../../src/shared/artifact-io.js';
import { sha1 } from '../../src/shared/hash.js';
import { getIndexDir, resolveRepoConfig } from '../shared/dict-utils.js';

export const QUERY_INTENT_CLASSES = Object.freeze([
  'symbol',
  'type',
  'api',
  'behavior'
]);

const LANGUAGE_FAMILY_BY_LANGUAGE = new Map([
  ['c', 'clike'],
  ['cpp', 'clike'],
  ['c++', 'clike'],
  ['clike', 'clike'],
  ['objective-c', 'clike'],
  ['objc', 'clike'],
  ['csharp', 'clike'],
  ['java', 'jvm'],
  ['kotlin', 'jvm'],
  ['scala', 'jvm'],
  ['groovy', 'jvm'],
  ['javascript', 'scripting'],
  ['typescript', 'scripting'],
  ['python', 'scripting'],
  ['ruby', 'scripting'],
  ['lua', 'scripting'],
  ['perl', 'scripting'],
  ['shell', 'scripting'],
  ['php', 'scripting'],
  ['go', 'systems'],
  ['rust', 'systems'],
  ['sql', 'data'],
  ['graphql', 'data'],
  ['protobuf', 'data']
]);

const DEFAULT_INTENT_WEIGHTS_BY_FAMILY = Object.freeze({
  general: Object.freeze({
    symbol: 0.34,
    type: 0.22,
    api: 0.26,
    behavior: 0.18
  }),
  clike: Object.freeze({
    symbol: 0.31,
    type: 0.35,
    api: 0.24,
    behavior: 0.10
  }),
  jvm: Object.freeze({
    symbol: 0.30,
    type: 0.32,
    api: 0.24,
    behavior: 0.14
  }),
  scripting: Object.freeze({
    symbol: 0.30,
    type: 0.16,
    api: 0.29,
    behavior: 0.25
  }),
  systems: Object.freeze({
    symbol: 0.34,
    type: 0.26,
    api: 0.25,
    behavior: 0.15
  }),
  data: Object.freeze({
    symbol: 0.22,
    type: 0.20,
    api: 0.38,
    behavior: 0.20
  })
});

const API_HINTS_BY_FAMILY = Object.freeze({
  general: Object.freeze(['api', 'handler', 'interface']),
  clike: Object.freeze(['header', 'allocator', 'ffi']),
  jvm: Object.freeze(['builder', 'service', 'annotation']),
  scripting: Object.freeze(['middleware', 'plugin', 'module']),
  systems: Object.freeze(['runtime', 'scheduler', 'trait']),
  data: Object.freeze(['schema', 'migration', 'resolver'])
});

const BEHAVIOR_HINTS_BY_FAMILY = Object.freeze({
  general: Object.freeze(['retry', 'fallback', 'validation']),
  clike: Object.freeze(['memory safety', 'thread safety', 'overflow guard']),
  jvm: Object.freeze(['transaction', 'serialization', 'lifecycle']),
  scripting: Object.freeze(['auth flow', 'request handling', 'error path']),
  systems: Object.freeze(['latency path', 'backpressure', 'safety policy']),
  data: Object.freeze(['query planner', 'consistency check', 'index policy'])
});

const TYPE_TOKEN_PATTERN = /\b[A-Z][A-Za-z0-9_<>:[\],.]{1,64}\b/g;
const SAFE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:/-]*$/;

const uniq = (list) => Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));

const toLanguageKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9#+.-]/g, '');

const parseIntentWeightsInput = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  const tokens = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const parsed = {};
  for (const token of tokens) {
    const [left, right] = token.split(/[:=]/).map((entry) => entry.trim());
    const key = toLanguageKey(left);
    const weight = Number(right);
    if (!QUERY_INTENT_CLASSES.includes(key)) continue;
    if (!Number.isFinite(weight) || weight < 0) continue;
    parsed[key] = weight;
  }
  return Object.keys(parsed).length ? parsed : null;
};

export const resolveLanguageFamily = ({ explicitFamily = null, languages = [] } = {}) => {
  const normalizedExplicit = toLanguageKey(explicitFamily);
  if (DEFAULT_INTENT_WEIGHTS_BY_FAMILY[normalizedExplicit]) {
    return normalizedExplicit;
  }
  const counts = new Map();
  for (const language of Array.isArray(languages) ? languages : []) {
    const languageKey = toLanguageKey(language);
    const family = LANGUAGE_FAMILY_BY_LANGUAGE.get(languageKey);
    if (!family) continue;
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  if (!counts.size) return 'general';
  const ranked = Array.from(counts.entries())
    .sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0]));
  return ranked[0][0];
};

export const normalizeIntentWeights = ({
  languageFamily = 'general',
  override = null
} = {}) => {
  const family = DEFAULT_INTENT_WEIGHTS_BY_FAMILY[toLanguageKey(languageFamily)]
    ? toLanguageKey(languageFamily)
    : 'general';
  const base = DEFAULT_INTENT_WEIGHTS_BY_FAMILY[family];
  const parsedOverride = parseIntentWeightsInput(override);
  const merged = {};
  for (const intentClass of QUERY_INTENT_CLASSES) {
    const rawWeight = parsedOverride && Object.prototype.hasOwnProperty.call(parsedOverride, intentClass)
      ? Number(parsedOverride[intentClass])
      : Number(base[intentClass]);
    merged[intentClass] = Number.isFinite(rawWeight) && rawWeight >= 0 ? rawWeight : 0;
  }
  const total = QUERY_INTENT_CLASSES.reduce((sum, intentClass) => sum + merged[intentClass], 0);
  if (total <= 0) {
    const fallback = { ...base };
    const fallbackTotal = QUERY_INTENT_CLASSES.reduce((sum, intentClass) => sum + fallback[intentClass], 0);
    for (const intentClass of QUERY_INTENT_CLASSES) {
      fallback[intentClass] = fallback[intentClass] / fallbackTotal;
    }
    return fallback;
  }
  for (const intentClass of QUERY_INTENT_CLASSES) {
    merged[intentClass] = merged[intentClass] / total;
  }
  return merged;
};

const formatQueryValue = (value) => {
  if (!value) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const escaped = cleaned.replace(/[\\"]/g, '\\$&');
  return /\s/.test(escaped) ? `"${escaped}"` : escaped;
};
const tokensFromDoc = (text) => {
  if (!text) return [];
  return text
    .split(/\s+/)
    .map((token) => token.replace(/[^\w:/.-]/g, '').trim())
    .filter((token) => token.length >= 4);
};

const tokenizeTypeCandidates = (values = []) => {
  const out = [];
  for (const value of values) {
    const text = String(value || '');
    const matches = text.match(TYPE_TOKEN_PATTERN) || [];
    for (const match of matches) {
      if (match.length < 3) continue;
      out.push(match);
    }
  }
  return uniq(out);
};

const collectCandidates = (chunks = []) => {
  const names = uniq(chunks.map((chunk) => String(chunk?.name || '').trim()).filter((name) => SAFE_NAME_PATTERN.test(name)));
  const signatures = uniq(chunks.map((chunk) => chunk?.docmeta?.signature || chunk?.metaV2?.signature));
  const kinds = uniq(chunks.map((chunk) => chunk?.kind || chunk?.metaV2?.kind));
  const returnTypes = uniq(chunks.map((chunk) => chunk?.docmeta?.returnType || chunk?.metaV2?.returns));
  const docs = uniq(chunks.flatMap((chunk) => tokensFromDoc(chunk?.docmeta?.doc || chunk?.metaV2?.doc)));
  const riskTags = uniq(chunks.flatMap((chunk) => chunk?.docmeta?.risk?.tags || chunk?.metaV2?.risk?.tags || []));
  const languages = uniq(chunks.map((chunk) => (
    chunk?.language
      || chunk?.docmeta?.language
      || chunk?.metaV2?.language
      || chunk?.docmeta?.lang
      || chunk?.metaV2?.lang
  )));
  const typeTokens = tokenizeTypeCandidates([...signatures, ...returnTypes]);
  return {
    names,
    signatures,
    kinds,
    returnTypes,
    docs,
    riskTags,
    languages,
    typeTokens
  };
};

const buildIntentPlan = ({ count, intentWeights }) => {
  const totalCount = Math.max(1, Math.floor(Number(count) || 1));
  const intents = QUERY_INTENT_CLASSES.map((intentClass) => {
    const weight = Number(intentWeights?.[intentClass]) || 0;
    const exact = totalCount * Math.max(0, weight);
    const floor = Math.floor(exact);
    return {
      intentClass,
      weight,
      exact,
      floor,
      remainder: exact - floor
    };
  });
  let assigned = intents.reduce((sum, entry) => sum + entry.floor, 0);
  intents.sort((left, right) => right.remainder - left.remainder);
  for (const entry of intents) {
    if (assigned >= totalCount) break;
    entry.floor += 1;
    assigned += 1;
  }
  return Object.fromEntries(intents.map((entry) => [entry.intentClass, entry.floor]));
};

const weightedIntentPick = (intentWeights, rng) => {
  const entries = QUERY_INTENT_CLASSES
    .map((intentClass) => [intentClass, Math.max(0, Number(intentWeights?.[intentClass] || 0))]);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return 'symbol';
  const value = rng() * total;
  let cursor = 0;
  for (const [intentClass, weight] of entries) {
    cursor += weight;
    if (value <= cursor) return intentClass;
  }
  return entries[entries.length - 1][0];
};

const pickOr = (list, rng, fallback = null) => {
  if (!Array.isArray(list) || !list.length) return fallback;
  return list[Math.floor(rng() * list.length)];
};

const maybeJoin = (...parts) => {
  const values = parts.map((entry) => String(entry || '').trim()).filter(Boolean);
  return values.length ? values.join(' ') : null;
};

const buildIntentStrategies = ({ candidates, languageFamily, rng }) => {
  const apiHints = API_HINTS_BY_FAMILY[languageFamily] || API_HINTS_BY_FAMILY.general;
  const behaviorHints = BEHAVIOR_HINTS_BY_FAMILY[languageFamily] || BEHAVIOR_HINTS_BY_FAMILY.general;
  const names = candidates.names.length ? candidates.names : ['handler', 'service', 'controller'];
  const kinds = candidates.kinds.length ? candidates.kinds : ['function', 'class', 'module'];
  const signatures = candidates.signatures.length ? candidates.signatures : ['initialize(config)', 'execute(input)'];
  const returnTypes = candidates.returnTypes.length ? candidates.returnTypes : ['Result', 'Response', 'Context'];
  const docs = candidates.docs.length ? candidates.docs : ['fallback', 'retry', 'validate', 'timeout'];
  const riskTags = candidates.riskTags.length ? candidates.riskTags : ['fallback', 'timeout', 'guardrail'];
  const typeTokens = candidates.typeTokens.length ? candidates.typeTokens : ['Result', 'Config', 'Context'];

  return {
    symbol: {
      standard: [
        () => formatQueryValue(pickOr(names, rng)),
        () => formatQueryValue(maybeJoin(pickOr(names, rng), pickOr(kinds, rng))),
        () => formatQueryValue(maybeJoin(pickOr(names, rng), pickOr(typeTokens, rng)))
      ],
      adversarial: [
        () => formatQueryValue(`${pickOr(names, rng)} -${pickOr(riskTags, rng)}`),
        () => formatQueryValue(maybeJoin(pickOr(names, rng), pickOr(names, rng)))
      ]
    },
    type: {
      standard: [
        () => formatQueryValue(pickOr(returnTypes, rng)),
        () => formatQueryValue(maybeJoin('type', pickOr(typeTokens, rng))),
        () => formatQueryValue(maybeJoin(pickOr(typeTokens, rng), pickOr(kinds, rng)))
      ],
      adversarial: [
        () => formatQueryValue(`"${pickOr(typeTokens, rng)}" -deprecated`),
        () => formatQueryValue(maybeJoin(pickOr(typeTokens, rng), pickOr(riskTags, rng)))
      ]
    },
    api: {
      standard: [
        () => formatQueryValue(pickOr(signatures, rng)),
        () => formatQueryValue(maybeJoin(pickOr(names, rng), pickOr(apiHints, rng))),
        () => formatQueryValue(maybeJoin(pickOr(apiHints, rng), pickOr(docs, rng)))
      ],
      adversarial: [
        () => formatQueryValue(`"${pickOr(signatures, rng)}" -legacy`),
        () => formatQueryValue(maybeJoin(pickOr(apiHints, rng), 'OR', pickOr(names, rng)))
      ]
    },
    behavior: {
      standard: [
        () => formatQueryValue(maybeJoin(pickOr(behaviorHints, rng), pickOr(docs, rng))),
        () => formatQueryValue(maybeJoin(pickOr(riskTags, rng), pickOr(behaviorHints, rng))),
        () => formatQueryValue(pickOr(docs, rng))
      ],
      adversarial: [
        () => formatQueryValue(`"${pickOr(behaviorHints, rng)} ${pickOr(docs, rng)}" -todo`),
        () => formatQueryValue(maybeJoin(pickOr(riskTags, rng), '-', pickOr(riskTags, rng)))
      ]
    }
  };
};

export const generateWeightedQuerySet = ({
  chunks,
  count = 50,
  seed,
  languageFamily = null,
  intentWeights = null,
  adversarialRatio = 0.15
} = {}) => {
  const list = Array.isArray(chunks) ? chunks : [];
  if (!list.length) {
    return {
      languageFamily: 'general',
      intentWeights: normalizeIntentWeights({ languageFamily: 'general', override: intentWeights }),
      intentPlan: {},
      querySet: []
    };
  }
  const queryCount = Math.max(10, Math.min(200, Number(count) || 50));
  const resolvedSeed = String(seed || sha1(`bench-query-generator:${queryCount}:${list.length}`));
  const rng = seedrandom(resolvedSeed);
  const candidates = collectCandidates(list);
  const resolvedFamily = resolveLanguageFamily({
    explicitFamily: languageFamily,
    languages: candidates.languages
  });
  const normalizedWeights = normalizeIntentWeights({
    languageFamily: resolvedFamily,
    override: intentWeights
  });
  const intentPlan = buildIntentPlan({
    count: queryCount,
    intentWeights: normalizedWeights
  });
  const strategiesByIntent = buildIntentStrategies({
    candidates,
    languageFamily: resolvedFamily,
    rng
  });
  const seenQueries = new Set();
  const querySet = [];
  const normalizedAdversarialRatio = Math.max(0, Math.min(0.5, Number(adversarialRatio) || 0));

  const tryPushQuery = (intentClass, variant) => {
    const strategies = strategiesByIntent?.[intentClass]?.[variant] || [];
    if (!strategies.length) return false;
    const attempts = Math.max(8, strategies.length * 3);
    for (let index = 0; index < attempts; index += 1) {
      const strategy = pickOr(strategies, rng);
      const query = typeof strategy === 'function' ? strategy() : null;
      if (!query || seenQueries.has(query)) continue;
      seenQueries.add(query);
      querySet.push({
        query,
        intentClass,
        variant,
        weight: normalizedWeights[intentClass]
      });
      return true;
    }
    return false;
  };

  for (const intentClass of QUERY_INTENT_CLASSES) {
    const target = Math.max(0, intentPlan[intentClass] || 0);
    let emitted = 0;
    let attempts = 0;
    while (emitted < target && attempts < target * 10 + 20) {
      attempts += 1;
      const variant = rng() < normalizedAdversarialRatio ? 'adversarial' : 'standard';
      if (!tryPushQuery(intentClass, variant)) continue;
      emitted += 1;
    }
  }

  let fillAttempts = 0;
  while (querySet.length < queryCount && fillAttempts < queryCount * 40) {
    fillAttempts += 1;
    const intentClass = weightedIntentPick(normalizedWeights, rng);
    const variant = rng() < normalizedAdversarialRatio ? 'adversarial' : 'standard';
    if (!tryPushQuery(intentClass, variant)) {
      if (!tryPushQuery(intentClass, 'standard')) continue;
    }
  }

  return {
    languageFamily: resolvedFamily,
    intentWeights: normalizedWeights,
    intentPlan,
    querySet: querySet.slice(0, queryCount)
  };
};

const resolveCount = (value) => Math.max(10, Math.min(200, Number(value) || 50));

const formatIntentWeightsHeader = (intentWeights = {}) => QUERY_INTENT_CLASSES
  .map((intentClass) => `${intentClass}=${(Number(intentWeights[intentClass]) || 0).toFixed(3)}`)
  .join(', ');

const buildPayload = ({
  generatedAt,
  seed,
  indexDir,
  mode,
  languageFamily,
  intentWeights,
  querySet
}) => {
  const intentCounts = Object.fromEntries(
    QUERY_INTENT_CLASSES.map((intentClass) => [intentClass, 0])
  );
  const variantCounts = { standard: 0, adversarial: 0 };
  for (const entry of querySet) {
    const intentClass = entry?.intentClass;
    if (QUERY_INTENT_CLASSES.includes(intentClass)) {
      intentCounts[intentClass] += 1;
    }
    if (entry?.variant === 'adversarial') variantCounts.adversarial += 1;
    else variantCounts.standard += 1;
  }
  return {
    generatedAt,
    seed,
    indexDir,
    mode,
    count: querySet.length,
    languageFamily,
    intentWeights,
    intentCounts,
    variantCounts,
    querySet,
    queries: querySet.map((entry) => entry.query)
  };
};

export const runQueryGeneratorCli = async (rawArgs = process.argv.slice(2)) => {
  const argv = createCli({
    scriptName: 'bench-query-generator',
    options: {
      repo: { type: 'string' },
      mode: { type: 'string', default: 'code' },
      count: { type: 'number', default: 50 },
      out: { type: 'string' },
      seed: { type: 'string' },
      json: { type: 'boolean', default: false },
      'index-root': { type: 'string' },
      'language-family': { type: 'string' },
      'intent-weights': { type: 'string' },
      'adversarial-ratio': { type: 'number', default: 0.15 }
    },
    argv: ['node', 'tools/bench/query-generator.js', ...(Array.isArray(rawArgs) ? rawArgs : [])]
  }).parse();

  const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
  const mode = String(argv.mode || 'code').toLowerCase();
  const indexRoot = argv['index-root'] ? path.resolve(argv['index-root']) : null;
  const indexDir = getIndexDir(root, mode, userConfig, indexRoot ? { indexRoot } : {});
  const chunks = await loadChunkMeta(indexDir);
  if (!Array.isArray(chunks) || !chunks.length) {
    console.error(`No chunk metadata found at ${indexDir}`);
    process.exit(1);
  }

  const count = resolveCount(argv.count);
  const defaultSeed = sha1(`${indexDir}:${mode}:${chunks.length}:${argv['language-family'] || ''}`);
  const seed = argv.seed || defaultSeed;
  const result = generateWeightedQuerySet({
    chunks,
    count,
    seed,
    languageFamily: argv['language-family'] || null,
    intentWeights: argv['intent-weights'] || null,
    adversarialRatio: argv['adversarial-ratio']
  });

  const payload = buildPayload({
    generatedAt: new Date().toISOString(),
    seed,
    indexDir,
    mode,
    languageFamily: result.languageFamily,
    intentWeights: result.intentWeights,
    querySet: result.querySet
  });

  if (argv.json) {
    const outPath = argv.out ? path.resolve(argv.out) : path.join(root, 'docs', 'benchmarks-queries.json');
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
    console.error(`Wrote ${payload.count} queries to ${outPath}`);
    return;
  }

  const outPath = argv.out
    ? path.resolve(argv.out)
    : path.join(root, 'benchmarks', 'queries', `generated-${mode}.txt`);
  const lines = [
    '# Generated by bench-query-generator',
    `# seed: ${seed}`,
    `# mode: ${mode}`,
    `# language-family: ${payload.languageFamily}`,
    `# intent-weights: ${formatIntentWeightsHeader(payload.intentWeights)}`,
    ...payload.queries
  ];
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, lines.join('\n'));
  console.error(`Wrote ${payload.count} queries to ${outPath}`);
};

const cliEntryHref = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (cliEntryHref === import.meta.url) {
  await runQueryGeneratorCli();
}
