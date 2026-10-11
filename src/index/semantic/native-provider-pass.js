import { createSemanticLspSession } from './lsp-session.js';
import { NATIVE_SEMANTIC_LANGUAGES } from './native-syntax.js';
import { mergeSemanticProviderOutput } from './merge-provider.js';
import { prepareToolingPassDocuments, runToolingPass } from '../type-inference-crossfile/tooling.js';
import { throwIfAborted } from '../../shared/abort.js';

/** Native providers do not borrow a TypeScript Program's lease/admission grant.
 * Only explicit eager bindings run here. Deferred native provider tasks need a
 * sealed compiler closure before they can use the durable enrichment frontier.
 */
export const runNativeSemanticProviders = async ({ state, runtime, toolingConfig, log, signal = null,
  runPass = runToolingPass }) => {
  const session = await createSemanticLspSession({ state, runtime, signal,
    languages: NATIVE_SEMANTIC_LANGUAGES, eagerOnly: true });
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
  await runtime.scheduler.schedule('relations', { cpu: 1, io: 1, mem: 1, bytes: Math.max(1048576, bytes), signal }, async () => {
    throwIfAborted(signal);
    await runPass({ rootDir: runtime.root, buildRoot: runtime.buildRoot, chunks, entryByUid: new Map(), log,
      toolingConfig, toolingDocuments, fileTextByFile: session.fileTextByFile, abortSignal: signal,
      semanticLspSession: session, applyTypes: false });
    throwIfAborted(signal);
    await mergeSemanticProviderOutput({ output: session.output(), state, runtime, signal });
  });
  return { ran: true };
};
