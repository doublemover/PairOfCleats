/**
 * Shared control-flow and dataflow heuristics.
 */
const DEFAULT_ASSIGNMENT_OPERATORS = [
  '<<=', '>>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', ':=', '='
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAX_KEYWORD_MATCHES = 50000;
const WRITE_REGEX_CACHE = new Map();
const ALIAS_REGEX_CACHE = new Map();
const RETURN_REGEX_CACHE = new Map();
const KEYWORD_REGEX_CACHE = new Map();

const countMatches = (text, re, limit = Infinity) => {
  re.lastIndex = 0;
  let count = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    count += 1;
    if (!match[0]) re.lastIndex += 1;
    if (count >= limit) break;
  }
  return count;
};

const countKeywords = (text, keywords) => {
  const lower = String(text || '').toLowerCase();
  if (!lower) return 0;
  const unique = Array.isArray(keywords) ? Array.from(new Set(keywords)) : [];
  const normalized = [];
  for (const keyword of unique) {
    const value = String(keyword || '').trim().toLowerCase();
    if (value) normalized.push(value);
  }
  if (!normalized.length) return 0;
  normalized.sort();
  const key = normalized.join('|');
  let re = KEYWORD_REGEX_CACHE.get(key);
  if (!re) {
    const pattern = normalized.map(escapeRegExp).join('|');
    re = new RegExp(`\\b(?:${pattern})\\b`, 'g');
    KEYWORD_REGEX_CACHE.set(key, re);
  }
  return countMatches(lower, re, MAX_KEYWORD_MATCHES);
};

const serializeList = (value) => (
  Array.isArray(value) ? value.map((entry) => String(entry)).join('|') : ''
);

const getWriteRegexes = ({
  identifierPattern,
  memberOperators,
  assignmentOperators,
  allowIndex
}) => {
  const key = [
    identifierPattern,
    serializeList(memberOperators),
    serializeList(assignmentOperators),
    allowIndex ? '1' : '0'
  ].join('::');
  const cached = WRITE_REGEX_CACHE.get(key);
  if (cached) return cached;
  const memberOps = memberOperators.length
    ? memberOperators.map(escapeRegExp).join('|')
    : '';
  const memberPart = memberOps ? `(?:\\s*(?:${memberOps})\\s*${identifierPattern})*` : '';
  const indexPart = allowIndex ? '(?:\\s*\\[[^\\]]+\\])*' : '';
  const lhsPattern = `${identifierPattern}${memberPart}${indexPart}`;
  const operatorPattern = assignmentOperators.map(escapeRegExp).join('|');
  const assignmentRe = new RegExp(`(${lhsPattern})\\s*(?:${operatorPattern})`, 'g');
  const updateRe = new RegExp(
    `(?:\\+\\+|--)\\s*(${lhsPattern})|(${lhsPattern})\\s*(?:\\+\\+|--)`,
    'g'
  );
  const compiled = { assignmentRe, updateRe };
  WRITE_REGEX_CACHE.set(key, compiled);
  return compiled;
};

const getAliasRegex = ({
  identifierPattern,
  memberOperators,
  aliasOperators,
  declarationKeywords,
  allowIndex
}) => {
  const key = [
    identifierPattern,
    serializeList(memberOperators),
    serializeList(aliasOperators),
    serializeList(declarationKeywords),
    allowIndex ? '1' : '0'
  ].join('::');
  const cached = ALIAS_REGEX_CACHE.get(key);
  if (cached) return cached;
  const memberOps = memberOperators.length
    ? memberOperators.map(escapeRegExp).join('|')
    : '';
  const memberPart = memberOps ? `(?:\\s*(?:${memberOps})\\s*${identifierPattern})*` : '';
  const indexPart = allowIndex ? '(?:\\s*\\[[^\\]]+\\])*' : '';
  const lhsPattern = identifierPattern;
  const rhsPattern = `${identifierPattern}${memberPart}${indexPart}`;
  const opPattern = aliasOperators.map(escapeRegExp).join('|');
  const declPrefix = declarationKeywords.length
    ? `(?:\\b(?:${declarationKeywords.map(escapeRegExp).join('|')})\\b\\s+)*`
    : '';
  const aliasRe = new RegExp(`${declPrefix}(${lhsPattern})\\s*(?:${opPattern})\\s*(${rhsPattern})`, 'g');
  const compiled = { aliasRe };
  ALIAS_REGEX_CACHE.set(key, compiled);
  return compiled;
};

const getReturnRegex = (keyword) => {
  const normalized = String(keyword || 'return');
  const cached = RETURN_REGEX_CACHE.get(normalized);
  if (cached) return cached;
  const escaped = escapeRegExp(normalized);
  const compiled = new RegExp(`\\b${escaped}\\b([^;\\n}]*)`, 'g');
  RETURN_REGEX_CACHE.set(normalized, compiled);
  return compiled;
};

