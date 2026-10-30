import { createSemanticLspSession } from './lsp-session.js';
import { NATIVE_SEMANTIC_LANGUAGES } from './native-syntax.js';
import { mergeSemanticProviderOutput } from './merge-provider.js';
import { combineSemanticProviderOutputs } from '../tooling/result-dispatch.js';
import { prepareToolingPassDocuments, runToolingPass } from '../type-inference-crossfile/tooling.js';
import { throwIfAborted } from '../../shared/abort.js';
import { nativeExecutionAuthority } from './native-execution-context.js';
import { SCHEDULER_QUEUE_NAMES } from '../build/runtime/scheduler.js';

/** Native providers do not borrow a TypeScript Program's lease/admission grant.
 * Explicit eager bindings retain their existing path; sealed deferred C bindings
 * run the same provider body within their already admitted durable batch.
 */
export const runNativeSemanticProviders = async ({ state, runtime, toolingConfig, log, signal = null,
  runPass = runToolingPass }) => {
  const authority = nativeExecutionAuthority(state);
  if (authority) toolingConfig = { ...toolingConfig, clangd: { ...toolingConfig?.clangd,
    enabled: true, cmd: authority.launch.cmd, args: authority.launch.args, fallbackFlags: [],
    autoInferIncludeRoots: false, requireCompilationDatabase: true, semanticAuthorityHash: authority.authorityHash } };
  const session = await createSemanticLspSession({ state, runtime, signal,
    languages: authority ? ['c'] : NATIVE_SEMANTIC_LANGUAGES, eagerOnly: !authority });
  if (!session.enabled || typeof runtime.scheduler?.schedule !== 'function') return { ran: false };
  // The dedicated pass has occurrence targets only; legacy type work keeps its
  // existing separately enabled pass and must not be enabled by semantic policy.
  const chunks = [];
  const toolingDocuments = await prepareToolingPassDocuments({ chunks, fileTextByFile: session.fileTextByFile,
    toolingConfig, semanticLspSession: session, log });
  let targeted = false;
  for (const doc of toolingDocuments.documents) if ((await session.targetsForDocument(doc)).length) { targeted = true; break; }
  if (!targeted) return { ran: false };
  const bytes = [...session.fileTextByFile.values()].reduce((total, text) => total + Buffer.byteLength(text), 0);
  let output = null;
  const body = async () => {
    throwIfAborted(signal);
    const result = await runPass({ rootDir: runtime.root, buildRoot: runtime.buildRoot, chunks, entryByUid: new Map(), log,
      toolingConfig, toolingDocuments, fileTextByFile: session.fileTextByFile, abortSignal: signal,
      semanticLspSession: session, applyTypes: false });
    throwIfAborted(signal);
    output = combineSemanticProviderOutputs([session.output(), ...(result?.semanticFacts ? [result.semanticFacts] : [])]);
    await mergeSemanticProviderOutput({ output, state, runtime, signal });
  };
  if (authority) await body();
  else await runtime.scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2Relations, { cpu: 1, io: 1, mem: 1, bytes: Math.max(1048576, bytes), signal }, body);
  return { ran: true, output };
};
