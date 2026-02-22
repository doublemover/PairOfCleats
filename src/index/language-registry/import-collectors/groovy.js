import { collectJvmStyleImports } from './utils.js';

export const collectGroovyImports = (text) => collectJvmStyleImports(text, {
  precheckTokens: ['import', 'package', 'extends', 'implements'],
  typeReferenceKeywords: ['extends', 'implements']
});
