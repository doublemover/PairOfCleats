import { createCli } from '../../../src/shared/cli.js';
import { listCommandRegistry } from '../../../src/shared/command-registry-query.js';
import { INDEX_BUILD_OPTIONS, SERVICE_INDEXER_OPTIONS, TOOLING_INSTALL_OPTIONS } from '../../../src/shared/cli-option-sets.js';
import { INDEX_VALIDATE_OPTIONS } from '../../../src/shared/index-tool-options.js';
import { SEARCH_OPTIONS, SEARCH_ALIASES } from '../../../src/retrieval/cli-options.js';
import { SETUP_OPTIONS, BOOTSTRAP_OPTIONS } from '../../shared/operator-cli-options.js';
import { CONFIG_VALIDATE_OPTIONS, CONFIG_DUMP_OPTIONS } from '../../config/options.js';
import { WORKSPACE_AUTHOR_OPTIONS } from '../../workspace/author.js';
import { assertServiceIndexerSelection } from '../../service/cli-contract.js';

// Owner mapping only: option definitions remain imported from executable owners.
const OWNER_OPTIONS = new Map([
  ['build_index.js', INDEX_BUILD_OPTIONS], ['tools/index/validate.js', INDEX_VALIDATE_OPTIONS],
  ['tools/service/indexer-service.js', SERVICE_INDEXER_OPTIONS], ['tools/tooling/install.js', TOOLING_INSTALL_OPTIONS],
  ['tools/setup/setup.js', SETUP_OPTIONS], ['tools/setup/bootstrap.js', BOOTSTRAP_OPTIONS],
  ['tools/config/validate.js', CONFIG_VALIDATE_OPTIONS], ['tools/config/dump.js', CONFIG_DUMP_OPTIONS],
  ['tools/workspace/author.js', WORKSPACE_AUTHOR_OPTIONS], ['tools/search/cli-entry.js', SEARCH_OPTIONS], ['search.js', SEARCH_OPTIONS]
]);

export const validateRecipeCommand = tokens => {
  let args = tokens.slice();
  const registry = listCommandRegistry().sort((left, right) => right.commandPath.length - left.commandPath.length);
  let entry;
  if (args[0] === 'node' && args[1] !== 'bin/pairofcleats.js') {
    const script = args[1]?.replaceAll('\\', '/');
    entry = registry.find(candidate => candidate.script === script) || (OWNER_OPTIONS.has(script) ? { id: script, script } : null);
    args = args.slice(2);
  } else {
    if (args[0] === 'node' && args[1] === 'bin/pairofcleats.js') args = args.slice(2);
    else if (args[0] === 'pairofcleats') args = args.slice(1);
    else throw new Error('Recipe must use the canonical source CLI or an explicitly owned direct Node script.');
    entry = registry.find(candidate => candidate.commandPath.every((part, index) => args[index] === part));
    if (entry) args = [...(entry.extraArgs || []), ...args.slice(entry.commandPath.length)];
  }
  if (!entry) throw new Error('No canonical command route admits this invocation.');
  const options = OWNER_OPTIONS.get(entry.script);
  if (!options) return { commandId: entry.id, script: entry.script, options: 'not-evaluated', args, selection: {} };
  const argv = createCli({ scriptName: entry.id, options,
    aliases: [ 'search.js', 'tools/search/cli-entry.js' ].includes(entry.script) ? SEARCH_ALIASES : {} }).strictOptions().exitProcess(false)
    .fail((message, error) => { throw error || new Error(message); }).parse(args);
  if (entry.script === 'tools/service/indexer-service.js') assertServiceIndexerSelection({ ...argv, command: argv._[0] || argv.command });
  return { commandId: entry.id, script: entry.script, options: 'evaluated', args,
    selection: { repo: argv.repo || null, config: argv.config || null, workspace: argv.workspace || null, queue: argv.queue || null }, argv };
};
