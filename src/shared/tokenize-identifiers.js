import Snowball from 'snowball-stemmers';
const stemmer = Snowball.newStemmer('english');
const wordSegmenter = new Intl.Segmenter('und', { granularity: 'word' });
export const SCORING_ANALYZER_VERSION = 'unicode-identifiers.v1:icu-' + process.versions.icu;
export const stem = (w) => typeof w === 'string' ? (/^[a-z]+$/i.test(w) ? stemmer.stem(w) : w) : '';
export const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const splitIdentifiers = (value) => String(value ?? '').normalize('NFKC')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/[_\-]+/g, ' ')
  .split(/[^\p{L}\p{M}\p{N}]+/u)
  .flatMap(tok => tok.split(/(?<=.)(?=[A-Z])/))
  .filter(Boolean)
  .flatMap(token => {
    // Keep the complete identifier and add Unicode word boundaries for scripts
    // whose prose does not use whitespace. ASCII identifier behavior is unchanged.
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(token)) return [token];
    const words = [...wordSegmenter.segment(token)].filter(part => part.isWordLike).map(part => part.segment);
    return words.length > 1 ? [token, ...words] : [token];
  });
export const splitId = (s) => splitIdentifiers(s).map(t => t.toLowerCase());
export const splitIdPreserveCase = (s) => splitIdentifiers(s);
