import { createHash } from 'node:crypto';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { SOURCE_REVISION_OUTPUT_SCHEMA } from '../../../src/contracts/schemas/revision-source.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { revisionKey } from './scenario.js';
import { compileSourceRevisionScenario } from './source-scenario.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), SOURCE_REVISION_OUTPUT_SCHEMA);
export const captureSourceRevisionOutput = value => {
  const result = captureSemanticRequest(value, SOURCE_REVISION_OUTPUT_SCHEMA);
  if (!validate(result)) throw new TypeError('Invalid source revision output.'); return result;
};
/** Independent grammar interpretation: no parser, chunk/range, source-snapshot,
 * cache or candidate extraction helper is imported. Positions come from the
 * declared construction, including the excluded export wrapper and UTF-16 BOM
 * and astral-comment prefix. This establishes only this finite syntax profile. */
export const referenceSourceRevision = (files, { maxReferenceFiles = 8, signal = null, check = () => true } = {}) => {
  if (!Number.isSafeInteger(maxReferenceFiles) || maxReferenceFiles < 0 || maxReferenceFiles > 8) throw new RangeError('Invalid source reference allowance.');
  const output = []; let examined = 0;
  for (const file of files) {
    throwIfAborted(signal);
    if (examined >= maxReferenceFiles || !check()) return { output: null, examined, reason: 'reference-work-budget' };
    examined++;
    let source = file.prefix === 'bom' ? String.fromCharCode(65279) : file.prefix === 'unicode-crlf' ? '// 😀 function fn_decoy() { return 8; }\r\n' : '';
    let line = file.prefix === 'unicode-crlf' ? 2 : 1;
    const chunks = [];
    for (const row of file.declarations) {
      const wrapper = row.exported ? 'export ' : '', start = source.length + wrapper.length;
      const declaration = 'function ' + row.name + '() { return ' + String(row.value) + '; }';
      chunks.push({ name: row.name, kind: row.exported ? 'ExportedFunction' : 'FunctionDeclaration', start, end: start + declaration.length,
        startLine: line, endLine: line, text: declaration });
      source += wrapper + declaration + (file.prefix === 'unicode-crlf' ? '\r\n' : '\n'); line++;
    }
    if (!chunks.length) chunks.push({ name: 'root', kind: 'Module', start: 0, end: source.length, startLine: null, endLine: null, text: source });
    output.push({ path: file.path, byteHash: createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex'),
      textLength: source.length, byteLength: Buffer.byteLength(source, 'utf8'), chunks });
  }
  if (!check()) return { output: null, examined, reason: 'reference-work-budget' };
  return { output: captureSourceRevisionOutput(output), examined, reason: null };
};
/** Index eligibility and resolved fallback lines are distinct from the AST
 * projection above. Derive them from the constructed text, never candidate
 * discovery, line-index or publication helpers. */
export const referencePublishedSourceRevision = (files, options = {}) => {
  const reference = referenceSourceRevision(files, options);
  if (reference.output === null) return reference;
  const output = reference.output.filter(row => row.byteLength > 0).map(row => ({ ...row,
    chunks: row.chunks.map(chunk => chunk.kind === 'Module' ? { ...chunk, startLine: 1,
      endLine: chunk.text.slice(0, Math.max(0, chunk.text.length - 1)).split('\n').length } : chunk) }));
  return { ...reference, output: captureSourceRevisionOutput(output) };
};
/** Diagnostic comparison cannot manufacture an original execution handle. */
export const compareSourceRevisionOutput = ({ scenario, checkpoint, actual }) => {
  const compiled = compileSourceRevisionScenario(scenario);
  if (!Number.isSafeInteger(checkpoint) || checkpoint < 0 || checkpoint >= compiled.states.length) throw new RangeError('Invalid source checkpoint.');
  const expected = referenceSourceRevision(compiled.states[checkpoint]).output;
  actual = captureSourceRevisionOutput(actual);
  return Object.freeze({ outcome: revisionKey(expected) === revisionKey(actual) ? 'pass' : 'fail', expected, actual });
};
