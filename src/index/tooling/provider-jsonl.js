import { TextDecoder } from 'node:util';
import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { getEnvConfig } from '../../shared/env/runtime.js';
import { combineSemanticProviderOutputs } from './result-dispatch.js';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { throwIfAborted } from '../../shared/abort.js';
import { spawnSubprocess } from '../../shared/subprocess/runner.js';
import { runWithManagedCommandInstallation } from './managed-command-lifetime.js';
import { isRepoTrusted } from '../../shared/config-authority.js';
import { providerProfileCacheIdentity, verifyProviderProfileReceipt } from './provider-profile.js';

export const PROVIDER_JSONL_VERSION = 1;
const fail = (message, code = 'ERR_TOOLING_PROVIDER_PROTOCOL') => Object.assign(new Error(message), { code });
const assertKeys = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw fail('Unsupported JSONL message shape.');
};

/** Bounded protocol decoder; transport remains the shared subprocess owner.
 * No batch becomes durable before a complete final receipt and successful exit. */
export const createProviderJsonlDecoder = ({ request, maxLineBytes = 1048576, maxOutputBytes = 8 * 1048576,
  maxBatches = 64, maxPartitions = 256, signal = null }) => {
  for (const [value, maximum] of [[maxLineBytes, 1048576], [maxOutputBytes, 16 * 1048576], [maxBatches, 1024], [maxPartitions, 4096]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw fail('Invalid provider JSONL budget.');
  }
  if (!request || request.schemaVersion !== 1 || typeof request.requestId !== 'string' || !request.requestId
    || request.requestId.length > 256 || !/^[a-f0-9]{64}$/u.test(request.profileHash)
    || !/^[a-f0-9]{64}$/u.test(request.sourceSnapshotHash) || !request.generation) throw fail('Pinned provider request identity is required.');
  request = JSON.parse(canonicalSemanticJson(request));
  assertSemanticEnvelope('generation', request.generation);
  const requestHash = semanticHash('tooling.jsonl-request.v1', request);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const outputs = [];
  const rowMode = request.resultKind === 'canonical-rows-v1';
  let buffer = '', outputBytes = 0, lineBytes = 0, header = false, final = null, ended = false, failed = false, partitionCount = 0;
  const line = text => {
    throwIfAborted(signal);
    if (!text.length || final) throw fail('Empty or late provider JSONL message.');
    let value;
    try { value = JSON.parse(text); } catch { throw fail('Malformed provider JSONL.'); }
    if (value.type === 'hello') {
      assertKeys(value, ['type', 'protocolVersion', 'requestId', 'requestHash']);
      if (header || value.protocolVersion !== PROVIDER_JSONL_VERSION || value.requestId !== request.requestId || value.requestHash !== requestHash) throw fail('Provider protocol/request negotiation failed.');
      header = true; return;
    }
    if (!header) throw fail('Provider omitted protocol negotiation.');
    if (value.type === 'batch') {
      assertKeys(value, ['type', 'requestId', 'sequence', rowMode ? 'semanticRows' : 'semanticFacts']);
      if (value.requestId !== request.requestId || value.sequence !== outputs.length || outputs.length >= maxBatches) throw fail('Duplicate, future or excessive provider batch.');
      if (rowMode) {
        assertKeys(value.semanticRows, ['sourceUnitId', 'rows']);
        if (typeof value.semanticRows.sourceUnitId !== 'string' || !Array.isArray(value.semanticRows.rows)) throw fail('Malformed provider semantic row batch.');
        if (++partitionCount > maxPartitions) throw fail('Provider row-batch budget exhausted.');
        outputs.push(value.semanticRows); return;
      }
      assertSemanticEnvelope('provider', value.semanticFacts);
      partitionCount += value.semanticFacts.partitions.length;
      if (partitionCount > maxPartitions) throw fail('Provider partition budget exhausted.');
      outputs.push(value.semanticFacts); return;
    }
    if (value.type === 'final') {
      assertKeys(value, ['type', 'requestId', 'complete', 'batchCount', 'partitionCount', 'outputHash']);
      if (value.requestId !== request.requestId || value.complete !== true || value.batchCount !== outputs.length
        || value.partitionCount !== partitionCount) throw fail('Incomplete or inconsistent provider final receipt.');
      const output = rowMode ? { schemaVersion: 1, kind: 'canonical-rows-v1', batches: outputs } : combineSemanticProviderOutputs(outputs);
      if (value.outputHash !== semanticHash(rowMode ? 'tooling.jsonl-rows.v1' : 'tooling.jsonl-output.v1', output)) throw fail('Provider output receipt digest mismatch.');
      final = { output, receipt: value }; return;
    }
    throw fail('Unknown provider JSONL message.');
  };
  const append = text => {
    buffer += text;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const current = buffer.slice(0, newline);
      if (Buffer.byteLength(current) > maxLineBytes) throw fail('Provider JSONL line budget exhausted.');
      line(current.endsWith('\r') ? current.slice(0, -1) : current);
      buffer = buffer.slice(newline + 1);
    }
    lineBytes = Buffer.byteLength(buffer);
    if (lineBytes > maxLineBytes) throw fail('Provider JSONL line budget exhausted.');
  };
  return {
    requestHash,
    push(chunk) {
      if (ended || failed) throw fail('Provider decoder is closed.');
      try {
        throwIfAborted(signal);
        if (!(chunk instanceof Uint8Array)) throw fail('Provider decoder requires original UTF-8 bytes.');
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) throw fail('Provider output byte budget exhausted.');
        append(decoder.decode(chunk, { stream: true }));
      } catch (error) { failed = true; throw error; }
    },
    finish() {
      if (ended || failed) throw fail('Provider decoder is closed.');
      ended = true; throwIfAborted(signal);
      append(decoder.decode());
      if (buffer.length) line(buffer);
      if (!header || !final) throw fail('Provider ended without a complete final receipt.');
      return { ...final, requestHash, outputBytes, batchCount: outputs.length };
    }
  };
};

