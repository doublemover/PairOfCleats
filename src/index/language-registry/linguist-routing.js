import { toArray } from '../../shared/iterables.js';
import { PROTOCOL_BUFFER_ALIASES, PROTOCOL_BUFFER_LANGUAGE_ID } from '../../shared/language-aliases.js';

export const normalizeLinguistName = (value) => String(value || '').trim().toLowerCase();
const LINGUIST_NAME_TO_ID = new Map([
  ['c', 'clike'],
  ['c++', 'clike'],
  ['objective-c', 'clike'],
  ['objective-c++', 'clike'],
  ['c#', 'csharp'],
  ['csharp', 'csharp'],
  ['go', 'go'],
  ['java', 'java'],
  ['javascript', 'javascript'],
  ['typescript', 'typescript'],
  ['tsx', 'typescript'],
  ['python', 'python'],
  ['ruby', 'ruby'],
  ['php', 'php'],
  ['html', 'html'],
  ['css', 'css'],
  ['lua', 'lua'],
  ['sql', 'sql'],
  ['shell', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['makefile', 'makefile'],
  ['dockerfile', 'dockerfile'],
  ['cmake', 'cmake'],
  ['starlark', 'starlark'],
  ['bazel', 'starlark'],
  ['nix', 'nix'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['groovy', 'groovy'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['handlebars', 'handlebars'],
  ['mustache', 'mustache'],
  ['jinja', 'jinja'],
  ['jinja2', 'jinja'],
  ['django', 'jinja'],
  ['razor', 'razor'],
  ...PROTOCOL_BUFFER_ALIASES.map(alias => [alias, PROTOCOL_BUFFER_LANGUAGE_ID]),
  ['graphql', 'graphql'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['rust', 'rust'],
  ['perl', 'perl']
]);

const resolveLinguistId = (name, entry) => {
  const candidates = [name, ...toArray(entry?.aliases)];
  for (const candidate of candidates) {
    const normalized = normalizeLinguistName(candidate);
    if (LINGUIST_NAME_TO_ID.has(normalized)) return LINGUIST_NAME_TO_ID.get(normalized);
  }
  return null;
};

/** Build the same ordered routes from a complete or selected metadata catalog. */
export const buildLinguistRoutingMaps = (languages, supportedLanguageIds) => {
  const extensions = new Map(), filenames = new Map();
  for (const [name, entry] of Object.entries(languages || {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const languageId = resolveLinguistId(name, entry);
    if (!languageId || !supportedLanguageIds.has(languageId)) continue;
    for (const ext of toArray(entry?.extensions)) {
      const key = String(ext || '').toLowerCase();
      if (key && !extensions.has(key)) {
        extensions.set(key, languageId);
      }
    }
    for (const filename of toArray(entry?.filenames)) {
      const key = String(filename || '').toLowerCase();
      if (key && !filenames.has(key)) {
        filenames.set(key, languageId);
      }
    }
  }
  return { extensions, filenames };
};
