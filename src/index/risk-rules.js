import fs from 'node:fs';
import path from 'node:path';
import { compileSafeRegex, normalizeSafeRegexConfig } from '../shared/safe-regex.js';
import { isAbsolutePathNative } from '../shared/files.js';
import { toArray } from '../shared/iterables.js';

const DEFAULT_RULES = {
  version: '1.0.0',
  sources: [
    {
      id: 'source.req.body',
      name: 'req.body',
      category: 'input',
      tags: ['http-input'],
      confidence: 0.6,
      patterns: ['\\breq\\.body\\b', '\\brequest\\.body\\b']
    },
    {
      id: 'source.req.headers',
      name: 'req.headers',
      category: 'input',
      tags: ['http-input'],
      confidence: 0.6,
      patterns: ['\\breq\\.headers\\b', '\\brequest\\.headers\\b']
    },
    {
      id: 'source.req.cookies',
      name: 'req.cookies',
      category: 'input',
      tags: ['http-input'],
      confidence: 0.6,
      patterns: ['\\breq\\.cookies\\b', '\\brequest\\.cookies\\b']
    },
    {
      id: 'source.ctx.request.body',
      name: 'ctx.request.body',
      category: 'input',
      tags: ['http-input'],
      confidence: 0.6,
      patterns: ['\\bctx\\.request\\.body\\b']
    },
    {
      id: 'source.event.body',
      name: 'event.body',
      category: 'input',
      tags: ['http-input'],
      confidence: 0.6,
      patterns: ['\\bevent\\.body\\b']
    },
    {
      id: 'source.req.query',
      name: 'req.query',
      category: 'input',
      tags: ['http-input'],
      confidence: 0.6,
      patterns: ['\\breq\\.query\\b', '\\brequest\\.query\\b']
    },
    {
      id: 'source.req.params',
      name: 'req.params',
      category: 'input',
      tags: ['http-input'],
      confidence: 0.6,
      patterns: ['\\breq\\.params\\b', '\\brequest\\.params\\b']
    },
    {
      id: 'source.process.env',
      name: 'process.env',
      category: 'config',
      tags: ['env'],
      confidence: 0.55,
      patterns: [
        '\\bprocess\\.env\\b',
        '\\bos\\.environ\\b',
        '\\bSystem\\.getenv\\b',
        '\\bos\\.Getenv\\b',
        '\\bEnvironment\\.GetEnvironmentVariable\\b'
      ]
    },
    {
      id: 'source.argv',
      name: 'argv',
      category: 'input',
      tags: ['cli-input'],
      confidence: 0.55,
      patterns: ['\\bprocess\\.argv\\b', '\\bsys\\.argv\\b', '\\bos\\.Args\\b']
    },
    {
      id: 'source.stdin',
      name: 'stdin',
      category: 'input',
      tags: ['stdin'],
      confidence: 0.5,
      patterns: ['\\binput\\s*\\(', '\\breadline\\s*\\(', '\\bConsole\\.ReadLine\\b']
    },
    {
      id: 'source.location',
      name: 'location',
      category: 'input',
      tags: ['browser-input'],
      confidence: 0.5,
      patterns: ['\\bwindow\\.location\\b', '\\bdocument\\.location\\b', '\\blocation\\.(href|search|hash)\\b']
    }
  ],
  sinks: [
    {
      id: 'sink.eval',
      name: 'eval',
      category: 'code-exec',
      severity: 'high',
      tags: ['eval', 'code-exec'],
      confidence: 0.8,
      patterns: ['\\beval\\s*\\(', '\\bnew\\s+Function\\s*\\(']
    },
    {
      id: 'sink.exec',
      name: 'exec',
      category: 'command',
      severity: 'high',
      tags: ['command-exec'],
      confidence: 0.8,
      patterns: [
        '\\bchild_process\\.exec\\s*\\(',
        '\\bchild_process\\.execFile\\s*\\(',
        '\\bexecFileSync\\s*\\(',
        '\\bexecSync\\s*\\(',
        '\\bexec\\s*\\('
      ]
    },
    {
      id: 'sink.spawn',
      name: 'spawn',
      category: 'command',
      severity: 'high',
      tags: ['command-exec'],
      confidence: 0.75,
      patterns: ['\\bspawnSync\\s*\\(', '\\bspawn\\s*\\(']
    },
    {
      id: 'sink.file.write',
      name: 'file.write',
      category: 'file-write',
      severity: 'medium',
      tags: ['file-write'],
      confidence: 0.7,
      patterns: [
        '\\bfs\\.writeFileSync\\s*\\(',
        '\\bfs\\.writeFile\\s*\\(',
        '\\bfs\\.appendFileSync\\s*\\(',
        '\\bfs\\.appendFile\\s*\\(',
        '\\bFile\\.WriteAllText\\b',
        '\\bFile\\.AppendAllText\\b'
      ]
    },
    {
      id: 'sink.sql.query',
      name: 'sql.query',
      category: 'sql',
      severity: 'medium',
      tags: ['sql'],
      confidence: 0.7,
      requires: '\\b(select|insert|update|delete|from|where)\\b',
      patterns: ['\\b(query|execute|prepare|exec)\\s*\\(']
    },
    {
      id: 'sink.innerHTML',
      name: 'innerHTML',
      category: 'xss',
      severity: 'medium',
      tags: ['xss'],
      confidence: 0.7,
      patterns: ['\\binnerHTML\\b', '\\bdocument\\.write\\b', '\\bdangerouslySetInnerHTML\\b']
    },
    {
      id: 'sink.deserialize',
      name: 'deserialize',
      category: 'deserialization',
      severity: 'high',
      tags: ['deserialization'],
      confidence: 0.8,
      patterns: ['\\bpickle\\.loads\\b', '\\byaml\\.load\\b', '\\byaml\\.unsafe_load\\b', '\\bObjectInputStream\\b']
    }
  ],
  sanitizers: [
    {
      id: 'sanitize.escape',
      name: 'escape',
      category: 'sanitize',
      tags: ['sanitize'],
      confidence: 0.55,
      patterns: ['\\bescape\\s*\\(', '\\bencodeURIComponent\\s*\\(', '\\bhtmlspecialchars\\s*\\(']
    },
    {
      id: 'sanitize.parameterize',
      name: 'parameterize',
      category: 'sanitize',
      tags: ['sanitize'],
      confidence: 0.6,
      patterns: ['\\bprepare\\s*\\(', '\\bparameterize\\s*\\(', '\\bbind\\w*\\s*\\(']
    }
  ]
};

