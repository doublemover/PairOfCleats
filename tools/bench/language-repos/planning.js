import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoCacheRoot, resolveRepoDir } from '../language/repos.js';
import { parseCommaList } from '../../shared/text-utils.js';

/**
 * @typedef {object} BenchTaskDescriptor
 * @property {string} language
 * @property {string} label
 * @property {string} tier
 * @property {string} repo
 * @property {string} queriesPath
 * @property {string} [logSlug]
 * @property {string} [repoShortName]
 * @property {boolean} [repoLogNameCollision]
 */

/**
 * @typedef {object} BenchExecutionPlan
 * @property {BenchTaskDescriptor} task
 * @property {string} repoPath
 * @property {string} repoLabel
 * @property {string} tierLabel
 * @property {string} repoCacheRoot
 * @property {string} outDir
 * @property {string} outFile
 * @property {string} fallbackLogSlug
 */

/**
 * Normalize selector tokens so language/tier/repo filters can match
 * case-insensitively across CLI flags and config labels.
 *
 * @param {unknown} value
 * @returns {string}
 */
const normalizeSelectorToken = (value) => String(value || '').trim().toLowerCase();

/**
 * Collect all known tier keys for positional-argument fallback.
 *
 * @param {object} benchConfig
 * @returns {Set<string>}
 */
const collectKnownTiers = (benchConfig) => {
  const tiers = new Set();
  for (const entry of Object.values(benchConfig || {})) {
    for (const tier of Object.keys(entry?.repos || {})) {
      tiers.add(normalizeSelectorToken(tier));
    }
  }
  return tiers;
};

/**
 * Resolve effective tier selection from `--tier` and positional args.
 *
 * @param {{argvTier?:string|string[]|null,positionalArgs?:unknown[],knownTiers:Set<string>}} input
 * @returns {string[]}
 */
const resolveTierFilter = ({ argvTier, positionalArgs, knownTiers }) => {
  let resolved = parseCommaList(argvTier)
    .map(normalizeSelectorToken)
    .filter(Boolean);
  if (!resolved.length && Array.isArray(positionalArgs) && positionalArgs.length) {
    const positionalTiers = positionalArgs
      .map((entry) => normalizeSelectorToken(entry))
      .filter((entry) => knownTiers.has(entry));
    if (positionalTiers.length) resolved = positionalTiers;
  }
  return [...new Set(resolved)];
};

/**
 * Collect selector aliases for a language config entry.
 *
 * @param {string} language
 * @param {object} entry
 * @returns {Set<string>}
 */
const collectLanguageSelectors = (language, entry) => {
  const selectors = new Set();
  selectors.add(normalizeSelectorToken(language));
  const rawLabel = normalizeSelectorToken(entry?.label);
  if (rawLabel) {
    selectors.add(rawLabel);
    for (const part of rawLabel.split(/[\\/,|&()]+/g).map((token) => token.trim()).filter(Boolean)) {
      selectors.add(part);
    }
  }
  return selectors;
};

/**
 * Check whether a config entry matches the selected language tokens.
 *
 * @param {string} language
 * @param {object} entry
 * @param {string[]} languageFilterTokens
 * @returns {boolean}
 */
const matchesLanguageFilter = (language, entry, languageFilterTokens) => {
  if (!languageFilterTokens.length) return true;
  const selectors = collectLanguageSelectors(language, entry);
  for (const token of languageFilterTokens) {
    if (selectors.has(token)) return true;
  }
  return false;
};

/**
 * Expand bench config into per-repo tasks after applying CLI filters.
 * Query-file existence checks are cached to avoid repeated fs lookups when
 * multiple config rows resolve to the same query file.
 *
 * @param {{benchConfig:object,argv:object,scriptRoot:string}} input
 * @returns {BenchTaskDescriptor[]}
 */
export const buildTaskCatalog = ({ benchConfig, argv, scriptRoot }) => {
  const languageFilterTokens = parseCommaList(argv.languages || argv.language)
    .map(normalizeSelectorToken)
    .filter(Boolean);
  const tierFilter = resolveTierFilter({
    argvTier: argv.tier,
    positionalArgs: argv._,
    knownTiers: collectKnownTiers(benchConfig)
  });
  const tierFilterSet = new Set(tierFilter);
  const hasTierFilter = tierFilterSet.size > 0;
  const repoFilterSet = new Set(
    parseCommaList(argv.only || argv.repos)
      .map((entry) => String(entry || '').toLowerCase())
      .filter(Boolean)
  );
  const hasRepoFilter = repoFilterSet.size > 0;
  const queryOverridePath = argv.queries ? path.resolve(argv.queries) : null;
  const queryExistsCache = new Map();
  const requireQueriesPath = (queriesPath) => {
    if (!queryExistsCache.has(queriesPath)) {
      queryExistsCache.set(queriesPath, fs.existsSync(queriesPath));
    }
    if (queryExistsCache.get(queriesPath) !== true) {
      throw new Error(`Missing queries file: ${queriesPath}`);
    }
  };

  const plannedTasks = [];
  for (const [language, entry] of Object.entries(benchConfig || {})) {
    if (!matchesLanguageFilter(language, entry, languageFilterTokens)) continue;
    const queriesPath = queryOverridePath || path.resolve(scriptRoot, entry.queries || '');
    requireQueriesPath(queriesPath);
    for (const [tier, repos] of Object.entries(entry?.repos || {})) {
      if (hasTierFilter && !tierFilterSet.has(normalizeSelectorToken(tier))) continue;
      for (const repo of repos) {
        if (hasRepoFilter && !repoFilterSet.has(String(repo || '').toLowerCase())) continue;
        plannedTasks.push({
          language,
          label: entry.label || language,
          tier,
          repo,
          queriesPath
        });
      }
    }
  }
  return plannedTasks;
};

