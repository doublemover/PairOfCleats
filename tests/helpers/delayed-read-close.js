import fs from 'node:fs';

export const delayFileReadClose = (delayMs = 20) => {
  const original = fs.createReadStream;
  let activeHandles = 0;
  fs.createReadStream = (file, options = {}) => original(file, { ...options, fs: {
    open(...args) {
      const callback = args.pop();
      fs.open(...args, (error, fd) => { if (!error) activeHandles += 1; callback(error, fd); });
    },
    read: fs.read.bind(fs),
    close(fd, callback) {
      setTimeout(() => fs.close(fd, error => { activeHandles -= 1; callback(error); }), delayMs);
    }
  } });
  return { get activeHandles() { return activeHandles; }, restore() { fs.createReadStream = original; } };
};
