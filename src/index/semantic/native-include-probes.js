import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isWithinRoot } from '../../workspace/identity.js';
import { assertNoSymlinkPath } from '../../shared/contained-file.js';
import { throwIfAborted } from '../../shared/abort.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';

const MAX_SOURCE_BYTES = 16 * 1024 * 1024, MAX_SOURCE_FILES = 512, MAX_ENTRIES = 64;
const MAX_PROBES = 4096, MAX_CONTEXTS = 4096, MAX_DIRECTIVES = 4096;
const MAX_RESOLUTION_REQUESTS = MAX_ENTRIES * MAX_DIRECTIVES;
const MAX_CONTEXT_BYTES = 8 * 1024 * 1024, MAX_PREPARATION_BYTES = 16 * 1024 * 1024;
const MAX_PROBE_METADATA_BYTES = 8 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });

const preprocessingText = (input, signal) => {
  const text = input.replace(/\\\r?\n/g, '');
  let result = '', quote = null, comment = null;
  for (let index = 0; index < text.length; index += 1) {
    if ((index & 4095) === 0) throwIfAborted(signal);
    const char = text[index], next = text[index + 1];
    if (comment === 'line') { if (char === '\n') { comment = null; result += '\n'; } continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = null; index += 1; } else if (char === '\n') result += '\n'; continue; }
    if (quote) {
      result += char;
      if (char === '\\') { result += next || ''; index += 1; }
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; result += char; }
    else if (char === '/' && (next === '/' || next === '*')) { comment = next === '/' ? 'line' : 'block'; result += ' '; index += 1; }
    else result += char;
  }
  return result;
};

/** @typedef {{spelling:string,form:'quote'|'angle',preprocessedStart:number,preprocessedEnd:number}} ParsedInclude */
/** @typedef {{filename:string,sourceDirectory:string,sourceSha256:string,includes:ReadonlyArray<ParsedInclude>}} ParsedIncludeSummary */
/** @typedef {{sourceDirectory:string,roots:ReadonlyArray<string>,semanticFlags:string[],form:string,resolved:Set<string>}} IncludeSearchContext */
/** @typedef {{path:string,exists:boolean,identity:object|null}} ProbeObservation */

const parseIncludes = (filename, rawText, work, signal, stop) => {
  const bytes = Buffer.byteLength(rawText);
  if (bytes > 1024 * 1024 || work.sourceBytesScanned + bytes > MAX_SOURCE_BYTES) stop('source-bytes', 'Native include source bytes exceed their allowance.');
  work.sourceBytesScanned += bytes; work.sourceCodeUnits += rawText.length; work.sourceParseCalls++;
  const text = preprocessingText(rawText, signal), includes = [];
  if (/\?\?|%:|__DATE__|__TIME__|__TIMESTAMP__|__has_include|__has_embed|_Pragma|__pragma|__builtin_(?:available|dump_struct)/.test(text)) throw fail('Native dynamic/trigraph/digraph preprocessing is outside sealed authority.');
  for (const match of text.matchAll(/^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)\b([^\n]*)/gm)) {
    throwIfAborted(signal);
    if (++work.preprocessingDirectives > MAX_DIRECTIVES) stop('directives', 'Native preprocessing directive inventory exceeds its allowance.');
    if (!['include', 'define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else', 'endif', 'error', 'warning'].includes(match[1])) throw fail('Native preprocessing directive is outside sealed authority.');
    if (match[1] !== 'include') continue;
    const target = /^\s*("[^">]+"|<[^">]+>)\s*$/.exec(match[2]);
    if (!target) throw fail('Native macro/mismatched includes require a separately qualified closure.');
    work.directiveOccurrences++;
    includes.push(Object.freeze({ spelling: target[1].slice(1, -1), form: target[1][0] === '"' ? 'quote' : 'angle',
      preprocessedStart: match.index, preprocessedEnd: match.index + match[0].length }));
  }
  return Object.freeze({ filename, sourceDirectory: path.dirname(filename), sourceSha256: createHash('sha256').update(rawText, 'utf16le').digest('hex'), includes: Object.freeze(includes) });
};

/** Snapshot-local lexical and probe authority. The returned legacy row array has
 * a non-enumerable immutable work receipt; no reader or process cache survives. */
