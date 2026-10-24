import { collectJvmStyleImports } from './utils.js';

export const collectScalaImports = (text) => collectJvmStyleImports(text, {
  nestedBlockComments: true,
  precheckTokens: ['import', 'package', 'extends', 'with'],
  typeReferenceKeywords: ['extends', 'with']
});
