export const createRunQueue = () => {
  let runQueue = Promise.resolve();
  const enqueue = (runStep) => {
    const next = runQueue.then(runStep, runStep);
    runQueue = next.catch(() => {});
    return next;
  };
  enqueue.onIdle = () => runQueue;
  return enqueue;
};