export const collectNativeIncludeProbes = async ({ repoRoot, entries, textByPath, present, signal }) => {
  const work = { schemaVersion: 1, complete: false, phase: 'admission', exhaustedBudget: null,
    sourceParseCalls: 0, sourceBytesScanned: 0, sourceCodeUnits: 0, preprocessingDirectives: 0, directiveOccurrences: 0,
    resolutionRequests: 0, resolutionContexts: 0, searchContexts: 0, contextReuseHits: 0,
    contextPreparationBytes: 0, retainedContextBytes: 0, candidateRequests: 0,
    uniqueProbes: 0, probeReuseHits: 0, lstatCalls: 0, containmentChecks: 0, verificationProbes: 0,
    retainedRows: 0, retainedBytes: 2, retainedProbeMetadataBytes: 0 };
  const stop = (budget, message) => { work.exhaustedBudget = budget; throw fail(message); };
  try {
    throwIfAborted(signal);
    repoRoot = path.resolve(repoRoot);
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES || !(textByPath instanceof Map) || textByPath.size > MAX_SOURCE_FILES || !(present instanceof Set) || present.size > MAX_SOURCE_FILES) stop('source-or-entry-count', 'Native include input exceeds its inventory allowance.');
    const presentSnapshot = new Set(present), scannedPaths = new Set(textByPath.keys()), entrySnapshots = [];
    for (const entry of entries) {
      throwIfAborted(signal);
      if (!entry || typeof entry.file !== 'string' || !present.has(entry.file) || !textByPath.has(entry.file)) throw fail('Native compilation source was not inventoried/scanned.');
      if (!Array.isArray(entry.includeRoots) || entry.includeRoots.length > 128
        || entry.includeRoots.some(root => typeof root !== 'string' || !isWithinRoot(path.resolve(root), repoRoot))) throw fail('Native include roots are outside sealed authority.');
      if (entry.arguments != null && (!Array.isArray(entry.arguments) || entry.arguments.length > 128
        || entry.arguments.some(arg => typeof arg !== 'string' || arg.length > 4096))) throw fail('Native include arguments are outside sealed authority.');
      entrySnapshots.push({ file: entry.file, includeRoots: [...entry.includeRoots], arguments: [...(entry.arguments || [])] });
    }
    work.phase = 'lexical';
    /** @type {ParsedIncludeSummary[]} */
    const summaries = [];
    for (const [filename, rawText] of textByPath) {
      throwIfAborted(signal);
      if (typeof filename !== 'string' || filename !== path.resolve(filename) || !/\.(?:c|h|inc)$/u.test(filename)
        || !isWithinRoot(filename, repoRoot) || typeof rawText !== 'string' || !present.has(filename)) throw fail('Native include source snapshot is unqualified.');
      summaries.push(parseIncludes(filename, rawText, work, signal, stop));
    }
    /** @type {Map<string,ProbeObservation>} */
    const observations = new Map();
    const searchContexts = new Map();
    const inspect = async candidate => {
      throwIfAborted(signal);
      const contained = () => {
        work.containmentChecks++;
        try { assertNoSymlinkPath(repoRoot, candidate, { allowMissing: true }); }
        catch (error) { if (describeStorageFailure(error, { phase: 'native-include-containment' }).code !== 'ENOTDIR') throw error; }
      };
      contained(); work.lstatCalls++;
      let stat = null;
      try { stat = await fs.lstat(candidate, { bigint: true }); }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(describeStorageFailure(error, { phase: 'native-include-lstat' }).code)) throw error; }
      throwIfAborted(signal); contained();
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw fail('Native include candidate is not an ordinary project file.');
      if (stat && !presentSnapshot.has(candidate)) throw fail('Native include candidate was not inventoried.');
      if (stat && !scannedPaths.has(candidate)) throw fail('Native included file requires a supported scanned source extension.');
      return Object.freeze({ path: candidate, exists: stat !== null, identity: stat ? Object.freeze(Object.fromEntries(
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(key => [key, String(stat[key])]))) : null });
    };
    work.phase = 'resolution';
    for (const entry of entrySnapshots) {
      const semanticFlags = (entry.arguments || []).filter(arg => /^-D|^-std=/u.test(arg));
      const entryRoots = [...new Set(entry.includeRoots.map(root => path.resolve(root)))];
      const localContexts = { quote: new Map(), angle: new Map() };
      for (const summary of summaries) for (const include of summary.includes) {
        throwIfAborted(signal);
        if (++work.resolutionRequests > MAX_RESOLUTION_REQUESTS) stop('resolution-work', 'Native include resolution work exceeds its allowance.');
        const sourceDirectory = summary.sourceDirectory, local = localContexts[include.form];
        let context = local.get(sourceDirectory);
        if (!context) {
          const roots = [...new Set([...(include.form === 'quote' ? [sourceDirectory] : []), ...entryRoots])];
          const key = JSON.stringify([sourceDirectory, roots, semanticFlags, include.form]), bytes = Buffer.byteLength(key);
          work.contextPreparationBytes += bytes;
          if (work.contextPreparationBytes > MAX_PREPARATION_BYTES) stop('context-preparation-bytes', 'Native include context preparation exceeds its byte allowance.');
          context = searchContexts.get(key);
          if (!context) {
            if (work.retainedContextBytes + bytes > MAX_CONTEXT_BYTES) stop('retained-context-bytes', 'Native include contexts exceed their retained byte allowance.');
            context = { sourceDirectory, roots: Object.freeze(roots), semanticFlags, form: include.form, resolved: new Set() }; searchContexts.set(key, context);
            work.retainedContextBytes += bytes; work.searchContexts++;
          }
          local.set(sourceDirectory, context);
        }
        if (context.resolved.has(include.spelling)) { work.contextReuseHits++; continue; }
        if (work.resolutionContexts >= MAX_CONTEXTS) stop('resolution-contexts', 'Native include resolution contexts exceed their allowance.');
        const includeBytes = Buffer.byteLength(include.spelling);
        if (work.retainedContextBytes + includeBytes > MAX_CONTEXT_BYTES) stop('retained-context-bytes', 'Native include contexts exceed their retained byte allowance.');
        context.resolved.add(include.spelling); work.retainedContextBytes += includeBytes; work.resolutionContexts++;
        for (const root of context.roots) {
          throwIfAborted(signal); work.candidateRequests++;
          const candidate = path.resolve(root, include.spelling);
          if (!isWithinRoot(candidate, repoRoot)) throw fail('Native include probe escapes its project.');
          let observation = observations.get(candidate);
          if (observation) work.probeReuseHits++;
          else {
            if (observations.size >= MAX_PROBES) stop('unique-probes', 'Native include probe inventory exceeds its allowance.');
            observation = await inspect(candidate);
            const metadataBytes = Buffer.byteLength(JSON.stringify(observation));
            if (work.retainedProbeMetadataBytes + metadataBytes > MAX_PROBE_METADATA_BYTES) stop('probe-metadata-bytes', 'Native include observations exceed their metadata byte allowance.');
            work.retainedProbeMetadataBytes += metadataBytes;
            work.retainedBytes += Buffer.byteLength(JSON.stringify({ path: candidate, exists: observation.exists })) + (work.retainedRows ? 1 : 0);
            work.retainedRows++; observations.set(candidate, observation); work.uniqueProbes++;
          }
          if (observation.exists) break;
        }
      }
    }
    // Memoization is local to this operation. Reobserve each unique witness once
    // before granting completeness, including negatives that became present.
    work.phase = 'verification';
    for (const observation of observations.values()) {
      const current = await inspect(observation.path); work.verificationProbes++;
      if (JSON.stringify(current) !== JSON.stringify(observation)) throw fail('Native include observation changed during construction.');
    }
    const probes = [...observations.values()].map(({ path: filename, exists }) => Object.freeze({ path: filename, exists }));
    work.retainedRows = probes.length; work.retainedBytes = Buffer.byteLength(JSON.stringify(probes));
    work.complete = true; work.phase = 'completed';
    Object.defineProperty(probes, 'work', { value: Object.freeze({ ...work }) });
    return probes;
  } catch (error) { throw addStorageFailureContext(error, { includeProbeWork: Object.freeze({ ...work }) }); }
};
