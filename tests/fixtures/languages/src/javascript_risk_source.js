import { runUnsafe } from './javascript_risk_sink.js';

export function handleRequest(req) {
  const cmd = (req && req.body && req.body.cmd) || '';
  return runUnsafe(cmd);
}
