import Snowball from 'snowball-stemmers';

const stemmer = Snowball.newStemmer('english');

/**
 * Stem a token using the English Snowball stemmer.
 * @param {string} w
 * @returns {string}
 */
export const stem = (w) => (typeof w === 'string' ? stemmer.stem(w) : '');

/**
 * Insert spaces between camelCase boundaries.
 * @param {string} s
 * @returns {string}
 */
export const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

/**
 * Split an identifier into normalized tokens.
 * @param {string} s
 * @returns {string[]}
 */
export function splitId(s) {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .split(/[^a-zA-Z0-9]+/u)
    .flatMap((tok) => tok.split(/(?<=.)(?=[A-Z])/))
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

const DEFAULT_DICT_SEGMENTATION = {
  mode: 'auto',
  dpMaxTokenLength: 32
};

const VALID_DICT_SEGMENT_MODES = new Set(['auto', 'greedy', 'dp']);

const normalizeDictSegmentation = (options = {}) => {
  const modeRaw = typeof options.segmentation === 'string'
    ? options.segmentation.toLowerCase()
    : '';
  const mode = VALID_DICT_SEGMENT_MODES.has(modeRaw)
    ? modeRaw
    : DEFAULT_DICT_SEGMENTATION.mode;
  const dpMaxTokenLengthRaw = Number(options.dpMaxTokenLength);
  const dpMaxTokenLength = Number.isFinite(dpMaxTokenLengthRaw)
    ? Math.max(4, Math.floor(dpMaxTokenLengthRaw))
    : DEFAULT_DICT_SEGMENTATION.dpMaxTokenLength;
  return { mode, dpMaxTokenLength };
};

const getDictMaxLen = (dict) => {
  if (!dict || dict.size === 0) return 0;
  const cached = dict.__maxTokenLength;
  if (Number.isFinite(cached) && cached > 0) return cached;
  let maxLen = 0;
  for (const word of dict) {
    if (typeof word === 'string' && word.length > maxLen) maxLen = word.length;
  }
  dict.__maxTokenLength = maxLen;
  return maxLen;
};

const findLongestMatch = (token, start, dict, maxLen) => {
  const endLimit = Math.min(token.length, start + maxLen);
  for (let end = endLimit; end > start; end--) {
    const sub = token.slice(start, end);
    if (dict.has(sub)) return sub;
  }
  return null;
};

const hasDictMatchAt = (token, start, dict, maxLen) => !!findLongestMatch(token, start, dict, maxLen);

const splitWordsWithDictGreedy = (token, dict, maxLen) => {
  const result = [];
  let i = 0;
  while (i < token.length) {
    const match = findLongestMatch(token, i, dict, maxLen);
    if (match) {
      result.push(match);
      i += match.length;
      continue;
    }
    const unknownStart = i;
    i += 1;
    while (i < token.length && !hasDictMatchAt(token, i, dict, maxLen)) {
      i += 1;
    }
    result.push(token.slice(unknownStart, i));
  }
  return result;
};

const pickBetterSegment = (current, candidate) => {
  if (!current) return candidate;
  if (candidate.matchChars > current.matchChars) return candidate;
  if (candidate.matchChars < current.matchChars) return current;
  if (candidate.segments < current.segments) return candidate;
  if (candidate.segments > current.segments) return current;
  if (candidate.isDict && !current.isDict) return candidate;
  return current;
};

const splitWordsWithDictDp = (token, dict, maxLen) => {
  const n = token.length;
  const best = new Array(n + 1).fill(null);
  best[n] = { matchChars: 0, segments: 0, next: n, token: '', isDict: false };
  for (let i = n - 1; i >= 0; i--) {
    let bestChoice = null;
    const fallback = best[i + 1];
    if (fallback) {
      bestChoice = pickBetterSegment(bestChoice, {
        matchChars: fallback.matchChars,
        segments: fallback.segments + 1,
        next: i + 1,
        token: token.slice(i, i + 1),
        isDict: false
      });
    }
    const endLimit = Math.min(n, i + maxLen);
    for (let end = endLimit; end > i; end--) {
      const word = token.slice(i, end);
      if (!dict.has(word)) continue;
      const nextScore = best[end];
      if (!nextScore) continue;
      bestChoice = pickBetterSegment(bestChoice, {
        matchChars: nextScore.matchChars + word.length,
        segments: nextScore.segments + 1,
        next: end,
        token: word,
        isDict: true
      });
    }
    best[i] = bestChoice;
  }
  const segments = [];
  let idx = 0;
  while (idx < n && best[idx]) {
    const entry = best[idx];
    segments.push(entry);
    idx = entry.next;
  }
  const result = [];
  let buffer = '';
  for (const seg of segments) {
    if (!seg.isDict) {
      buffer += seg.token;
      continue;
    }
    if (buffer) {
      result.push(buffer);
      buffer = '';
    }
    result.push(seg.token);
  }
  if (buffer) result.push(buffer);
  return result;
};

const scoreSegments = (segments, dict) => segments.reduce((sum, seg) => (
  dict.has(seg) ? sum + seg.length : sum
), 0);

/**
 * Split a token into dictionary words when possible.
 * @param {string} token
 * @param {Set<string>} dict
 * @param {{segmentation?:string,dpMaxTokenLength?:number}} [options]
 * @returns {string[]}
 */
export function splitWordsWithDict(token, dict, options = {}) {
  if (!dict || dict.size === 0) return [token];
  if (!token) return [];
  const { mode, dpMaxTokenLength } = normalizeDictSegmentation(options);
  const maxLen = getDictMaxLen(dict);
  if (!maxLen) return [token];
  const greedy = splitWordsWithDictGreedy(token, dict, maxLen);
  if (mode === 'greedy') return greedy;
  if (mode === 'dp') {
    if (token.length > dpMaxTokenLength) return greedy;
    return splitWordsWithDictDp(token, dict, maxLen);
  }
  if (token.length <= dpMaxTokenLength) {
    const dp = splitWordsWithDictDp(token, dict, maxLen);
    if (scoreSegments(dp, dict) > scoreSegments(greedy, dict)) return dp;
  }
  return greedy;
}

/**
 * Build token n-grams for phrase matching.
 * @param {string[]} tokens
 * @param {number} [nStart]
 * @param {number} [nEnd]
 * @returns {string[]}
 */
export function extractNgrams(tokens, nStart = 2, nEnd = 4) {
  const grams = [];
  for (let n = nStart; n <= nEnd; ++n) {
    for (let i = 0; i <= tokens.length - n; i++) {
      grams.push(tokens.slice(i, i + n).join('_'));
    }
  }
  return grams;
}

/**
 * Build character n-grams with start/end sentinels.
 * @param {string} w
 * @param {number} [n]
 * @returns {string[]}
 */
export function tri(w, n = 3) {
  const s = `\u27ec${w}\u27ed`;
  const g = [];
  for (let i = 0; i <= s.length - n; i++) {
    g.push(s.slice(i, i + n));
  }
  return g;
}
