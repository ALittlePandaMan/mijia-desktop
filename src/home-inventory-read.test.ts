import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readHomeInventory } from './home-inventory-read';

const networkError = { kind: 'network', message: 'timeout', retryable: true };

describe('home inventory retry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('recovers a transient error and stops after the first successful read', async () => {
    const signal = new AbortController().signal;
    const homes = [{ id: 'home' }];
    const read = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValue(homes);
    const result = readHomeInventory(read, signal);

    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(homes);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('returns the latest failure after three automatic retries', async () => {
    const signal = new AbortController().signal;
    const lastError = { ...networkError, message: 'final timeout' };
    const read = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(lastError);
    const result = expect(readHomeInventory(read, signal)).rejects.toEqual(lastError);

    await vi.advanceTimersByTimeAsync(10_999);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(read).toHaveBeenCalledTimes(4);
  });

  it.each([
    { kind: 'authExpired', message: 'expired', retryable: true },
    { kind: 'permissionDenied', message: 'denied', retryable: false },
    { kind: 'staleContext', message: 'obsolete', retryable: false },
  ])('returns $kind without retrying', async failure => {
    const read = vi.fn().mockRejectedValue(failure);
    await expect(readHomeInventory(read, new AbortController().signal)).rejects.toEqual(failure);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the scheduled retry when the active home or session changes', async () => {
    const controller = new AbortController();
    const read = vi.fn().mockRejectedValue(networkError);
    const result = expect(readHomeInventory(read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('discards a successful result from an obsolete in-flight read', async () => {
    const controller = new AbortController();
    let complete!: (homes: string[]) => void;
    const read = vi.fn(() => new Promise<string[]>(resolve => { complete = resolve; }));
    const result = expect(readHomeInventory(read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    complete(['old']);
    await result;
    expect(read).toHaveBeenCalledTimes(1);
  });
});
