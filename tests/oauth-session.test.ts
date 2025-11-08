import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerDefinition } from '../src/config.js';
import { createOAuthSession } from '../src/oauth.js';

describe('FileOAuthClientProvider session lifecycle', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('rejects pending authorization waits when the session closes early', async () => {
    const tokenCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-oauth-test-'));
    tempDirs.push(tokenCacheDir);
    const definition: ServerDefinition = {
      name: 'test-oauth',
      description: 'Test OAuth server',
      command: { kind: 'http', url: new URL('https://example.com/mcp') },
      auth: 'oauth',
      tokenCacheDir,
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const session = await createOAuthSession(definition, logger);
    const waitPromise = session.waitForAuthorizationCode();
    await session.close();
    await expect(waitPromise).rejects.toThrow(/closed before receiving authorization code/i);
  });
});
