import { createHash } from 'node:crypto';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { SOURCE_REVISION_PROFILE, SOURCE_REVISION_SCENARIO_SCHEMA } from '../../../src/contracts/schemas/revision-source.js';
import { revisionKey, revisionScenarioId } from './scenario.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), SOURCE_REVISION_SCENARIO_SCHEMA);
export const sourceScenarioError = message => Object.assign(new TypeError(message), { code: 'ERR_SOURCE_REVISION_SCENARIO' });
export const sourceBytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const sourceStateId = files => revisionScenarioId({ profile: SOURCE_REVISION_PROFILE, files });
const ordered = files => [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** This closed grammar constructs inert source data. It never executes it or
 * accepts source templates, commands, modules or caller-provided renderers. */
export const realizeSourceFile = file => {
  const newline = file.prefix === 'unicode-crlf' ? '\r\n' : '\n';
  const prefix = file.prefix === 'bom' ? '\uFEFF' : file.prefix === 'unicode-crlf' ? '// 😀 function fn_decoy() { return 8; }\r\n' : '';
  return prefix + file.declarations.map(row => `${row.exported ? 'export ' : ''}function ${row.name}() { return ${row.value}; }${newline}`).join('');
};
const checkFiles = files => {
  if (files.length > 8 || new Set(files.map(file => file.path)).size !== files.length) throw sourceScenarioError('Source revision files require unique bounded paths.');
  let bytes = 0;
  for (const file of files) {
    if (new Set(file.declarations.map(row => row.name)).size !== file.declarations.length) throw sourceScenarioError('Duplicate function declarations are outside the source grammar.');
    const text = realizeSourceFile(file);
    if (text.length > 16384) throw sourceScenarioError('Source file exceeds the grammar text allowance.');
    bytes += Buffer.byteLength(text);
  }
  if (bytes > 65536) throw sourceScenarioError('Source revision exceeds its byte allowance.');
  return ordered(files);
};
const apply = (files, edit) => {
  const next = new Map(files.map(file => [file.path, file]));
  for (const path of edit.removePaths) if (!next.delete(path)) throw sourceScenarioError('Source revision removes an absent file.');
  if (new Set(edit.putFiles.map(file => file.path)).size !== edit.putFiles.length) throw sourceScenarioError('Source revision writes one path more than once.');
  for (const file of edit.putFiles) next.set(file.path, file);
  return checkFiles([...next.values()]);
};
export const compileSourceRevisionScenario = value => {
  const scenario = captureSemanticRequest(value, SOURCE_REVISION_SCENARIO_SCHEMA);
  if (!validate(scenario)) throw sourceScenarioError('Invalid tiny JavaScript source revision scenario.');
  revisionKey(scenario);
  const states = [checkFiles(scenario.files)], ids = new Set(['base']);
  for (const edit of scenario.revisions) {
    if (ids.has(edit.id) || edit.beforeId !== sourceStateId(states.at(-1))) throw sourceScenarioError('Duplicate source checkpoint or stale source precondition.');
    ids.add(edit.id); const next = apply(states.at(-1), edit);
    if (sourceStateId(next) !== edit.afterId) throw sourceScenarioError('Realized source differs from the declared revision identity.');
    states.push(next);
  }
  return { scenario, states, scenarioId: revisionScenarioId(scenario) };
};
export const sealSourceRevisionEdits = (scenario, edits) => {
  let files = checkFiles(scenario.files);
  const revisions = edits.map(edit => {
    const beforeId = sourceStateId(files); files = apply(files, edit);
    return { id: edit.id, beforeId, afterId: sourceStateId(files), removePaths: edit.removePaths, putFiles: edit.putFiles };
  });
  return compileSourceRevisionScenario({ ...scenario, revisions }).scenario;
};
export const generateSourceRevisionScenario = ({ repositoryNamespace, family, seed = 0, parser = 'babel' }) => {
  if (!['edit-delete-rename', 'coordinate-prefixes', 'same-text-distinct-paths', 'empty-module-retraction'].includes(family)
    || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) throw sourceScenarioError('Unsupported source revision family or seed.');
  const fn = (name, value = seed % 9, exported = false) => ({ name, value, exported });
  const file = (path, declarations, prefix = 'plain') => ({ path, declarations, prefix });
  const first = file('src/first.js', [fn('fn_first'), fn('fn_second', -1, true)]), second = file('src/second.js', [fn('fn_first')]);
  let files = [first, second], edits;
  if (family === 'coordinate-prefixes') {
    files = [first]; edits = ['unicode-crlf', 'bom', 'plain'].map((prefix, index) => ({ id: 'prefix-' + index, removePaths: [], putFiles: [{ ...first, prefix }] }));
  } else if (family === 'same-text-distinct-paths') {
    files = [second, { ...second, path: 'other/second.js' }];
    edits = [{ id: 'rename-one', removePaths: [second.path], putFiles: [{ ...second, path: 'src/renamed.js' }] },
      { id: 'edit-other', removePaths: [], putFiles: [file('other/second.js', [fn('fn_other', -9)])] }];
  } else if (family === 'empty-module-retraction') {
    files = [file(first.path, [])];
    edits = [{ id: 'add-declaration', removePaths: [], putFiles: [first] }, { id: 'empty-again', removePaths: [], putFiles: files },
      { id: 'delete-file', removePaths: [first.path], putFiles: [] }, { id: 'restore-file', removePaths: [], putFiles: [first] }];
  } else edits = [{ id: 'edit-function', removePaths: [], putFiles: [file(first.path, [fn('fn_changed', -9), fn('fn_second', -1, true)])] },
    { id: 'delete-file', removePaths: [second.path], putFiles: [] },
    { id: 'rename-file', removePaths: [first.path], putFiles: [file('src/moved.js', [fn('fn_changed', -9), fn('fn_second', -1, true)])] },
    { id: 'restore-original', removePaths: [], putFiles: [second] }];
  return sealSourceRevisionEdits({ schemaVersion: 1, profile: SOURCE_REVISION_PROFILE, family, seed, repositoryNamespace, parser, files, revisions: [] }, edits);
};
