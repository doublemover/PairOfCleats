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

/**
 * Split a token into dictionary words when possible.
 * @param {string} token
 * @param {Set<string>} dict
 * @returns {string[]}
 */
export function splitWordsWithDict(token, dict) {
  if (!dict || dict.size === 0) return [token];
  const result = [];
  let i = 0;
  while (i < token.length) {
    let found = false;
    for (let j = token.length; j > i; j--) {
      const sub = token.slice(i, j);
      if (dict.has(sub)) {
        result.push(sub);
        i = j;
        found = true;
        break;
      }
    }
    if (!found) {
      result.push(token[i]);
      i++;
    }
  }
  return result;
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
