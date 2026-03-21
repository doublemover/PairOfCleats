import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';

const PROFILE_CHOICES = ['overview', 'compare', 'repo', 'family', 'raw'];
const SORT_CHOICES = [
  'name',
  'chunks',
  'files',
  'lines',
  'build',
  'query',
  'search',
  'variability',
  'regressions'
];

const toResolvedRoot = (cwd, rootValue) => {
  const candidate = String(rootValue || '').trim();
  if (!candidate) return path.join(cwd, 'benchmarks', 'results');
  return path.resolve(cwd, candidate);
};

const toOptionalString = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

const toOptionalPositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
};

const normalizeChoice = (value, allowed, fallback) => {
  const text = String(value || '').trim().toLowerCase();
  if (allowed.includes(text)) return text;
  return fallback;
};

const createShowThroughputCli = ({ argv = process.argv, cwd = process.cwd() } = {}) => createCli({
  argv,
  scriptName: 'pairofcleats report throughput',
  usage: '$0 [options]',
  options: {
    root: {
      type: 'string',
      default: path.join(cwd, 'benchmarks', 'results'),
      describe: 'Benchmark results root to inspect.'
    },
    folder: {
      type: 'string',
      default: '',
      describe: 'Restrict to a single results folder.'
    },
    repo: {
      type: 'string',
      default: '',
      describe: 'Restrict to repos whose file label or repo root contains this text.'
    },
    language: {
      type: 'string',
      default: '',
      describe: 'Alias for --folder when filtering language/result families.'
    },
    mode: {
      type: 'string',
      default: '',
      describe: 'Restrict focused views to a single indexing mode (code, prose, extracted-prose, records).'
    },
    latest: {
      type: 'number',
      default: 0,
      describe: 'Keep only the latest N runs per folder after sorting by generatedAt.'
    },
    sort: {
      type: 'string',
      default: 'regressions',
      describe: 'Sort metric for focused profiles.',
      choices: SORT_CHOICES
    },
    top: {
      type: 'number',
      default: 10,
      describe: 'Row limit for focused profile tables.'
    },
    profile: {
      type: 'string',
      default: 'overview',
      describe: 'Output profile.',
      choices: PROFILE_CHOICES
    },
    compare: {
      type: 'string',
      default: '',
      describe: 'Compare against another results root or a sibling folder name.'
    },
    json: {
      type: 'boolean',
      default: false,
      describe: 'Emit JSON instead of the text overview.'
    },
    csv: {
      type: 'boolean',
      default: false,
      describe: 'Emit CSV for focused table output.'
    },
    verbose: {
      type: 'boolean',
      default: false,
      describe: 'Include deeper internals and long row dumps.'
    },
    'deep-analysis': {
      type: 'boolean',
      default: false,
      describe: 'Allow deeper fallback analysis when build-state details are needed.'
    },
    'include-usr': {
      type: 'boolean',
      default: false,
      describe: 'Include auxiliary usr guardrail folders.'
    },
    'refresh-json': {
      type: 'boolean',
      default: false,
      describe: 'Deprecated; use materialize-throughput instead.'
    }
  }
})
  .strictOptions();

export const resolveShowThroughputOptions = ({
  argv = process.argv,
  cwd = process.cwd()
} = {}) => {
  const parsed = createShowThroughputCli({ argv, cwd }).parse();
  const folder = toOptionalString(parsed.folder);
  const language = toOptionalString(parsed.language);
  const compare = toOptionalString(parsed.compare);
  return {
    resultsRoot: toResolvedRoot(cwd, parsed.root),
    compareRoot: compare ? path.resolve(cwd, compare) : null,
    refreshJson: parsed['refresh-json'] === true,
    deepAnalysis: parsed['deep-analysis'] === true,
    verboseOutput: parsed.verbose === true,
    includeUsrGuardrails: parsed['include-usr'] === true,
    folderFilter: folder || language,
    repoFilter: toOptionalString(parsed.repo),
    languageFilter: language,
    modeFilter: toOptionalString(parsed.mode),
    latestCount: toOptionalPositiveInt(parsed.latest),
    sortMetric: normalizeChoice(parsed.sort, SORT_CHOICES, 'regressions'),
    topN: toOptionalPositiveInt(parsed.top) || 10,
    profile: normalizeChoice(parsed.profile, PROFILE_CHOICES, 'overview'),
    jsonOutput: parsed.json === true,
    csvOutput: parsed.csv === true
  };
};

export const resolveThroughputMaterializeOptions = ({
  argv = process.argv,
  cwd = process.cwd()
} = {}) => {
  const parsed = createShowThroughputCli({ argv, cwd }).parse();
  return {
    resultsRoot: toResolvedRoot(cwd, parsed.root),
    deepAnalysis: parsed['deep-analysis'] === true,
    verboseOutput: parsed.verbose === true,
    includeUsrGuardrails: parsed['include-usr'] === true
  };
};

export const validateResultsRoot = (resultsRoot) => (
  typeof resultsRoot === 'string'
  && resultsRoot.length > 0
  && fs.existsSync(resultsRoot)
);