const normalizeRule = (rule, fallbackType) => {
  if (!rule || typeof rule !== 'object') return null;
  const name = typeof rule.name === 'string' ? rule.name.trim() : '';
  const patterns = Array.isArray(rule.patterns) ? rule.patterns : [];
  if (!name || !patterns.length) return null;
  return {
    id: typeof rule.id === 'string' ? rule.id.trim() : `${fallbackType}:${name}`,
    type: rule.type || fallbackType,
    name,
    category: typeof rule.category === 'string' ? rule.category : null,
    severity: typeof rule.severity === 'string' ? rule.severity : null,
    tags: Array.isArray(rule.tags) ? rule.tags.filter(Boolean) : [],
    confidence: Number.isFinite(rule.confidence) ? rule.confidence : null,
    languages: Array.isArray(rule.languages) ? rule.languages.filter(Boolean) : null,
    patterns: patterns.filter(Boolean),
    requires: typeof rule.requires === 'string' ? rule.requires : null
  };
};

const normalizeRuleList = (list, type) => {
  const normalized = [];
  for (const entry of toArray(list)) {
    const rule = normalizeRule(entry, type);
    if (rule) normalized.push(rule);
  }
  return normalized;
};

const MAX_DIAGNOSTICS = 50;

const createDiagnostics = (limit = MAX_DIAGNOSTICS) => ({
  warnings: [],
  limit
});

const appendDiagnostic = (diagnostics, kind, detail) => {
  if (!diagnostics || !detail) return;
  const list = diagnostics[kind];
  if (!Array.isArray(list)) return;
  if (list.length >= (diagnostics.limit || MAX_DIAGNOSTICS)) return;
  list.push(detail);
};

const buildDiagnostic = ({ error, rule, pattern, flags, field }) => ({
  code: error?.code || 'UNKNOWN',
  message: error?.message || 'Regex compilation failed.',
  ruleId: rule?.id || null,
  ruleType: rule?.type || null,
  ruleName: rule?.name || null,
  field: field || null,
  pattern: typeof pattern === 'string' ? pattern : String(pattern ?? ''),
  flags: flags || ''
});

const extractPrefilter = (pattern) => {
  const source = typeof pattern === 'string' ? pattern : pattern?.source;
  if (!source) return null;
  const scrubbed = source.replace(/\\./g, ' ');
  const tokens = scrubbed.match(/[A-Za-z0-9_$]{3,}/g);
  if (!tokens || !tokens.length) return null;
  tokens.sort((a, b) => b.length - a.length);
  return tokens[0] || null;
};

const compilePattern = (pattern, flags, regexConfig, diagnostics, rule, field) => {
  const compiledResult = compileSafeRegex(pattern, flags, regexConfig);
  const compiled = compiledResult.regex;
  if (!compiled) {
    if (compiledResult.error) {
      appendDiagnostic(
        diagnostics,
        'warnings',
        buildDiagnostic({ error: compiledResult.error, rule, pattern, flags, field })
      );
    }
    return null;
  }
  const prefilter = extractPrefilter(pattern);
  if (prefilter) {
    compiled.prefilter = prefilter;
    if (compiled.flags && compiled.flags.includes('i')) {
      compiled.prefilterLower = prefilter.toLowerCase();
    }
  }
  return compiled;
};