/** Offline import grants no authority to run the report's declared producer.
 * The caller supplies the original producer request receipt, not a hash of
 * whatever working-tree bytes happen to exist at import time. */
export const importProviderJsonlReport = async ({ chunks, request, semanticSink = null, rowWriter = null, signal = null, ...budgets }) => {
  const decoder = createProviderJsonlDecoder({ request, signal, ...budgets });
  for await (const chunk of chunks) { throwIfAborted(signal); decoder.push(chunk); }
  const result = decoder.finish();
  throwIfAborted(signal);
  if (result.output.kind === 'canonical-rows-v1') {
    if (typeof rowWriter !== 'function') throw fail('Canonical provider rows require a host-owned writer.');
    result.output = await rowWriter(result.output, { signal });
  }
  if (semanticSink) result.admission = await semanticSink(result.output, { signal });
  return result;
};

/** A subprocess is not an OS sandbox. Run only a launch-selected, observed
 * command under the existing exact repository trust authority. */
export const runJsonlProvider = async ({ command, profile, request, repoRoot, semanticSink = null,
  rowWriter = null, toolingRoot = null, timeoutMs = 30000, maxInputBytes = 1048576, maxStderrBytes = 65536, signal = null, ...budgets }) => {
  throwIfAborted(signal);
  if (!Array.isArray(command) || !command.length || command.some(value => typeof value !== 'string' || !value || value.includes('\0'))
    || !Array.isArray(profile?.tool?.resolvedCommand)
    || canonicalSemanticJson(command) !== canonicalSemanticJson(profile?.tool?.resolvedCommand)
    || !isRepoTrusted(repoRoot)) throw fail('Provider command has no exact repository execution authority.', 'ERR_TOOLING_PROVIDER_DENIED');
  const profileHash = providerProfileCacheIdentity(profile, { providerId: profile.providerId, adapterVersion: profile.adapterVersion, repoRoot });
  if (!profileHash || request.profileHash !== profileHash) throw fail('Provider request does not match its observed profile.');
  await verifyProviderProfileReceipt(profile, { signal });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || !Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > 1048576
    || !Number.isSafeInteger(maxStderrBytes) || maxStderrBytes < 1 || maxStderrBytes > 1048576) throw fail('Invalid provider process budget.');
  const input = canonicalSemanticJson(request) + '\n';
  if (Buffer.byteLength(input) > maxInputBytes) throw fail('Provider input byte budget exhausted.');
  const decoder = createProviderJsonlDecoder({ request, signal, ...budgets });
  let stderrBytes = 0, stderr = '';
  const processResult = await runWithManagedCommandInstallation({
    toolingRoot: toolingRoot || getEnvConfig().toolingDir || null, command: command[0]
  }, ({ onSpawn }) => spawnSubprocess(command[0], command.slice(1), { cwd: repoRoot, input, onSpawn,
    signal, timeoutMs, shell: false, killTree: true, captureStdout: false, captureStderr: false,
    outputEncoding: 'latin1', onStdout: text => decoder.push(Buffer.from(text, 'latin1')),
    onStderr: text => {
      stderrBytes += Buffer.byteLength(text, 'latin1');
      if (stderrBytes > maxStderrBytes) throw fail('Provider diagnostic byte budget exhausted.');
      if (stderr.length < 4096) stderr += text.slice(0, 4096 - stderr.length);
    } }));
  throwIfAborted(signal);
  if (!isRepoTrusted(repoRoot)) throw fail('Provider repository execution authority was revoked.', 'ERR_TOOLING_PROVIDER_DENIED');
  await verifyProviderProfileReceipt(profile, { signal });
  const result = { ...decoder.finish(), process: { exitCode: processResult.exitCode, stderrBytes, stderr } };
  if (result.output.kind === 'canonical-rows-v1') {
    if (typeof rowWriter !== 'function') throw fail('Canonical provider rows require a host-owned writer.');
    result.output = await rowWriter(result.output, { signal });
  }
  if (!isRepoTrusted(repoRoot)) throw fail('Provider repository execution authority was revoked.', 'ERR_TOOLING_PROVIDER_DENIED');
  if (semanticSink) result.admission = await semanticSink(result.output, { signal });
  return result;
};
