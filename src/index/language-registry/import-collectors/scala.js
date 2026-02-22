import { collectJvmStyleImports } from './utils.js';

export const collectScalaImports = (text) => collectJvmStyleImports(text, {
  precheckTokens: ['import', 'package', 'extends', 'with'],
  typeReferenceKeywords: ['extends', 'with']
});