const compileRule = (rule, regexConfig, diagnostics) => ({
  ...rule,
  patterns: rule.patterns
    .map((pattern) => compilePattern(pattern, '', regexConfig, diagnostics, rule, 'patterns'))
    .filter(Boolean),
  requires: rule.requires
    ? compilePattern(rule.requires, '', regexConfig, diagnostics, rule, 'requires')
    : null
});

const mergeRules = (baseList, overrideList) => {
  const byId = new Map(baseList.map((entry) => [entry.id, entry]));
  for (const entry of overrideList) {
    byId.set(entry.id, entry);
  }
  return Array.from(byId.values());
};

const resolveRulesFromPath = (rootDir, rulesPath) => {
  if (!rulesPath || typeof rulesPath !== 'string') return null;
  const absPath = isAbsolutePathNative(rulesPath) ? rulesPath : path.join(rootDir, rulesPath);
  if (!fs.existsSync(absPath)) return null;
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...parsed, sourcePath: absPath } : null;
  } catch {
    return null;
  }
};

export const normalizeRiskRules = (input = {}, { rootDir, regexConfig } = {}) => {
  const config = input && typeof input === 'object' ? input : {};
  const regexConfigRaw = regexConfig || config.regex || config.safeRegex || {};
  const regexConfigBase = regexConfigRaw && typeof regexConfigRaw === 'object' ? { ...regexConfigRaw } : {};
  if (!Object.prototype.hasOwnProperty.call(regexConfigBase, 'flags')) {
    regexConfigBase.flags = 'i';
  }
  const safeRegexConfig = normalizeSafeRegexConfig(regexConfigBase);
  const includeDefaults = config.includeDefaults !== false;
  const overrideBundle = resolveRulesFromPath(rootDir || process.cwd(), config.rulesPath);
  const inlineRules = config.rules && typeof config.rules === 'object' ? config.rules : {};
  const base = includeDefaults ? DEFAULT_RULES : { sources: [], sinks: [], sanitizers: [] };
  const diagnostics = createDiagnostics();

  const sources = mergeRules(
    normalizeRuleList(base.sources, 'source'),
    normalizeRuleList([...toArray(overrideBundle?.sources), ...toArray(inlineRules.sources)], 'source')
  );
  const sinks = mergeRules(
    normalizeRuleList(base.sinks, 'sink'),
    normalizeRuleList([...toArray(overrideBundle?.sinks), ...toArray(inlineRules.sinks)], 'sink')
  );
  const sanitizers = mergeRules(
    normalizeRuleList(base.sanitizers, 'sanitizer'),
    normalizeRuleList([...toArray(overrideBundle?.sanitizers), ...toArray(inlineRules.sanitizers)], 'sanitizer')
  );

  const bundle = {
    version: overrideBundle?.version || base.version || '1.0.0',
    sources: sources.map((rule) => compileRule(rule, regexConfigBase, diagnostics)),
    sinks: sinks.map((rule) => compileRule(rule, regexConfigBase, diagnostics)),
    sanitizers: sanitizers.map((rule) => compileRule(rule, regexConfigBase, diagnostics)),
    regexConfig: safeRegexConfig,
    diagnostics: {
      warnings: diagnostics.warnings
    },
    provenance: {
      defaults: includeDefaults,
      sourcePath: overrideBundle?.sourcePath || null
    }
  };

  return bundle;
};

const serializePattern = (pattern) => {
  if (!pattern) return null;
  if (typeof pattern === 'string') return pattern;
  if (typeof pattern.source === 'string') return pattern.source;
  return null;
};

const serializeRule = (rule) => ({
  id: typeof rule?.id === 'string' ? rule.id : null,
  type: typeof rule?.type === 'string' ? rule.type : null,
  name: typeof rule?.name === 'string' ? rule.name : null,
  category: typeof rule?.category === 'string' ? rule.category : null,
  severity: typeof rule?.severity === 'string' ? rule.severity : null,
  tags: Array.isArray(rule?.tags) ? rule.tags.filter(Boolean) : [],
  confidence: Number.isFinite(rule?.confidence) ? rule.confidence : null,
  languages: Array.isArray(rule?.languages) ? rule.languages.filter(Boolean) : null,
  patterns: Array.isArray(rule?.patterns)
    ? rule.patterns.map(serializePattern).filter(Boolean)
    : [],
  requires: rule?.requires ? serializePattern(rule.requires) : null
});

export const serializeRiskRulesBundle = (bundle) => {
  if (!bundle || typeof bundle !== 'object') return null;
  return {
    version: typeof bundle.version === 'string' ? bundle.version : '1.0.0',
    sources: Array.isArray(bundle.sources) ? bundle.sources.map(serializeRule) : [],
    sinks: Array.isArray(bundle.sinks) ? bundle.sinks.map(serializeRule) : [],
    sanitizers: Array.isArray(bundle.sanitizers) ? bundle.sanitizers.map(serializeRule) : [],
    regexConfig: bundle.regexConfig || null,
    diagnostics: bundle.diagnostics || null,
    provenance: bundle.provenance || null
  };
};
