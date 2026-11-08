import { createRequire } from 'node:module';
import { deferLanguageFunctions } from './deferred-language-functions.js';
const require = createRequire(import.meta.url);
export { smartChunk } from './chunking/dispatch.js';
const { chunkMarkdown } = deferLanguageFunctions(
  () => require('./chunking/formats/markdown.js'),
  ['chunkMarkdown']
);
export { chunkMarkdown };
const { chunkJson } = deferLanguageFunctions(
  () => require('./chunking/formats/json.js'),
  ['chunkJson']
);
export { chunkJson };
const { chunkYaml } = deferLanguageFunctions(
  () => require('./chunking/formats/yaml.js'),
  ['chunkYaml']
);
export { chunkYaml };
const { chunkIniToml } = deferLanguageFunctions(
  () => require('./chunking/formats/ini-toml.js'),
  ['chunkIniToml']
);
export { chunkIniToml };
const { chunkXml } = deferLanguageFunctions(
  () => require('./chunking/formats/xml.js'),
  ['chunkXml']
);
export { chunkXml };
const { chunkRst, chunkAsciiDoc } = deferLanguageFunctions(
  () => require('./chunking/formats/rst-asciidoc.js'),
  ['chunkRst', 'chunkAsciiDoc']
);
export { chunkRst, chunkAsciiDoc };
