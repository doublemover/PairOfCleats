import fs from 'node:fs';
import path from 'node:path';
const [kind, ...args] = process.argv.slice(2), root = path.dirname(process.argv[1]);
const input = kind === 'clipboard' ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ kind, args, input, pid: process.pid }) + '\n');
if (fs.existsSync(path.join(root, 'block'))) setInterval(() => {}, 1000);
