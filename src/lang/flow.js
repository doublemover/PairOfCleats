/**
 * Shared control-flow and dataflow heuristics.
 */
const DEFAULT_ASSIGNMENT_OPERATORS = [
  '<<=', '>>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', ':=', '='
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Normalize text for flow scanning by removing comparison operators.
 * @param {string} text
 * @returns {string}
 */
export function normalizeFlowText(text) {
  return text.replace(/==|!=|<=|>=|=>/g, ' ');
}

/**
 * Convert a set to a stable, sorted array.
 * @param {Set<string>} set
 * @returns {string[]}
 */
export function sortedUnique(set) {
  return Array.from(set).sort();
}

/**
 * Extract write/mutation targets from assignment expressions.
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.identifierPattern]
 * @param {string[]} [options.memberOperators]
 * @param {string[]} [options.assignmentOperators]
 * @param {boolean} [options.allowIndex]
 * @returns {{writes:Set<string>,mutations:Set<string>}}
 */
export function extractWritesAndMutations(text, options = {}) {
  const identifierPattern = options.identifierPattern || '[A-Za-z_][A-Za-z0-9_]*';
  const memberOperators = Array.isArray(options.memberOperators)
    ? options.memberOperators
    : ['.', '->', '::'];
  const assignmentOperators = Array.isArray(options.assignmentOperators)
    ? options.assignmentOperators
    : DEFAULT_ASSIGNMENT_OPERATORS;
  const allowIndex = options.allowIndex !== false;

  const cleaned = normalizeFlowText(text);
  const memberOps = memberOperators.length
    ? memberOperators.map(escapeRegExp).join('|')
    : '';
  const memberPart = memberOps ? `(?:\\s*(?:${memberOps})\\s*${identifierPattern})*` : '';
  const indexPart = allowIndex ? '(?:\\s*\\[[^\\]]+\\])*' : '';
  const lhsPattern = `${identifierPattern}${memberPart}${indexPart}`;
  const operatorPattern = assignmentOperators.map(escapeRegExp).join('|');
  const assignmentRe = new RegExp(`(${lhsPattern})\\s*(?:${operatorPattern})`, 'g');
  const updateRe = new RegExp(`(?:\\+\\+|--)\\s*(${lhsPattern})|(${lhsPattern})\\s*(?:\\+\\+|--)`, 'g');

  const writes = new Set();
  const mutations = new Set();

  const normalizeName = (raw) => {
    let name = raw.replace(/\s+/g, '');
    for (const op of memberOperators) {
      name = name.split(op).join('.');
    }
    if (name.includes('[')) {
      name = name.replace(/\[[^\]]*\]/g, '[]');
    }
    return name;
  };

  const recordName = (raw) => {
    if (!raw) return;
    const normalized = normalizeName(raw);
    if (!normalized) return;
    if (normalized.includes('.') || normalized.includes('[]')) {
      mutations.add(normalized);
    } else {
      writes.add(normalized);
    }
  };

  for (const match of cleaned.matchAll(assignmentRe)) {
    recordName(match[1]);
  }
  for (const match of cleaned.matchAll(updateRe)) {
    recordName(match[1] || match[2]);
  }

  return { writes, mutations };
}

/**
 * Extract identifiers from text with keyword filtering.
 * @param {string} text
 * @param {object} [options]
 * @param {RegExp} [options.regex]
 * @param {Set<string>} [options.skip]
 * @param {(name:string)=>string} [options.normalize]
 * @returns {string[]}
 */
export function extractIdentifiers(text, options = {}) {
  const regex = options.regex || /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const skip = options.skip || new Set();
  const normalize = typeof options.normalize === 'function' ? options.normalize : (name) => name;
  const out = new Set();
  for (const match of text.matchAll(regex)) {
    const raw = match[1] || match[0];
    if (!raw || raw.length < 2) continue;
    const name = normalize(raw);
    if (!name || skip.has(name)) continue;
    out.add(name);
  }
  return Array.from(out);
}

