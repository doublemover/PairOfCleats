export const getTreeSitterOptions = (context) => (
  context?.treeSitter
    ? { treeSitter: context.treeSitter, log: context.log }
    : {}
);
