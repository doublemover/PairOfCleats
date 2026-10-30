import { registerHooks } from 'node:module';

registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('/src/shared/io/atomic-write.js')) return loaded;
  const source = Buffer.from(loaded.source).toString();
  if (!source.includes('export const atomicWriteJson =')) throw new Error('Statistics writer owner changed');
  return { ...loaded, source: source.replace('export const atomicWriteJson =', 'const actualAtomicWriteJson =')
    + `\nexport const atomicWriteJson=(file,...args)=>{if(String(file).endsWith('preprocess.json'))
      throw Object.assign(new Error('controlled statistics write failure'),{code:'EACCES'});return actualAtomicWriteJson(file,...args)};` };
} });
