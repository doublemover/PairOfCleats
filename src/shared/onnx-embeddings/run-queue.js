export const createRunQueue = () => {
  let runQueue = Promise.resolve();
  return (runStep) => {
    const next = runQueue.then(runStep, runStep);
    runQueue = next.catch(() => {});
    return next;
  };
};
