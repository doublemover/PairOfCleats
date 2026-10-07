export const createProgressReporter = (input = null) => {
  const progress = typeof input === 'function'
    ? input
    : (typeof input?.progress === 'function' ? input.progress : null);
  if (!progress) return null;
  return {
    emit(message, extra = {}) {
      progress({ message, ...extra });
    },
    phase(phase, message, extra = {}) {
      progress({ phase, message, ...extra });
    },
    start(message, extra = {}) {
      progress({ phase: 'start', message, ...extra });
    },
    done(message, extra = {}) {
      progress({ phase: 'done', message, ...extra });
    },
    line({ stream, line }, extra = {}) {
      progress({ message: line, stream, ...extra });
    }
  };
};

export const createStreamLineProgressForwarder = (input = null, extra = {}) => {
  const reporter = createProgressReporter(input);
  if (!reporter) return null;
  return (payload) => reporter.line(payload, extra);
};
