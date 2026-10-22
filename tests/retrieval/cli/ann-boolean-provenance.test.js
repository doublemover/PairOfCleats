import assert from 'node:assert/strict';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { normalizeSearchOptions } from '../../../src/retrieval/cli/normalize-options.js';
const resolve = (rawArgs, annDefault) => normalizeSearchOptions({ argv: parseSearchArgs(rawArgs), rawArgs,
  rootDir: process.cwd(), userConfig: { search: { annDefault } }, metricsDir: null, policy: {} });
for (const annDefault of [true, false]) {
  for (const [args, expected] of [[['--ann=false'], false], [['--ann=true'], true],
    [['--ann', 'false'], false], [['--no-ann'], false], [['--ann'], true],
    [['--ann=true', '--ann=false'], false], [['--no-ann', '--ann=true'], true]]) {
    const options = resolve([...args, 'alpha'], annDefault);
    assert.equal(options.annFlagPresent, true);
    assert.equal(options.annEnabled, expected, JSON.stringify(args));
  }
  assert.equal(resolve(['alpha'], annDefault).annFlagPresent, false);
  assert.equal(resolve(['alpha'], annDefault).annEnabled, annDefault);
  assert.equal(resolve(['--', '--ann=false'], annDefault).annFlagPresent, false, 'positional text is not option intent');
}
console.log('effective ANN intent follows canonical Boolean parse provenance');
