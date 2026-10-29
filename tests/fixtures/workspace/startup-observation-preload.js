import { registerHooks } from 'node:module';

// Observe the actual target Node startup while keeping this orchestration
// fixture independent of indexing/native work. Every wrapper and child launch
// before this leaf boundary remains production code.
registerHooks({ load(url, context, next) {
  if (!url.endsWith('/build_index.js')) return next(url, context);
  return { format: 'module', shortCircuit: true, source: `
    import fs from 'node:fs';import path from 'node:path';import v8 from 'node:v8';
    const index=process.argv.lastIndexOf('--repo'),repo=process.argv[index+1];
    if(index<0||!repo)throw new Error('Target argument was lost');
    fs.writeFileSync(path.join(repo,'child-startup.json'),JSON.stringify({repo,cwd:process.cwd(),
      nodeOptions:process.env.NODE_OPTIONS,uv:process.env.UV_THREADPOOL_SIZE,
      heap:v8.getHeapStatistics().heap_size_limit,execArgv:process.execArgv}));` };
} });
