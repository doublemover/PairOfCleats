#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import { renderShellCompletion, SUPPORTED_COMPLETION_SHELLS } from '../../src/shared/cli-completions.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats cli completions',
  usage: 'Usage: pairofcleats cli completions --shell <bash|powershell|zsh>',
  options: {
    shell: {
      type: 'string',
      choices: SUPPORTED_COMPLETION_SHELLS.slice(),
      demandOption: true,
      describe: 'Shell dialect to render.'
    }
  }
})
  .strictOptions()
  .parse();

const main = async () => {
  const argv = parseArgs();
  process.stdout.write(renderShellCompletion(argv.shell));
};

await main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
