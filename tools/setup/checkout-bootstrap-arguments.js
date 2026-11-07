const fail = message => Object.assign(new Error(message), { code: 'ERR_CHECKOUT_BOOTSTRAP_ARGUMENTS' });
const unique = args => {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string') || new Set(args).size !== args.length) throw fail('Bootstrap arguments must be distinct strings.');
};
export const CHECKOUT_BOOTSTRAP_USAGE = 'npm run bootstrap:ci -- [--help | --plan | --status | --verify | --repair] [--json]\n'
  + 'npm run bootstrap is reserved for intentional dependency-resolution changes.\n'
  + '--json applies only to help, plan and status. Information modes launch no children.';
export const NATIVE_REBUILD_USAGE = 'node tools/setup/rebuild-native.js [--help | --verify | --repair]';

/** Parse the complete invocation before any prerequisite or mutation owner. */
export const parseCheckoutBootstrapArguments = args => {
  unique(args);
  const [policy, ...flags] = args;
  if (!['locked', 'resolve'].includes(policy)) throw fail('Checkout bootstrap requires its canonical locked or resolve policy.');
  const modes = flags.filter(flag => ['--help', '--plan', '--status', '--verify', '--repair'].includes(flag));
  if (flags.some(flag => !['--help', '--plan', '--status', '--verify', '--repair', '--json'].includes(flag)) || modes.length > 1) throw fail(CHECKOUT_BOOTSTRAP_USAGE);
  const mode = modes.length ? modes[0].slice(2) : 'prepare', json = flags.includes('--json');
  if (json && !['help', 'plan', 'status'].includes(mode)) throw fail('--json requires an information mode.');
  return Object.freeze({ policy, mode, json });
};

export const parseNativeRebuildArguments = args => {
  unique(args);
  if (args.some(flag => !['--help', '--verify', '--repair'].includes(flag)) || args.length > 1) throw fail(NATIVE_REBUILD_USAGE);
  return Object.freeze({ help: args[0] === '--help', verifyOnly: args[0] === '--verify', repairOnly: args[0] === '--repair' });
};