/**
 * In-place Fisher-Yates shuffle used by `--random` execution mode.
 *
 * @template T
 * @param {T[]} items
 * @returns {void}
 */
export const shuffleInPlace = (items) => {
  for (let idx = items.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    if (swapIdx === idx) continue;
    const temp = items[idx];
    items[idx] = items[swapIdx];
    items[swapIdx] = temp;
  }
};

export const toSafeLogSlug = (value) => String(value || '')
  .replace(/[^a-z0-9-_]+/gi, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();

export const getRepoShortName = (repo) => {
  if (!repo) return '';
  return String(repo).split('/').filter(Boolean).pop() || String(repo);
};

/**
 * Count slug collisions.
 *
 * @param {string[]} slugs
 * @returns {Map<string,number>}
 */
const countSlugs = (slugs) => {
  const counts = new Map();
  for (const slug of slugs) {
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return counts;
};

/**
 * Assign deterministic per-task log slug metadata while avoiding filename
 * collisions across repo names, languages, and tiers.
 *
 * @param {{plannedTasks:BenchTaskDescriptor[],repoLogsEnabled:boolean}} input
 * @returns {void}
 */
export const assignRepoLogMetadata = ({ plannedTasks, repoLogsEnabled }) => {
  if (!repoLogsEnabled || !plannedTasks.length) return;
  const slugPlans = plannedTasks.map((task) => {
    const repoShortName = getRepoShortName(task.repo);
    const baseSlug = toSafeLogSlug(repoShortName) || 'repo';
    const fullSlugRaw = String(task.repo || '').replace(/[\\/]+/g, '__');
    const fullSlug = toSafeLogSlug(fullSlugRaw) || 'repo';
    const languageSlug = toSafeLogSlug(task.language);
    const tierSlug = toSafeLogSlug(task.tier);
    return {
      task,
      repoShortName,
      baseSlug,
      fullSlug,
      languageSlug,
      tierSlug
    };
  });
  const baseCounts = countSlugs(slugPlans.map((plan) => plan.baseSlug));
  const fullCounts = countSlugs(slugPlans.map((plan) => plan.fullSlug));
  const initial = slugPlans.map((plan) => {
    if (plan.baseSlug && baseCounts.get(plan.baseSlug) === 1) return plan.baseSlug;
    return plan.fullSlug || plan.baseSlug || 'repo';
  });
  const initialCounts = countSlugs(initial);
  const withLang = slugPlans.map((plan, idx) => {
    const slug = initial[idx] || 'repo';
    if (initialCounts.get(slug) === 1) return slug;
    return [slug, plan.languageSlug].filter(Boolean).join('-');
  });
  const withLangCounts = countSlugs(withLang);
  const withTier = slugPlans.map((plan, idx) => {
    const slug = withLang[idx] || 'repo';
    if (withLangCounts.get(slug) === 1) return slug;
    return [slug, plan.tierSlug].filter(Boolean).join('-');
  });
  const withTierCounts = countSlugs(withTier);
  for (let idx = 0; idx < slugPlans.length; idx += 1) {
    const plan = slugPlans[idx];
    const slug = withTier[idx] || 'repo';
    plan.task.logSlug = withTierCounts.get(slug) === 1 ? slug : `${slug}-${idx + 1}`;
    plan.task.repoShortName = plan.repoShortName;
    if ((fullCounts.get(plan.fullSlug) || 0) > 1) {
      plan.task.repoLogNameCollision = true;
    }
  }
};

/**
 * Build repo execution plans while caching repeated path derivations.
 * This keeps large target sets from repeatedly resolving identical repo and
 * output-directory paths.
 *
 * @param {{
 *   tasks:BenchTaskDescriptor[],
 *   reposRoot:string,
 *   resultsRoot:string,
 *   cacheRoot:string
 * }} input
 * @returns {{executionPlans:BenchExecutionPlan[],precreateDirs:string[]}}
 */
export const buildExecutionPlans = ({ tasks, reposRoot, resultsRoot, cacheRoot }) => {
  const repoPathCache = new Map();
  const repoCacheRootCache = new Map();
  const outDirCache = new Map();
  const precreateDirs = new Set();

  const executionPlans = tasks.map((task) => {
    const repoKey = `${task.language}:${task.repo}`;
    let repoPath = repoPathCache.get(repoKey);
    if (!repoPath) {
      repoPath = resolveRepoDir({ reposRoot, repo: task.repo, language: task.language });
      repoPathCache.set(repoKey, repoPath);
    }

    let outDir = outDirCache.get(task.language);
    if (!outDir) {
      outDir = path.join(resultsRoot, task.language);
      outDirCache.set(task.language, outDir);
    }

    let repoCacheRoot = repoCacheRootCache.get(repoPath);
    if (!repoCacheRoot) {
      repoCacheRoot = resolveRepoCacheRoot({ repoPath, cacheRoot });
      repoCacheRootCache.set(repoPath, repoCacheRoot);
    }

    precreateDirs.add(path.dirname(repoPath));
    precreateDirs.add(outDir);

    return {
      task,
      repoPath,
      repoLabel: `${task.language}/${task.repo}`,
      tierLabel: String(task.tier || '').trim(),
      repoCacheRoot,
      outDir,
      outFile: path.join(outDir, `${task.repo.replace('/', '__')}.json`),
      fallbackLogSlug: task.logSlug || toSafeLogSlug(getRepoShortName(task.repo)) || 'repo'
    };
  });

  return {
    executionPlans,
    precreateDirs: [...precreateDirs]
  };
};
