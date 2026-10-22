import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { scanStaticCalls, splitStaticArguments } from './static-arguments.js';
import { decodeRArgumentToken } from './r-literals.js';

export const collectRImports = (text,options = {}) => {
  const imports = new Set();
  const context = createCollectorBudgetContext({text,options,collectorId:'imports:r',
    defaults:{maxChars:524288,maxMatches:1024,maxTokens:2048,maxMs:30}});
  try {
    for (const call of scanStaticCalls(context.source,new Set(['library','require','requireNamespace','source']),
      { shouldContinue: () => context.scanBudget.consumeTime() })) {
      if (!context.scanBudget.consumeMatch()) break;
      const args = splitStaticArguments(call.args);
      const argumentName = arg => arg[1]?.value === '=' ? decodeRArgumentToken(arg[0], context.source)?.value : null;
      const targetName = call.name === 'source' ? 'file' : 'package';
      const named = args.filter(arg => argumentName(arg) === targetName);
      if (named.length > 1) continue;
      const target = named.length ? named[0].slice(2) : args.find(arg => argumentName(arg) === null);
      if (target?.length !== 1) continue;
      const token = decodeRArgumentToken(target[0], context.source);
      if (!token) continue;
      const characterOnlyArgs = args.filter(arg => argumentName(arg) === 'character.only');
      if (characterOnlyArgs.length > 1) continue;
      const characterOnly = characterOnlyArgs[0];
      const knownBarePackage = token.kind === 'identifier' && ['library','require'].includes(call.name)
        && (!characterOnly || characterOnly.length === 3 && characterOnly[2].kind === 'identifier'
          && context.source.slice(characterOnly[2].start, characterOnly[2].end) === 'FALSE');
      if (token.kind !== 'string' && !knownBarePackage) continue;
      addBudgetedCollectorImport(imports,token.value,context.scanBudget,{literal:true});
    }
    return [...imports];
  } finally { context.finalize(); }
};
