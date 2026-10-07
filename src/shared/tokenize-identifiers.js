import Snowball from 'snowball-stemmers';

const stemmer = Snowball.newStemmer('english');

export const stem = (w) => (typeof w === 'string' ? stemmer.stem(w) : '');

export const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

export function splitId(s) {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .split(/[^a-zA-Z0-9]+/u)
    .flatMap((tok) => tok.split(/(?<=.)(?=[A-Z])/))
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

export function splitIdPreserveCase(s) {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .split(/[^a-zA-Z0-9]+/u)
    .flatMap((tok) => tok.split(/(?<=.)(?=[A-Z])/))
    .filter(Boolean);
}
