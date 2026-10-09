// No model, adapter, database, descendant process, or inference. IPC-only stalled child.
let nonce;
process.on('message', message => {
  if (message.type === 'init') {
    nonce = message.nonce;
    process.send({ type: 'ready', nonce, pid: process.pid });
  }
  // Deliberately ignore cancellation/requests to exercise owned-handle forced termination.
});
