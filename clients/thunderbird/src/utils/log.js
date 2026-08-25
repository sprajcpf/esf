/** Logging that stays quiet unless debug logging is enabled in the options. */

let debugEnabled = false;

export function setDebugLogging(enabled) {
  debugEnabled = enabled === true;
}

export function isDebugLogging() {
  return debugEnabled;
}

export function createLogger(scope) {
  const prefix = `[ESF:${scope}]`;
  return {
    debug(...args) {
      if (debugEnabled) {
        console.debug(prefix, ...args);
      }
    },
    info(...args) {
      console.info(prefix, ...args);
    },
    warn(...args) {
      console.warn(prefix, ...args);
    },
    error(...args) {
      console.error(prefix, ...args);
    }
  };
}
