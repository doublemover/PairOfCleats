import fs from 'node:fs';
import path from 'node:path';

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
  for (const entry of list || []) {
    const rule = normalizeRule(entry, type);
    if (rule) normalized.push(rule);
  }
  return normalized;
};

const compilePattern = (pattern, flags = 'i') => {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
};

const compileRule = (rule) => ({
  ...rule,
  patterns: rule.patterns.map((pattern) => compilePattern(pattern)).filter(Boolean),
  requires: rule.requires ? compilePattern(rule.requires) : null
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
  const absPath = path.isAbsolute(rulesPath) ? rulesPath : path.join(rootDir, rulesPath);
  if (!fs.existsSync(absPath)) return null;
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...parsed, sourcePath: absPath } : null;
  } catch {
    return null;
  }
};

export const normalizeRiskRules = (input = {}, { rootDir } = {}) => {
  const config = input && typeof input === 'object' ? input : {};
  const includeDefaults = config.includeDefaults !== false;
  const overrideBundle = resolveRulesFromPath(rootDir || process.cwd(), config.rulesPath);
  const inlineRules = config.rules && typeof config.rules === 'object' ? config.rules : {};
  const base = includeDefaults ? DEFAULT_RULES : { sources: [], sinks: [], sanitizers: [] };

  const sources = mergeRules(
    normalizeRuleList(base.sources, 'source'),
    normalizeRuleList([...(overrideBundle?.sources || []), ...(inlineRules.sources || [])], 'source')
  );
  const sinks = mergeRules(
    normalizeRuleList(base.sinks, 'sink'),
    normalizeRuleList([...(overrideBundle?.sinks || []), ...(inlineRules.sinks || [])], 'sink')
  );
  const sanitizers = mergeRules(
    normalizeRuleList(base.sanitizers, 'sanitizer'),
    normalizeRuleList([...(overrideBundle?.sanitizers || []), ...(inlineRules.sanitizers || [])], 'sanitizer')
  );

  const bundle = {
    version: overrideBundle?.version || base.version || '1.0.0',
    sources: sources.map(compileRule),
    sinks: sinks.map(compileRule),
    sanitizers: sanitizers.map(compileRule),
    provenance: {
      defaults: includeDefaults,
      sourcePath: overrideBundle?.sourcePath || null
    }
  };

  return bundle;
};
