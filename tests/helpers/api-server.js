import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const startApiServer = async ({ repoRoot, allowedRoots = [], env }) => {
  const serverPath = path.join(ROOT, 'tools', 'api-server.js');
  const args = [
    serverPath,
    '--port',
    '0',
    '--json',
    '--quiet',
    '--repo',
    repoRoot
  ];
  if (allowedRoots.length) {
    args.push('--allowed-repo-roots', ...allowedRoots);
  }

  const server = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

  const readStartup = async () => {
    const rl = readline.createInterface({ input: server.stdout });
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        rl.close();
        reject(new Error('api-server startup timed out'));
      }, 10000);
      rl.once('line', (line) => {
        clearTimeout(timeout);
        rl.close();
        resolve(line);
      });
    });
  };

  const requestJson = async (method, requestPath, body, serverInfo) => await new Promise((resolve, reject) => {
    const host = serverInfo?.host || '127.0.0.1';
    const port = serverInfo?.port || 0;
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host,
        port,
        path: requestPath,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : {}
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(data || '{}') });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

  const line = await readStartup();
  const serverInfo = JSON.parse(line || '{}');
  if (!serverInfo?.port) {
    throw new Error('api-server did not report a listening port');
  }

  const stop = async () => await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.kill('SIGKILL');
      resolve();
    }, 5000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    server.kill('SIGTERM');
  });

  return { server, serverInfo, requestJson, stop };
};
