import { buildCodeRelations } from '../../src/lang/javascript/relations.js';

/** Supplied row fixtures name actual source operands explicitly. Parse those
 * operands without evaluation; a display array alone never certifies arity.
 */
export const withFixtureCallArguments = call => {
  if (!Array.isArray(call.args) || call.args.some(value => typeof value !== 'string')) throw new TypeError('Fixture source arguments must be strings.');
  const text = `fixture(${call.args.join(',')});`;
  const detail = buildCodeRelations(text, 'fixture-call.js').callDetails[0];
  if (!detail?.arguments || detail.arguments.arity.state !== 'exact') throw new Error('Fixture call does not establish exact source operands.');
  return { ...call, extensions: { ...call.extensions, arguments: detail.arguments } };
};
