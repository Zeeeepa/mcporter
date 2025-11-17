import { describe, expect, it } from 'vitest';
import { formatSourceSuffix } from '../src/cli/list-format.js';
import { stripAnsi } from './fixtures/cli-list-fixtures.js';

describe('list format helpers', () => {
  it('shows only primary import path by default', () => {
    const suffix = formatSourceSuffix({ kind: 'import', path: '/home/user/.cursor/mcp.json' });
    expect(stripAnsi(suffix)).toContain('[source: /home/user/.cursor/mcp.json]');
  });

  it('shows all sources when verbose is enabled and preserves order', () => {
    const suffix = formatSourceSuffix(
      [
        { kind: 'import', path: '/project/config/mcporter.json' },
        { kind: 'import', path: '/home/user/.cursor/mcp.json' },
      ],
      false,
      { verbose: true }
    );
    const plain = stripAnsi(suffix);
    expect(plain).toContain(
      '[sources: /project/config/mcporter.json (primary) · /home/user/.cursor/mcp.json (shadowed)]'
    );
  });

  it('tags imports shadowed by a local primary', () => {
    const suffix = formatSourceSuffix(
      [
        { kind: 'local', path: '/project/config/mcporter.json' },
        { kind: 'import', path: '/home/user/.cursor/mcp.json' },
      ],
      false,
      { verbose: true }
    );
    const plain = stripAnsi(suffix);
    expect(plain).toContain(
      '[sources: /project/config/mcporter.json (primary) · /home/user/.cursor/mcp.json (shadowed by local)]'
    );
  });
});
