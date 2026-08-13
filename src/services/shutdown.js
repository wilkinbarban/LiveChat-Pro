'use strict';

function createShutdownCoordinator({ stopAcceptance, closeTransports, closeDatabase, logger = console }) {
  let shutdownPromise;
  return function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      for (const [stage, close] of [
        ['stop-acceptance', stopAcceptance],
        ['close-transports', closeTransports],
        ['close-database', closeDatabase],
      ]) {
        for (const cleanup of Array.isArray(close) ? close : [close]) {
          try {
            await cleanup(signal);
          } catch (err) {
            logger.error({ err, stage, signal }, 'Shutdown stage failed');
          }
        }
      }
    })();
    return shutdownPromise;
  };
}

module.exports = { createShutdownCoordinator };
