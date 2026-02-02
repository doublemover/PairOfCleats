import { spawnSubprocess } from '../../shared/subprocess.js';

const defaultRunner = (command, args, options = {}) => (
  spawnSubprocess(command, args, { ...options, shell: false })
);

let activeRunner = defaultRunner;

export const setScmCommandRunner = (runner) => {
  activeRunner = typeof runner === 'function' ? runner : defaultRunner;
};

export const getScmCommandRunner = () => activeRunner;

export const runScmCommand = (command, args, options = {}) => (
  activeRunner(command, args, options)
);
