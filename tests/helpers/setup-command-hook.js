import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Intercept only a selected setup command at its async adapter boundary. The
 * remaining calls retain the real child owner. No fixture is native evidence.
 */
export const setupCommandHookSource = ({ selectedSuffix, result, onSelected = '' }) => {
  const url = pathToFileURL(path.resolve('tools/setup/owned-command.js')).href;
  const source = `import fs from 'node:fs';
import { runSetupCommand as actual } from ${JSON.stringify(url + '?fixture-original')};
export const runSetupCommand = async (command, args, options) => {
  if (args.some(arg => String(arg).replaceAll('\\\\', '/').endsWith(${JSON.stringify(selectedSuffix)}))) {
    ${onSelected}
    return ${JSON.stringify(result)};
  }
  return actual(command, args, options);
};`;
  return `import { registerHooks } from 'node:module';
registerHooks({load(url, context, next) {
  if (url === ${JSON.stringify(url)}) return { format: 'module', source: ${JSON.stringify(source)}, shortCircuit: true };
  return next(url, context);
}});`;
};
