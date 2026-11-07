import { createFramedJsonRpcParser } from '../../src/shared/jsonrpc.js';
import {
  buildInitializeResult,
  formatToolError,
  sendError as protocolSendError,
  sendNotification as protocolSendNotification,
  sendResult as protocolSendResult
} from '../../src/integrations/mcp/protocol.js';
import { createMcpOutput } from '../../src/integrations/mcp/output.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { attachObservability, normalizeObservability } from '../../src/shared/observability.js';
import { logError } from '../../src/shared/progress-runtime.js';
import { withTimeout } from './runner.js';
import { classifyMcpToolLane, resolveMcpLaneAdmission } from './lane-policy.js';

// Match the SDK request-ID domain without importing its full schema graph into
// the legacy transport. A key identifies the typed primitive, not its label.
const requestIdKey = value => typeof value === 'string' ? `s:${value}`
  : Number.isSafeInteger(value) ? `n:${value}` : null;

/**
 * Start the MCP stdio transport.
 * @param {{toolDefs:any,schemaVersion?:string,toolVersion?:string,serverInfo:{name:string,version:string},handleToolCall:Function,resolveToolTimeoutMs:Function,queueMax:number,maxBufferBytes?:number,capabilities?:object,capabilityManifest?:object}} config
 */
export const createMcpTransport = ({
  toolDefs,
  schemaVersion,
  toolVersion,
  serverInfo,
  handleToolCall,
  resolveToolTimeoutMs,
  queueMax,
  maxBufferBytes,
  capabilities,
  capabilityManifest,
  input = process.stdin,
  outputStream = process.stdout,
  exit = code => process.exit(code),
  outputLimits
}) => {
  const inFlight = new Map();
  const activeTasks = new Set();
  let closing = false, stopped = false, stopPromise = null, closePromise = null, parser = null;
  const output = createMcpOutput({ ...outputLimits, stream: outputStream, onFailure: onOutputFailure });
  const sendTerminal = async (id, write) => {
    try { return await write(); }
    catch (error) {
      if (error?.code !== 'ERR_JSONRPC_MESSAGE_LIMIT') throw error;
      // Preserve the ID and strict error envelope; replace an oversized result
      // once, without recursively adding overload errors to a failed channel.
      try {
        await protocolSendError(id, -32603, 'Response exceeds output allowance.', output,
          { code: ERROR_CODES.INTERNAL, reason: 'output-limit' });
      } catch (fallbackError) { output.abort(fallbackError); throw fallbackError; }
    }
  };
  const sendResult = (id, result) => sendTerminal(id, () => protocolSendResult(id, result, output));
  const sendError = (id, code, message, _output, data) => sendTerminal(id,
    () => protocolSendError(id, code, message, output, data));
  const sendNotification = (method, params) => protocolSendNotification(method, params, output);
  const pendingById = new Map();
  const laneQueues = {
    fast: [],
    slow: []
  };
  const laneConcurrency = {
    fast: 1,
    slow: 1
  };
  const laneActive = {
    fast: 0,
    slow: 0
  };
  const progressState = new Map();
  const PROGRESS_THROTTLE_MS = 250;
  const attachToolResultObservability = (result, requestObservability) => (
    result && typeof result === 'object' && !Array.isArray(result) && result.observability
      ? result
      : attachObservability(result, requestObservability)
  );

  const sendProgress = (id, tool, payload, observability = null) => {
    if (closing) return;
    if (id === null || id === undefined) return;
    const message = payload?.message ? String(payload.message) : '';
    if (!message) return;
    const idKey = requestIdKey(id);
    const now = Date.now();
    const state = progressState.get(idKey) || { lastSent: 0, timer: null, pending: null };
    const emit = (nextPayload) => {
      const nextMessage = nextPayload?.message ? String(nextPayload.message) : '';
      if (!nextMessage) return;
      Promise.resolve(sendNotification('notifications/progress', {
        id,
        tool,
        message: nextMessage,
        stream: nextPayload?.stream || 'info',
        phase: nextPayload?.phase || 'progress',
        ts: new Date().toISOString(),
        observability: nextPayload?.observability || observability || null
      })).catch(onOutputFailure);
      state.lastSent = Date.now();
      state.pending = null;
    };
    if (!state.lastSent || (now - state.lastSent) >= PROGRESS_THROTTLE_MS) {
      emit(payload);
      progressState.set(idKey, state);
      return;
    }
    state.pending = payload;
    if (!state.timer) {
      const delay = Math.max(0, PROGRESS_THROTTLE_MS - (now - state.lastSent));
      state.timer = setTimeout(() => {
        state.timer = null;
        if (state.pending) {
          emit(state.pending);
        }
      }, delay);
      state.timer.unref?.();
    }
    progressState.set(idKey, state);
  };

  const clearProgressState = (idKey) => {
    const state = progressState.get(idKey);
    if (state?.timer) clearTimeout(state.timer);
    progressState.delete(idKey);
  };

  const sendCancelledResponse = (id) => {
    const payload = formatToolError({ code: ERROR_CODES.CANCELLED, message: 'Request cancelled.' });
    return sendResult(id, {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      isError: true
    });
  };

  const totalActive = () => laneActive.fast + laneActive.slow;
  const laneOccupancy = lane => {
    let count = laneActive[lane] || 0;
    for (const task of pendingById.values()) if (task.lane === lane) count++;
    return count;
  };
  const classifyToolLane = (name, timeoutMs) => classifyMcpToolLane(name, timeoutMs, { allowShortTimeoutFast: true });
  const resolveOverloadDecision = lane => resolveMcpLaneAdmission({ lane, queueMax,
    occupancy: { fast: laneOccupancy('fast'), slow: laneOccupancy('slow') } });

  const removePendingTask = (idKey) => {
    if (!pendingById.has(idKey)) return null;
    const task = pendingById.get(idKey);
    const queue = laneQueues[task?.lane] || [];
    const index = queue.findIndex((entry) => entry.idKey === idKey);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    return task || null;
  };

  const resolveActiveRequestState = (idKey) => {
    const pending = pendingById.has(idKey);
    const running = inFlight.has(idKey);
    if (pending && running) return 'pending-and-running';
    if (running) return 'running';
    if (pending) return 'pending';
    return null;
  };

  const rejectDuplicateRequestId = async (id, idKey) => {
    const state = resolveActiveRequestState(idKey);
    if (!state) return false;
    await sendError(id, -32600, 'Duplicate request id while prior request is still pending or running.', undefined, {
      code: ERROR_CODES.INVALID_REQUEST,
      reason: 'duplicate-request-id',
      requestId: id,
      state
    });
    return true;
  };

  const cancelPendingTask = task => {
    if (task.response) return task.response;
    removePendingTask(task.idKey);
    clearProgressState(task.idKey);
    task.response = sendCancelledResponse(task.id).finally(() => pendingById.delete(task.idKey));
    return task.response;
  };

  const applyCancellation = async (params) => {
    const cancelKey = requestIdKey(params?.id);
    if (cancelKey === null) return false;
    const entry = inFlight.get(cancelKey);
    if (entry) {
      entry.cancelled = true;
      entry.controller.abort();
      return true;
    }
    const pendingTask = removePendingTask(cancelKey);
    if (pendingTask) {
      await cancelPendingTask(pendingTask);
      return true;
    }
    return false;
  };

  const processTask = async (task) => {
    const {
      id,
      idKey,
      lane,
      name,
      args,
      timeoutMs
    } = task;
    const controller = new AbortController();
    const requestObservability = normalizeObservability({
      correlationId: task.meta?.correlationId || null,
      parentCorrelationId: task.meta?.parentCorrelationId || null,
      requestId: task.meta?.requestId || String(id)
    }, {
      surface: 'mcp',
      operation: name,
      context: {
        tool: name,
        toolCallId: idKey,
        qosLane: lane
      }
    });
    const entry = { controller, cancelled: false, observability: requestObservability, lane };
    inFlight.set(idKey, entry);
    let timedOut = false;
    let execution = null;
    let responding = false;
    const progress = (payload) => {
      if (timedOut || controller.signal.aborted) return;
      sendProgress(id, name, payload, requestObservability);
    };
    try {
      execution = Promise.resolve().then(() => handleToolCall(name, args, {
        progress,
        toolCallId: id,
        signal: controller.signal,
        observability: requestObservability
      }));
      const result = await withTimeout(
        execution,
        timeoutMs,
        {
          label: name,
          onTimeout: () => {
            timedOut = true;
            entry.cancelled = true;
            controller.abort();
          }
        }
      );
      if (entry.cancelled) {
        responding = true;
        await sendCancelledResponse(id);
        return;
      }
      const response = {
        content: [{ type: 'text', text: JSON.stringify(attachToolResultObservability(result, requestObservability), null, 2) }]
      };
      responding = true;
      await sendResult(id, response);
    } catch (error) {
      if (responding) throw error;
      responding = true;
      const activeEntry = inFlight.get(idKey);
      if (activeEntry?.cancelled && error?.code !== ERROR_CODES.TOOL_TIMEOUT) {
        await sendCancelledResponse(id);
        return;
      }
      const payload = formatToolError(error);
      if (error?.code === 'TOOL_TIMEOUT' && timeoutMs) {
        payload.timeoutMs = timeoutMs;
      }
      await sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: true
      });
    } finally {
      // The timeout response is prompt, but capacity and request identity stay
      // owned until delivery and the aborted operation/children actually settle.
      await execution?.catch(() => {});
      inFlight.delete(idKey);
      clearProgressState(idKey);
    }
  };

  const scheduleWork = () => {
    if (closing) return;
    while (totalActive() < (laneConcurrency.fast + laneConcurrency.slow)) {
      let lane = null;
      if (laneActive.fast < laneConcurrency.fast && laneQueues.fast.length > 0) {
        lane = 'fast';
      } else if (laneActive.slow < laneConcurrency.slow && laneQueues.slow.length > 0) {
        lane = 'slow';
      } else {
        break;
      }
      const task = laneQueues[lane].shift();
      if (!task) continue;
      pendingById.delete(task.idKey);
      laneActive[lane] += 1;
      const executionTask = processTask(task)
        .catch((error) => {
          logError('[mcp] queue error', { error: error?.message || String(error), lane });
          onOutputFailure(error);
        })
        .finally(() => {
          laneActive[lane] = Math.max(0, laneActive[lane] - 1);
          activeTasks.delete(executionTask);
          scheduleWork();
        });
      activeTasks.add(executionTask);
    }
  };

  const stopExecution = () => {
    if (stopPromise) return stopPromise;
    closing = true;
    output.beginClose();
    for (const idKey of progressState.keys()) clearProgressState(idKey);
    for (const entry of inFlight.values()) {
      entry.cancelled = true;
      entry.controller.abort();
    }
    stopPromise = Promise.resolve().then(async () => {
      // One cancellation producer joins the two lane producers and the single
      // control producer, matching the four reserved terminal slots.
      for (const task of pendingById.values()) {
        try { await cancelPendingTask(task); }
        catch (error) { onOutputFailure(error); }
      }
      await Promise.allSettled(Array.from(activeTasks));
    });
    return stopPromise;
  };

  const detachInput = () => {
    input.pause();
    input.off('data', onData); input.off('end', onEnd); input.off('error', onInputError);
    parser?.dispose();
  };
  const close = () => {
    if (closePromise) return closePromise;
    stopped = true; detachInput();
    closePromise = stopExecution().then(() => output.finish());
    return closePromise;
  };
  let exitPromise = null, requestedExitCode = 0;
  function terminate(code) {
    requestedExitCode = Math.max(requestedExitCode, code);
    if (!exitPromise) exitPromise = close().then(receipt => {
      if (receipt.status !== 'drained') {
        requestedExitCode = 1;
        logError('[mcp] output delivery failed', { output: receipt });
      }
      exit(requestedExitCode);
      return receipt;
    });
    return exitPromise;
  }
  function onOutputFailure(error) {
    if (stopped) return;
    logError('[mcp] output error', { error: error?.code || 'ERR_MCP_OUTPUT' });
    void terminate(1);
  }

  /**
   * Handle a JSON-RPC message from stdin.
   * @param {object} message
   * @returns {Promise<void>}
   */
  async function handleMessage(message) {
    if (!message || message.jsonrpc !== '2.0') return;
    const { id, method, params } = message;
    if (Object.hasOwn(message, 'id') && requestIdKey(id) === null) {
      await sendError(null, -32600, 'Request id must be a string or safe integer.', undefined,
        { code: ERROR_CODES.INVALID_REQUEST, reason: 'invalid-request-id' });
      return;
    }

    if (method === 'initialize') {
      await sendResult(id, buildInitializeResult({
        serverInfo,
        schemaVersion,
        toolVersion,
        capabilities,
        capabilityManifest
      }));
      return;
    }

    if (method === 'shutdown') {
      await stopExecution();
      await sendResult(id, {});
      return;
    }

    if (method === 'exit') {
      await terminate(0);
      return;
    }

    if (method === 'tools/list') {
      await sendResult(id, { tools: toolDefs });
      return;
    }

    if (method === 'resources/list') {
      await sendResult(id, { resources: [] });
      return;
    }

    if (method === '$/cancelRequest') {
      await applyCancellation(params);
      return;
    }

    if (method === 'tools/call') {
      if (id === null || id === undefined) return;
      if (closing) { await sendCancelledResponse(id); return; }
      const idKey = requestIdKey(id);
      if (await rejectDuplicateRequestId(id, idKey)) return;
      // Close may have begun while a duplicate-response delivery was pending.
      if (closing) { await sendCancelledResponse(id); return; }
      const name = params?.name;
      const args = params?.arguments || {};
      const timeoutMs = resolveToolTimeoutMs(name, args);
      const lane = classifyToolLane(name, timeoutMs);
      const overloadDecision = resolveOverloadDecision(lane);
      if (overloadDecision.overloaded) {
        await sendError(id, -32001, 'Server overloaded.', undefined, {
          code: ERROR_CODES.QUEUE_OVERLOADED,
          lane,
          reason: overloadDecision.reason
        });
        return;
      }
      const task = {
        id,
        idKey,
        lane,
        name,
        args,
        timeoutMs,
        meta: params?._meta || null
      };
      pendingById.set(idKey, task);
      laneQueues[lane].push(task);
      scheduleWork();
      return;
    }

    if (id !== null && id !== undefined) {
      await sendError(id, -32601, `Method not found: ${method}`, undefined, { code: ERROR_CODES.NOT_FOUND });
    }
  }

  function enqueueMessage(message) {
    if (stopped) return false;
    input.pause();
    // Serialize admission, not execution. At most one control response can
    // wait for stdout, and coalesced input remains in the bounded parser.
    void handleMessage(message).catch(onOutputFailure).finally(() => {
      if (!stopped && parser.resume()) input.resume();
    });
    return false;
  }

  function onData(chunk) { parser.push(chunk); }
  function onEnd() { void terminate(0); }
  function onInputError(err) {
    logError('[mcp] stream error', { error: err?.message || String(err) });
    void terminate(1);
  }
  const start = () => {
    if (parser || stopped) throw new Error('MCP transport can only start once.');
    parser = createFramedJsonRpcParser({
      onMessage: enqueueMessage,
      onError: (err) => {
        logError('[mcp] stream error', { error: err?.message || String(err) });
        void terminate(1);
      },
      maxBufferBytes
    });
    input.on('data', onData); input.on('end', onEnd); input.on('error', onInputError);
    return parser;
  };

  return { start, close, getState: () => ({ closing, stopped, activeTasks: activeTasks.size,
    pendingRequests: pendingById.size, inFlightRequests: inFlight.size,
    input: parser?.getState() || null, output: output.getState() }) };
};
