import { buildSimpleRelations } from '../simple-relations.js';
import { collectIniImports } from '../import-collectors/ini.js';
import { collectJsonImports } from '../import-collectors/json.js';
import { collectTomlImports } from '../import-collectors/toml.js';
import { collectXmlImports } from '../import-collectors/xml.js';
import { collectYamlImports } from '../import-collectors/yaml.js';

const createExtensionMatcher = (extensions) => (ext) => extensions.has(ext);

const INI_EXTS = new Set(['.ini', '.cfg', '.conf']);
const JSON_EXTS = new Set(['.json', '.jsonc', '.resolved']);
const TOML_EXTS = new Set(['.toml']);
const XML_EXTS = new Set(['.xml', '.props', '.targets', '.csproj', '.config', '.projitems']);
const YAML_EXTS = new Set(['.yaml', '.yml']);

export const createConfigDataAdapter = ({ id, match, collectImports = () => [], literalImports = false }) => ({
  id,
  match,
  collectImports: (text, options) => collectImports(text, options),
  ...(literalImports ? { collectImportEntries: (text, options) => {
    const values = collectImports(text, options);
    const entries = values.map(specifier => ({ specifier, provenance: 'parsed-literal' }));
    if (values.coverage) Object.defineProperty(entries, 'coverage', { value: values.coverage });
    if (values.occurrences) Object.defineProperty(entries, 'occurrences', { value: values.occurrences });
    return entries;
  } } : {}),
  prepare: async () => ({}),
  buildRelations: ({ text, options }) => {
    const values = collectImports(text, options);
    return { ...buildSimpleRelations({ imports: values, literalImports }),
      ...(values.coverage ? { importScanCoverage: values.coverage } : {}),
      ...(id === 'xml' ? { xmlImportOccurrences: values.occurrences || [], xmlReferenceObservations: values.observations || [] } : {}) };
  },
  extractDocMeta: () => ({}),
  flow: () => null,
  attachName: false
});

export const createJsonConfigAdapter = () => {
  const adapter = createConfigDataAdapter({ id: 'json', match: createExtensionMatcher(JSON_EXTS), collectImports: collectJsonImports, literalImports: true });
  adapter.buildRelations = ({ text, ext, relPath, options }) => buildSimpleRelations({ imports: collectJsonImports(text,
    { ...options, ext: ext ?? options?.ext, relPath: relPath ?? options?.relPath }), literalImports: true });
  return adapter;
};

export const buildConfigFileAdapters = () => [
  createConfigDataAdapter({
    id: 'ini',
    match: createExtensionMatcher(INI_EXTS),
    collectImports: collectIniImports
  }),
  createJsonConfigAdapter(),
  createConfigDataAdapter({
    id: 'toml',
    match: createExtensionMatcher(TOML_EXTS),
    collectImports: collectTomlImports,
    literalImports: true
  }),
  createConfigDataAdapter({
    id: 'xml',
    match: createExtensionMatcher(XML_EXTS),
    collectImports: collectXmlImports,
    literalImports: true
  }),
  createConfigDataAdapter({
    id: 'yaml',
    match: createExtensionMatcher(YAML_EXTS),
    collectImports: collectYamlImports,
    literalImports: true
  })
];
