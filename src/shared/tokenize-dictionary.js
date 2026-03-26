import AhoCorasick from 'aho-corasick';

const DEFAULT_DICT_SEGMENTATION = {
  mode: 'auto',
  dpMaxTokenLength: 32
};

const VALID_DICT_SEGMENT_MODES = new Set(['auto', 'greedy', 'dp', 'aho']);
const MAX_AHO_DICT_SIZE = 200000;

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
  const altMax = Number.isFinite(dict.maxLen) && dict.maxLen > 0 ? dict.maxLen : 0;
  if (altMax) return altMax;
  if (dict.__sharedDict) return 0;
  if (typeof dict[Symbol.iterator] !== 'function') return 0;
  let maxLen = 0;
  for (const word of dict) {
    if (typeof word === 'string' && word.length > maxLen) maxLen = word.length;
  }
  dict.__maxTokenLength = maxLen;
  return maxLen;
};

const buildDictAhoMatcher = (dict) => {
  if (!dict || dict.__sharedDict) return null;
  if (typeof dict[Symbol.iterator] !== 'function') return null;
  if (Number.isFinite(dict.size) && dict.size > MAX_AHO_DICT_SIZE) return null;
  const matcher = new AhoCorasick();
  const words = [];
  for (const word of dict) {
    if (typeof word !== 'string' || !word) continue;
    words.push(word);
    matcher.add(word, word);
  }
  if (!words.length) return null;
  matcher.build_fail();
  return { matcher, words };
};

const getDictAhoMatcher = (dict) => {
  if (!dict || dict.size === 0 || dict.__sharedDict) return null;
  const cached = dict.__ahoMatcher;
  if (cached && cached.size === dict.size) return cached.matcher;
  const built = buildDictAhoMatcher(dict);
  if (!built) return null;
  dict.__ahoMatcher = {
    matcher: built.matcher,
    size: dict.size,
    words: built.words
  };
  return built.matcher;
};

const buildAhoMatches = (token, dict) => {
  const matcher = getDictAhoMatcher(dict);
  if (!matcher || !token) return null;
  const matchesByStart = Array.from({ length: token.length }, () => []);
  matcher.search(token, (value, _data, offset) => {
    if (!value) return;
    const start = Number(offset);
    if (!Number.isFinite(start) || start < 0) return;
    const end = start + value.length;
    if (end > token.length) return;
    matchesByStart[start].push({ word: value, end });
  });
  return matchesByStart;
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

const splitWordsWithDictDp = (token, dict, maxLen, matchesByStart = null) => {
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
    if (matchesByStart) {
      const matches = matchesByStart[i];
      if (matches && matches.length) {
        for (const match of matches) {
          const nextScore = best[match.end];
          if (!nextScore) continue;
          bestChoice = pickBetterSegment(bestChoice, {
            matchChars: nextScore.matchChars + match.word.length,
            segments: nextScore.segments + 1,
            next: match.end,
            token: match.word,
            isDict: true
          });
        }
      }
    } else {
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

export function splitWordsWithDict(token, dict, options = {}) {
  if (!dict || dict.size === 0 || typeof dict.has !== 'function') return [token];
  if (!token) return [];
  const { mode, dpMaxTokenLength } = normalizeDictSegmentation(options);
  const maxLen = getDictMaxLen(dict);
  if (!maxLen) return [token];
  const greedy = splitWordsWithDictGreedy(token, dict, maxLen);
  if (mode === 'greedy') return greedy;
  const shouldUseDp = token.length <= dpMaxTokenLength;
  const matchesByStart = shouldUseDp && ['auto', 'dp', 'aho'].includes(mode)
    ? buildAhoMatches(token, dict)
    : null;
  if (mode === 'dp' || mode === 'aho') {
    if (!shouldUseDp) return greedy;
    return splitWordsWithDictDp(token, dict, maxLen, matchesByStart);
  }
  if (shouldUseDp) {
    const dp = splitWordsWithDictDp(token, dict, maxLen, matchesByStart);
    if (scoreSegments(dp, dict) > scoreSegments(greedy, dict)) return dp;
  }
  return greedy;
}
