import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigPath } from '../src/config.js';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('resolveConfigPath', () => {
  const originalEnvValue = process.env.MCPORTER_CONFIG;
  let tempDirs: string[] = [];
  let homedirSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.MCPORTER_CONFIG;
    } else {
      process.env.MCPORTER_CONFIG = originalEnvValue;
    }
    homedirSpy?.mockRestore();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it('prefers an explicit config path argument', () => {
    const tempRoot = makeTempDir('mcporter-config-');
    tempDirs.push(tempRoot);
    const explicitPath = path.join(tempRoot, 'custom.json');
    fs.writeFileSync(explicitPath, '{"mcpServers":{}}');

    const resolved = resolveConfigPath(explicitPath, tempRoot);
    expect(resolved.path).toBe(explicitPath);
    expect(resolved.explicit).toBe(true);
  });

  it('uses MCPORTER_CONFIG when set', () => {
    const tempRoot = makeTempDir('mcporter-config-env-');
    tempDirs.push(tempRoot);
    const envPath = path.join(tempRoot, 'env-config.json');
    fs.writeFileSync(envPath, '{"mcpServers":{}}');
    process.env.MCPORTER_CONFIG = envPath;

    const resolved = resolveConfigPath(undefined, tempRoot);
    expect(resolved.path).toBe(envPath);
    expect(resolved.explicit).toBe(true);
  });

  it('falls back to the project config when it exists', () => {
    const tempRoot = makeTempDir('mcporter-project-');
    tempDirs.push(tempRoot);
    const projectConfig = path.join(tempRoot, 'config', 'mcporter.json');
    fs.mkdirSync(path.dirname(projectConfig), { recursive: true });
    fs.writeFileSync(projectConfig, '{"mcpServers":{}}');

    const resolved = resolveConfigPath(undefined, tempRoot);
    expect(resolved.path).toBe(projectConfig);
    expect(resolved.explicit).toBe(false);
  });

  it('falls back to the home config when project config is missing', () => {
    const tempRoot = makeTempDir('mcporter-project-missing-');
    const fakeHome = makeTempDir('mcporter-home-');
    tempDirs.push(tempRoot, fakeHome);
    const homeConfigDir = path.join(fakeHome, '.mcporter');
    const homeConfigPath = path.join(homeConfigDir, 'mcporter.json');
    fs.mkdirSync(homeConfigDir, { recursive: true });
    fs.writeFileSync(homeConfigPath, '{"mcpServers":{}}');
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const resolved = resolveConfigPath(undefined, tempRoot);
    expect(resolved.path).toBe(homeConfigPath);
    expect(resolved.explicit).toBe(false);
  });
});
