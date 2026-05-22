import { createCli } from '../../src/shared/cli.js';
import { createToolDisplay } from '../shared/cli-display.js';

export const createIndexBuildToolCli = ({ scriptName, options }) => {
  const argv = createCli({
    scriptName,
    options
  }).parse();
  const display = createToolDisplay({ argv, stream: process.stderr });
  const log = (message) => display.log(message);
  const warn = (message) => display.warn(message);
  const fail = (message, code = 1) => {
    display.error(message);
    display.close();
    process.exit(code);
  };
  return { argv, display, log, warn, fail };
};
