const SOURCE_PATTERNS = [
  {
    name: 'req.body',
    category: 'input',
    tags: ['http-input'],
    patterns: [/\breq\.body\b/i, /\brequest\.body\b/i]
  },
  {
    name: 'req.headers',
    category: 'input',
    tags: ['http-input'],
    patterns: [/\breq\.headers\b/i, /\brequest\.headers\b/i]
  },
  {
    name: 'req.cookies',
    category: 'input',
    tags: ['http-input'],
    patterns: [/\breq\.cookies\b/i, /\brequest\.cookies\b/i]
  },
  {
    name: 'ctx.request.body',
    category: 'input',
    tags: ['http-input'],
    patterns: [/\bctx\.request\.body\b/i]
  },
  {
    name: 'event.body',
    category: 'input',
    tags: ['http-input'],
    patterns: [/\bevent\.body\b/i]
  },
  {
    name: 'req.query',
    category: 'input',
    tags: ['http-input'],
    patterns: [/\breq\.query\b/i, /\brequest\.query\b/i]
  },
  {
    name: 'req.params',
    category: 'input',
    tags: ['http-input'],
    patterns: [/\breq\.params\b/i, /\brequest\.params\b/i]
  },
  {
    name: 'process.env',
    category: 'config',
    tags: ['env'],
    patterns: [
      /\bprocess\.env\b/i,
      /\bos\.environ\b/i,
      /\bSystem\.getenv\b/i,
      /\bos\.Getenv\b/i,
      /\bEnvironment\.GetEnvironmentVariable\b/i
    ]
  },
  {
    name: 'argv',
    category: 'input',
    tags: ['cli-input'],
    patterns: [/\bprocess\.argv\b/i, /\bsys\.argv\b/i, /\bos\.Args\b/i]
  },
  {
    name: 'stdin',
    category: 'input',
    tags: ['stdin'],
    patterns: [/\binput\s*\(/i, /\breadline\s*\(/i, /\bConsole\.ReadLine\b/i]
  },
  {
    name: 'location',
    category: 'input',
    tags: ['browser-input'],
    patterns: [/\bwindow\.location\b/i, /\bdocument\.location\b/i, /\blocation\.(href|search|hash)\b/i]
  }
];

const SQL_KEYWORDS = /\b(select|insert|update|delete|from|where)\b/i;

const SINK_PATTERNS = [
  {
    name: 'eval',
    category: 'code-exec',
    severity: 'high',
    tags: ['eval', 'code-exec'],
    patterns: [/\beval\s*\(/i, /\bnew\s+Function\s*\(/i]
  },
  {
    name: 'exec',
    category: 'command',
    severity: 'high',
    tags: ['command-exec'],
    patterns: [
      /\bchild_process\.exec\s*\(/i,
      /\bchild_process\.execFile\s*\(/i,
      /\bexecFileSync\s*\(/i,
      /\bexecSync\s*\(/i,
      /\bexec\s*\(/i
    ]
  },
  {
    name: 'spawn',
    category: 'command',
    severity: 'high',
    tags: ['command-exec'],
    patterns: [/\bspawnSync\s*\(/i, /\bspawn\s*\(/i]
  },
  {
    name: 'system',
    category: 'command',
    severity: 'high',
    tags: ['command-exec'],
    patterns: [
      /\bos\.system\s*\(/i,
      /\bsubprocess\.(run|call|popen)\s*\(/i,
      /\bpopen\s*\(/i,
      /\bRuntime\.getRuntime\(\)\.exec\s*\(/i
    ]
  },
  {
    name: 'file.write',
    category: 'file-write',
    severity: 'medium',
    tags: ['file-write'],
    patterns: [
      /\bfs\.writeFileSync\s*\(/i,
      /\bfs\.writeFile\s*\(/i,
      /\bfs\.appendFileSync\s*\(/i,
      /\bfs\.appendFile\s*\(/i,
      /\bFile\.WriteAllText\b/i,
      /\bFile\.AppendAllText\b/i
    ]
  },
  {
    name: 'sql.query',
    category: 'sql',
    severity: 'medium',
    tags: ['sql'],
    requires: SQL_KEYWORDS,
    patterns: [/\b(query|execute|prepare|exec)\s*\(/i]
  },
  {
    name: 'innerHTML',
    category: 'xss',
    severity: 'medium',
    tags: ['xss'],
    patterns: [/\binnerHTML\b/i, /\bdocument\.write\b/i, /\bdangerouslySetInnerHTML\b/i]
  },
  {
    name: 'deserialize',
    category: 'deserialization',
    severity: 'high',
    tags: ['deserialization'],
    patterns: [
      /\bpickle\.loads\b/i,
      /\byaml\.load\b/i,
      /\byaml\.unsafe_load\b/i,
      /\bObjectInputStream\b/i
    ]
  }
];

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

function collectMatches(text, entries) {
  const matches = [];
  for (const entry of entries) {
    if (entry.requires && !entry.requires.test(text)) continue;
    let matched = false;
    for (const pattern of entry.patterns || []) {
      if (pattern.test(text)) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;
    matches.push({
      name: entry.name,
      category: entry.category,
      tags: entry.tags || [],
      severity: entry.severity || null
    });
  }
  return matches;
}

function dedupeByName(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = entry.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function maxSeverity(entries) {
  let best = null;
  let bestRank = 0;
  for (const entry of entries) {
    const rank = SEVERITY_RANK[entry.severity] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = entry.severity;
    }
  }
  return best || null;
}

/**
 * Detect taint-like risk signals in a chunk.
 * @param {{text:string}} input
 * @returns {object|null}
 */
export function detectRiskSignals({ text }) {
  if (!text) return null;
  const sources = collectMatches(text, SOURCE_PATTERNS);
  const sinks = collectMatches(text, SINK_PATTERNS);
  if (!sources.length && !sinks.length) return null;

  const dedupedSources = dedupeByName(sources);
  const dedupedSinks = dedupeByName(sinks);
  const flows = [];
  if (dedupedSources.length && dedupedSinks.length) {
    for (const source of dedupedSources) {
      for (const sink of dedupedSinks) {
        flows.push({
          source: source.name,
          sink: sink.name,
          category: sink.category,
          severity: sink.severity || null
        });
      }
    }
  }

  const tags = new Set();
  const categories = new Set();
  dedupedSources.forEach((entry) => (entry.tags || []).forEach((tag) => tags.add(tag)));
  dedupedSinks.forEach((entry) => {
    (entry.tags || []).forEach((tag) => tags.add(tag));
    if (entry.category) categories.add(entry.category);
  });

  return {
    tags: Array.from(tags),
    categories: Array.from(categories),
    severity: maxSeverity(dedupedSinks) || (dedupedSources.length ? 'low' : null),
    sources: dedupedSources.map(({ name, category, tags: entryTags }) => ({
      name,
      category,
      tags: entryTags || []
    })),
    sinks: dedupedSinks.map(({ name, category, severity, tags: entryTags }) => ({
      name,
      category,
      severity,
      tags: entryTags || []
    })),
    flows: flows.map((flow) => ({ ...flow, scope: 'local' }))
  };
}
