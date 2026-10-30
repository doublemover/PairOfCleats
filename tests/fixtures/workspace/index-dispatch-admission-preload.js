import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/bin/pairofcleats.js') && specifier.endsWith('/subprocess/runner.js')) {
    return { url: 'index-admission:child', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'index-admission:child') return { format: 'module', shortCircuit: true,
    source: "import fs from 'node:fs';export const spawnSubprocess=async()=>{fs.writeFileSync(process.env.POC_INVALID_CHILD_MARKER,'unexpected child admission');throw new Error('invalid request admitted a child');};" };
  return next(url, context);
} });
