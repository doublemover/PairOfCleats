/**
 * Current async runner contract. See docs/contracts/subprocess.md for lease
 * responsibilities; promise settlement is not a whole-process-tree receipt.
 *
 * @typedef {object} SubprocessCapture
 * @property {boolean} enabled
 * @property {number} maxBytes Per-stream retained byte limit.
 * @property {number} observedBytes Bytes seen by this stream listener.
 * @property {number} retainedBytes Raw tail bytes retained.
 * @property {number} droppedBytes Observed minus retained bytes.
 * @property {number} retainedBufferBytes Owned backing-buffer bytes.
 * @property {number} outputBytes Encoded bytes in the returned output.
 * @property {boolean} encodingLoss Tail decoding did not round-trip exactly.
 * @property {boolean} truncated Enabled capture discarded observed bytes.
 *
 * @typedef {object} SubprocessTermination
 * @property {'spawned-child-close-only'} scope
 * @property {'child-close-event'} method
 * @property {boolean} closeObserved Exact spawned handle emitted close.
 * @property {boolean} closeTimedOut Bounded close observation expired.
 * @property {number} waitMs Configured close-observation allowance.
 * @property {true} treeCleanupSettled Termination attempt finished, not a tree census.
 * @property {boolean} treeCleanupFailed Termination attempt rejected.
 * @property {boolean|null} treeCleanupForced Escalation observation when available.
 *
 * @typedef {object} SubprocessResult
 * @property {number|null|undefined} pid Undefined is possible after a failed spawn.
 * @property {number|null} exitCode Null for abort/timeout/operation failure.
 * @property {string|null} signal
 * @property {number} durationMs
 * @property {string|string[]|undefined} stdout Undefined when capture is disabled.
 * @property {string|string[]|undefined} stderr
 * @property {{stdout:SubprocessCapture,stderr:SubprocessCapture}} [outputCapture]
 * @property {SubprocessTermination} [termination] Only termination-path failures.
 *
 * @typedef {Error & {
 *   code:'SUBPROCESS_FAILED'|'SUBPROCESS_TIMEOUT'|'ABORT_ERR',
 *   result:SubprocessResult,
 *   cacheOwnershipPending?:boolean,
 *   cacheOwnershipReleased?:()=>boolean
 * }} SubprocessFailure
 *
 * @typedef {object} SpawnSubprocessOptions
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env] Passed directly to child_process.spawn.
 * @property {import('node:child_process').StdioOptions} [stdio='pipe']
 * @property {false} [shell=false] Shell execution is rejected.
 * @property {boolean} [windowsVerbatimArguments=false]
 * @property {AbortSignal|null} [signal]
 * @property {number} [timeoutMs] Positive values enable an execution timer.
 * @property {boolean} [killTree=true]
 * @property {string} [killSignal='SIGTERM'] Platform termination owner applies it.
 * @property {number} [killGraceMs] Omitted abort/timeout grace is zero; tracking defaults to 5000ms.
 * @property {number} [timeoutAbortReapWaitMs] Defaults to effective termination grace plus 500ms.
 * @property {boolean} [detached] Defaults to false on Windows, true elsewhere.
 * @property {boolean} [unref=false]
 * @property {boolean} [cleanupOnParentExit] Defaults off only for detached+unref.
 * @property {string} [ownershipId] Explicit owner before bound signal/context.
 * @property {string} [ownerId] Legacy ownershipId alias.
 * @property {string} [cleanupScope] Explicit scope before scope/inherited owner.
 * @property {string} [scope]
 * @property {string} [name] Error and tracking label.
 * @property {boolean} [rejectOnNonZeroExit=true]
 * @property {number[]} [expectedExitCodes] Defaults to [0].
 * @property {number} [maxOutputBytes=1000000] Positive per-stream retained tail cap.
 * @property {boolean} [captureStdout] Defaults to whether stdout is piped.
 * @property {boolean} [captureStderr] Defaults to whether stderr is piped.
 * @property {BufferEncoding} [outputEncoding='utf8']
 * @property {'string'|'lines'} [outputMode='string'] Capture formatting, not callback framing.
 * @property {(text:string)=>void} [onStdout] Synchronous, decoded live chunks, outside capture cap.
 * @property {(text:string)=>void} [onStderr]
 * @property {(child:import('node:child_process').ChildProcess)=>void} [onSpawn] Synchronous; owners already installed.
 * @property {string|Uint8Array} [input] Ends piped stdin once with these bytes.
 */

export {};
