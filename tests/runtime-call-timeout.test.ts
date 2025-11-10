import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../src/runtime.js';

describe('runtime callTool timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects when a call exceeds the timeout and closes the server', async () => {
    vi.useFakeTimers();
    const runtime = await createRuntime({ servers: [] });
    const callTool = vi.fn(() => new Promise(() => {}));
    const fakeContext = {
      client: { callTool },
      transport: { close: vi.fn().mockResolvedValue(undefined) },
      definition: {
        name: 'temp',
        description: 'test',
        command: { kind: 'stdio', command: 'node', args: [], cwd: process.cwd() },
        source: { kind: 'local', path: '<test>' },
      },
      oauthSession: undefined,
    } as unknown as Awaited<ReturnType<typeof runtime.connect>>;
    vi.spyOn(runtime, 'connect').mockResolvedValue(fakeContext);
    const closeSpy = vi.spyOn(runtime, 'close').mockResolvedValue();

    const promise = runtime.callTool('temp', 'ping', { timeoutMs: 123 });
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).rejects.toThrow('Timeout');
    expect(closeSpy).toHaveBeenCalledWith('temp');
  });
});