const toGlobalRegex = (regex) => (
  regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`)
);

const normalizeFlowName = (raw, memberOperators) => {
  let name = raw.replace(/\s+/g, '');
  for (const op of memberOperators) {
    name = name.split(op).join('.');
  }
  if (name.includes('[')) {
    name = name.replace(/\[[^\]]*\]/g, '[]');
  }
  return name;
};

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
  const { assignmentRe, updateRe } = getWriteRegexes({
    identifierPattern,
    memberOperators,
    assignmentOperators,
    allowIndex
  });

  const writes = new Set();
  const mutations = new Set();

  const recordName = (raw) => {
    if (!raw) return;
    const normalized = normalizeFlowName(raw, memberOperators);
    if (!normalized) return;
    if (normalized.includes('.') || normalized.includes('[]')) {
      mutations.add(normalized);
    } else {
      writes.add(normalized);
    }
  };

  assignmentRe.lastIndex = 0;
  let match;
  while ((match = assignmentRe.exec(cleaned)) !== null) {
    recordName(match[1]);
    if (!match[0]) assignmentRe.lastIndex += 1;
  }
  updateRe.lastIndex = 0;
  while ((match = updateRe.exec(cleaned)) !== null) {
    recordName(match[1] || match[2]);
    if (!match[0]) updateRe.lastIndex += 1;
  }

  return { writes, mutations };
}

/**
 * Extract alias assignments from text (lhs=rhs).
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.identifierPattern]
 * @param {string[]} [options.memberOperators]
 * @param {string[]} [options.aliasOperators]
 * @param {string[]} [options.declarationKeywords]
 * @param {boolean} [options.allowIndex]
 * @returns {Set<string>}
 */
export function extractAliases(text, options = {}) {
  const identifierPattern = options.identifierPattern || '[A-Za-z_][A-Za-z0-9_]*';
  const memberOperators = Array.isArray(options.memberOperators)
    ? options.memberOperators
    : ['.', '->', '::'];
  const aliasOperators = Array.isArray(options.aliasOperators)
    ? options.aliasOperators
    : ['=', ':='];
  const declarationKeywords = Array.isArray(options.declarationKeywords)
    ? options.declarationKeywords
    : ['const', 'let', 'var', 'val', 'mut', 'auto'];
  const allowIndex = options.allowIndex !== false;

  const cleaned = normalizeFlowText(text);
  const { aliasRe } = getAliasRegex({
    identifierPattern,
    memberOperators,
    aliasOperators,
    declarationKeywords,
    allowIndex
  });

  const aliases = new Set();
  aliasRe.lastIndex = 0;
  let match;
  while ((match = aliasRe.exec(cleaned)) !== null) {
    const lhsRaw = match[1];
    const rhsRaw = match[2];
    if (!lhsRaw || !rhsRaw) continue;
    const lhs = normalizeFlowName(lhsRaw, memberOperators);
    const rhs = normalizeFlowName(rhsRaw, memberOperators);
    if (!lhs || !rhs) continue;
    aliases.add(`${lhs}=${rhs}`);
  }
  return aliases;
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
  const regex = options.regex instanceof RegExp
    ? toGlobalRegex(options.regex)
    : /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const skip = options.skip || new Set();
  const normalize = typeof options.normalize === 'function' ? options.normalize : (name) => name;
  const out = new Set();
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1] || match[0];
    if (!raw || raw.length < 2) continue;
    const name = normalize(raw);
    if (!name || skip.has(name)) continue;
    out.add(name);
    if (!match[0]) regex.lastIndex += 1;
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
  return {
    branches: countKeywords(text, options.branchKeywords),
    loops: countKeywords(text, options.loopKeywords),
    returns: countKeywords(text, options.returnKeywords || ['return']),
    breaks: countKeywords(text, options.breakKeywords || ['break']),
    continues: countKeywords(text, options.continueKeywords || ['continue']),
    throws: countKeywords(text, options.throwKeywords || ['throw']),
    awaits: countKeywords(text, options.awaitKeywords || ['await']),
    yields: countKeywords(text, options.yieldKeywords || ['yield'])
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
 * @returns {{reads:string[],writes:string[],mutations:string[],aliases:string[]}}
 */
export function buildHeuristicDataflow(text, options = {}) {
  const normalize = typeof options.normalize === 'function' ? options.normalize : (name) => name;
  const { writes: rawWrites, mutations: rawMutations } = extractWritesAndMutations(text, {
    identifierPattern: options.identifierPattern,
    memberOperators: options.memberOperators,
    assignmentOperators: options.assignmentOperators,
    allowIndex: options.allowIndex
  });
  const rawAliases = extractAliases(text, {
    identifierPattern: options.identifierPattern,
    memberOperators: options.memberOperators,
    aliasOperators: options.aliasOperators,
    declarationKeywords: options.declarationKeywords,
    allowIndex: options.allowIndex
  });
  const writes = new Set();
  const mutations = new Set();
  const aliases = new Set();
  for (const name of rawWrites) {
    const normalized = normalize(name);
    if (normalized) writes.add(normalized);
  }
  for (const name of rawMutations) {
    const normalized = normalize(name);
    if (normalized) mutations.add(normalized);
  }
  for (const alias of rawAliases) {
    const [lhs, rhs] = alias.split('=');
    const normalizedLhs = normalize(lhs);
    const normalizedRhs = normalize(rhs);
    if (!normalizedLhs || !normalizedRhs) continue;
    aliases.add(`${normalizedLhs}=${normalizedRhs}`);
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
    mutations: sortedUnique(mutations),
    aliases: sortedUnique(aliases)
  };
}

/**
 * Check if a return keyword carries a value.
 * @param {string} text
 * @param {string} [keyword]
 * @returns {boolean}
 */
export function hasReturnValue(text, keyword = 'return') {
  const re = getReturnRegex(keyword);
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    const rest = match[1] || '';
    if (rest.trim()) return true;
    if (!match[0]) re.lastIndex += 1;
  }
  return false;
}
