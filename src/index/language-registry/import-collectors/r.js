import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { scanStaticCalls, splitStaticArguments } from './static-arguments.js';

export const collectRImports = (text,options = {}) => {
  const imports = new Set();
  const context = createCollectorBudgetContext({text,options,collectorId:'imports:r',
    defaults:{maxChars:524288,maxMatches:1024,maxTokens:2048,maxMs:30}});
  try {
    for (const call of scanStaticCalls(context.source,new Set(['library','require','requireNamespace','source']))) {
      if (!context.scanBudget.consumeMatch()) break;
      const args = splitStaticArguments(call.args);
      const named = args.find(arg=>arg[0]?.value === 'package' && arg[1]?.value === '=');
      const target = named ? named.slice(2) : args[0];
      if (target?.length !== 1) continue;
      const token = target[0];
      const characterOnly = args.find(arg=>arg[0]?.value === 'character.only' && arg[1]?.value === '=');
      const knownBarePackage = token.kind === 'identifier' && ['library','require'].includes(call.name)
        && (!characterOnly || characterOnly.length === 3 && characterOnly[2].value === 'FALSE');
      if (token.kind !== 'string' && !knownBarePackage) continue;
      addBudgetedCollectorImport(imports,token.value,context.scanBudget,{literal:true});
    }
    return [...imports];
  } finally { context.finalize(); }
};