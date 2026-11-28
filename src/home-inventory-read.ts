import { isSessionError, normalizeError } from './logic';

const retryDelays = [1_000, 3_000, 7_000];

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, delay);
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function readHomeInventory<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await read();
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      const failure = normalizeError(error);
      const delay = retryDelays[attempt];
      if (delay === undefined || !failure.retryable || isSessionError(failure)) throw failure;
      await waitForRetry(delay, signal);
    }
  }
}