/**
 * Summarize control-flow keywords in text.
 * @param {string} text
 * @param {object} [options]
 * @param {string[]} [options.branchKeywords]
 * @param {string[]} [options.loopKeywords]
 * @param {string[]} [options.returnKeywords]
 * @param {string[]} [options.breakKeywords]
 * @param {string[]} [options.continueKeywords]
 * @param {string[]} [options.throwKeywords]
 * @param {string[]} [options.awaitKeywords]
 * @param {string[]} [options.yieldKeywords]
 * @returns {{branches:number,loops:number,returns:number,breaks:number,continues:number,throws:number,awaits:number,yields:number}}
 */
export function summarizeControlFlow(text, options = {}) {
  const lower = text.toLowerCase();
  const countKeywords = (keywords) => {
    const unique = Array.isArray(keywords) ? Array.from(new Set(keywords)) : [];
    return unique.reduce((sum, keyword) => {
      if (!keyword) return sum;
      const escaped = escapeRegExp(keyword.toLowerCase());
      const re = new RegExp(`\\b${escaped}\\b`, 'g');
      const matches = lower.match(re);
      return sum + (matches ? matches.length : 0);
    }, 0);
  };

  return {
    branches: countKeywords(options.branchKeywords),
    loops: countKeywords(options.loopKeywords),
    returns: countKeywords(options.returnKeywords || ['return']),
    breaks: countKeywords(options.breakKeywords || ['break']),
    continues: countKeywords(options.continueKeywords || ['continue']),
    throws: countKeywords(options.throwKeywords || ['throw']),
    awaits: countKeywords(options.awaitKeywords || ['await']),
    yields: countKeywords(options.yieldKeywords || ['yield'])
  };
}

/**
 * Build a basic dataflow summary from text.
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.identifierPattern]
 * @param {string[]} [options.memberOperators]
 * @param {string[]} [options.assignmentOperators]
 * @param {boolean} [options.allowIndex]
 * @param {RegExp} [options.identifierRegex]
 * @param {Set<string>} [options.skip]
 * @param {(name:string)=>string} [options.normalize]
 * @returns {{reads:string[],writes:string[],mutations:string[]}}
 */
export function buildHeuristicDataflow(text, options = {}) {
  const normalize = typeof options.normalize === 'function' ? options.normalize : (name) => name;
  const { writes: rawWrites, mutations: rawMutations } = extractWritesAndMutations(text, {
    identifierPattern: options.identifierPattern,
    memberOperators: options.memberOperators,
    assignmentOperators: options.assignmentOperators,
    allowIndex: options.allowIndex
  });
  const writes = new Set();
  const mutations = new Set();
  for (const name of rawWrites) {
    const normalized = normalize(name);
    if (normalized) writes.add(normalized);
  }
  for (const name of rawMutations) {
    const normalized = normalize(name);
    if (normalized) mutations.add(normalized);
  }
  const identifiers = extractIdentifiers(text, {
    regex: options.identifierRegex,
    skip: options.skip,
    normalize
  });
  const reads = new Set();
  for (const name of identifiers) {
    if (!name) continue;
    if (writes.has(name) || mutations.has(name)) continue;
    reads.add(name);
  }
  return {
    reads: sortedUnique(reads),
    writes: sortedUnique(writes),
    mutations: sortedUnique(mutations)
  };
}

/**
 * Check if a return keyword carries a value.
 * @param {string} text
 * @param {string} [keyword]
 * @returns {boolean}
 */
export function hasReturnValue(text, keyword = 'return') {
  const escaped = escapeRegExp(keyword);
  const re = new RegExp(`\\b${escaped}\\b([^;\\n}]*)`, 'g');
  for (const match of text.matchAll(re)) {
    const rest = match[1] || '';
    if (rest.trim()) return true;
  }
  return false;
}
