import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/retrieval/cli.js')) return { format: 'module', shortCircuit: true, source:
    'export const INTERNAL_EXACT_SEARCH_MODE = Symbol.for("test-exact-mode"); export const runSearchCli = async args => ({args});' };
  return next(url, context);
} });
try {
  const { search } = await import('../../src/integrations/core/search.js');
  const base = { query: 'needle', mode: 'prose', backend: 'memory', ann: false, json: true, cursor: 'authored-cursor' };
  const absent = (await search('.', base)).args;
  assert.deepEqual((await search('.', { ...base, args: [] })).args, absent);
  const extra = (await search('.', { ...base, args: ['--compact'] })).args;
  for (const flag of ['--mode', '--backend', '--no-ann', '--json', '--cursor', '--compact']) assert.ok(extra.includes(flag), flag);
  assert.deepEqual(extra.slice(-2), ['--', 'needle']);
  assert.equal(extra.filter(arg => arg === 'needle').length, 1);
  assert.deepEqual((await search('.', { ...base, argsMode: 'complete', args: ['--mode', 'code'] })).args,
    ['--mode', 'code', '--', 'needle']);
  await assert.rejects(search('.', { argsMode: 'complete', args: [], context: 3 }), /removed|context/i);
  const { hasHelpArg, hasVersionArg } = await import('../../src/retrieval/cli/search-entry.js');
  const { inferJsonOutputFromArgs } = await import('../../src/retrieval/cli/runner.js');
  const { parseSearchArgs } = await import('../../src/retrieval/cli-args.js');
  for (const literal of ['--help', '-h', '--version', '-v', '--path', '--context', '--json']) {
    const args = ['--', literal];
    assert.equal(hasHelpArg(args), false);
    assert.equal(hasVersionArg(args), false);
    assert.equal(inferJsonOutputFromArgs(args).jsonOutput, false);
    assert.deepEqual(parseSearchArgs(args)._, [literal]);
  }
  assert.equal(hasHelpArg(['--help', '--', 'needle']), true);
  assert.equal(hasVersionArg(['--version']), true);
  assert.throws(() => parseSearchArgs(['--context', '3', 'needle']), /removed/);
} finally { hook.deregister(); }
console.log('core additional arguments and option preflight passed');
