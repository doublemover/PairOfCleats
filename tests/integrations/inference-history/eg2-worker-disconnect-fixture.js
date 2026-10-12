import { installEg2WorkerShutdownWatchdog } from '../../../src/integrations/inference-history/eg2-worker-watchdog.js';
// Synthetic unsettled async native work, no inference/model/DB or descendant process.
let active = false;
installEg2WorkerShutdownWatchdog({ onStop: () => { if (!active) process.exit(0); } });
process.on('message', message => {
  if (message.type === 'init') {
    active = true;
    process.send({ type: 'ready', nonce: message.nonce, pid: process.pid });
  }
});
