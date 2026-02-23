import { buildSimpleRelations } from '../simple-relations.js';
import { collectIniImports } from '../import-collectors/ini.js';
import { collectJsonImports } from '../import-collectors/json.js';
import { collectTomlImports } from '../import-collectors/toml.js';
import { collectXmlImports } from '../import-collectors/xml.js';
import { collectYamlImports } from '../import-collectors/yaml.js';

const createExtensionMatcher = (extensions) => (ext) => extensions.has(ext);

const INI_EXTS = new Set(['.ini', '.cfg', '.conf']);
const JSON_EXTS = new Set(['.json']);
const TOML_EXTS = new Set(['.toml']);
const XML_EXTS = new Set(['.xml']);
const YAML_EXTS = new Set(['.yaml', '.yml']);

export const createConfigDataAdapter = ({ id, match, collectImports = () => [] }) => ({
  id,
  match,
  collectImports: (text, options) => collectImports(text, options),
  prepare: async () => ({}),
  buildRelations: ({ text, options }) => buildSimpleRelations({ imports: collectImports(text, options) }),
  extractDocMeta: () => ({}),
  flow: () => null,
  attachName: false
});

export const buildConfigFileAdapters = () => [
  createConfigDataAdapter({
    id: 'ini',
    match: createExtensionMatcher(INI_EXTS),
    collectImports: collectIniImports
  }),
  createConfigDataAdapter({
    id: 'json',
    match: createExtensionMatcher(JSON_EXTS),
    collectImports: collectJsonImports
  }),
  createConfigDataAdapter({
    id: 'toml',
    match: createExtensionMatcher(TOML_EXTS),
    collectImports: collectTomlImports
  }),
  createConfigDataAdapter({
    id: 'xml',
    match: createExtensionMatcher(XML_EXTS),
    collectImports: collectXmlImports
  }),
  createConfigDataAdapter({
    id: 'yaml',
    match: createExtensionMatcher(YAML_EXTS),
    collectImports: collectYamlImports
  })
];
