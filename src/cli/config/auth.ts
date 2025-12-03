import { loadServerDefinitions } from '../../config.js';
import { clearOAuthCaches } from '../../oauth-persistence.js';
import { CliUsageError } from '../errors.js';
import { resolveServerDefinition } from './shared.js';
import type { ConfigCliOptions } from './types.js';

export async function handleLoginCommand(options: ConfigCliOptions, args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new CliUsageError('Usage: mcporter config login <name|url>');
  }
  await options.invokeAuth([...args]);
}

export async function handleLogoutCommand(options: ConfigCliOptions, args: string[]): Promise<void> {
  const name = args.shift();
  if (!name) {
    throw new CliUsageError('Usage: mcporter config logout <name>');
  }
  const servers = await loadServerDefinitions(options.loadOptions);
  const target = resolveServerDefinition(name, servers);
  await clearOAuthCaches(target);
  console.log(`Cleared cached credentials for '${target.name}'`);
}
