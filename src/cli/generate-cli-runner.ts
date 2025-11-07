import type { CliArtifactMetadata, SerializedServerDefinition } from '../cli-metadata.js';
import { readCliMetadata } from '../cli-metadata.js';
import type { GenerateCliOptions } from '../generate-cli.js';
import { generateCli } from '../generate-cli.js';
import { splitCommandLine } from './adhoc-server.js';
import type { FlagMap } from './flag-utils.js';
import { expectValue } from './flag-utils.js';
import { extractGeneratorFlags } from './generate/flag-parser.js';
import { extractHttpServerTarget, looksLikeHttpUrl, normalizeHttpUrlCandidate } from './http-utils.js';

export interface GenerateFlags {
  server?: string;
  name?: string;
  command?: CommandInput;
  description?: string;
  output?: string;
  bundler?: 'rolldown' | 'bun';
  bundle?: boolean | string;
  compile?: boolean | string;
  runtime?: 'node' | 'bun';
  timeout: number;
  minify?: boolean;
  from?: string;
  dryRun: boolean;
}

// handleGenerateCli parses flags and generates the requested standalone CLI.
export async function handleGenerateCli(args: string[], globalFlags: FlagMap): Promise<void> {
  const parsed = parseGenerateFlags(args);
  if (parsed.from && (parsed.command || parsed.description || parsed.name)) {
    throw new Error('--from cannot be combined with --command/--description/--name.');
  }
  if (parsed.dryRun && !parsed.from) {
    throw new Error('--dry-run currently requires --from <artifact>.');
  }

  if (!parsed.server && !parsed.command && !parsed.from) {
    const positional = args.find((token) => token && !token.startsWith('--'));
    if (positional) {
      const position = args.indexOf(positional);
      if (position !== -1) {
        args.splice(position, 1);
      }
      if (looksLikeInlineCommand(positional)) {
        parsed.command = normalizeCommandInput(positional);
      } else if (looksLikeHttpUrl(positional) || positional.includes('://')) {
        parsed.command = positional;
      } else {
        parsed.server = positional;
      }
    }
  }

  if (parsed.from) {
    const { metadata, request } = await resolveGenerateRequestFromArtifact(parsed, globalFlags);
    if (parsed.dryRun) {
      const command = buildGenerateCliCommand(
        {
          serverRef: request.serverRef,
          configPath: request.configPath,
          rootDir: request.rootDir,
          outputPath: request.outputPath,
          bundle: request.bundle,
          compile: request.compile,
          runtime: request.runtime ?? 'node',
          timeoutMs: request.timeoutMs ?? 30_000,
          minify: request.minify ?? false,
        },
        metadata.server.definition,
        globalFlags
      );
      console.log('Dry run — would execute:');
      console.log(`  ${command}`);
      return;
    }
    const { outputPath, bundlePath, compilePath } = await generateCli(request);
    if (metadata.artifact.kind === 'binary' && compilePath) {
      console.log(`Regenerated compiled CLI at ${compilePath}`);
    } else if (metadata.artifact.kind === 'bundle' && bundlePath) {
      console.log(`Regenerated bundled CLI at ${bundlePath}`);
    } else {
      console.log(`Regenerated template at ${outputPath}`);
    }
    return;
  }

  const inferredName = parsed.name ?? (parsed.command ? inferNameFromCommand(parsed.command) : undefined);
  const serverRef =
    parsed.server ??
    (parsed.command && inferredName
      ? JSON.stringify(buildInlineServerDefinition(inferredName, parsed.command, parsed.description))
      : undefined);
  if (!serverRef) {
    throw new Error(
      'Provide --server with a definition or a command we can infer a name from (use --name to override).'
    );
  }
  const { outputPath, bundlePath, compilePath } = await generateCli({
    serverRef,
    configPath: globalFlags['--config'],
    rootDir: globalFlags['--root'],
    outputPath: parsed.output,
    runtime: parsed.runtime,
    bundler: parsed.bundler,
    bundle: parsed.bundle,
    timeoutMs: parsed.timeout,
    compile: parsed.compile,
    minify: parsed.minify ?? false,
  });
  console.log(`Generated CLI at ${outputPath}`);
  if (bundlePath) {
    console.log(`Bundled executable created at ${bundlePath}`);
  }
  if (compilePath) {
    console.log(`Compiled executable created at ${compilePath}`);
  }
}

export async function resolveGenerateRequestFromArtifact(
  parsed: GenerateFlags,
  globalFlags: FlagMap
): Promise<{ metadata: CliArtifactMetadata; request: GenerateCliOptions }> {
  if (!parsed.from) {
    throw new Error('Missing --from artifact path.');
  }
  const metadata = await readCliMetadata(parsed.from);
  const invocation = { ...metadata.invocation };
  const serverRef =
    parsed.server ?? invocation.serverRef ?? metadata.server.name ?? JSON.stringify(metadata.server.definition);
  if (!serverRef) {
    throw new Error('Unable to determine server definition from artifact; pass --server with a target name.');
  }
  return {
    metadata,
    request: {
      serverRef,
      configPath: globalFlags['--config'] ?? invocation.configPath,
      rootDir: globalFlags['--root'] ?? invocation.rootDir,
      outputPath: parsed.output ?? invocation.outputPath,
      runtime: parsed.runtime ?? invocation.runtime,
      bundler: parsed.bundler ?? invocation.bundler,
      bundle: parsed.bundle ?? invocation.bundle,
      timeoutMs: parsed.timeout ?? invocation.timeoutMs,
      compile: parsed.compile ?? invocation.compile,
      minify: parsed.minify ?? invocation.minify ?? false,
    },
  };
}

type InvocationSnapshot = CliArtifactMetadata['invocation'];

interface InspectableInvocation extends InvocationSnapshot {
  serverRef?: string;
}

export function buildGenerateCliCommand(
  invocation: InspectableInvocation,
  definition: SerializedServerDefinition,
  globalFlags: FlagMap = {}
): string {
  const tokens: string[] = ['mcporter'];
  const configPath = invocation.configPath ?? globalFlags['--config'];
  const rootDir = invocation.rootDir ?? globalFlags['--root'];
  if (configPath) {
    tokens.push('--config', configPath);
  }
  if (rootDir) {
    tokens.push('--root', rootDir);
  }
  tokens.push('generate-cli');

  const serverRef = invocation.serverRef ?? definition.name ?? JSON.stringify(definition);
  tokens.push('--server', serverRef);

  if (invocation.outputPath) {
    tokens.push('--output', invocation.outputPath);
  }
  if (invocation.bundler && invocation.bundler !== 'rolldown') {
    tokens.push('--bundler', invocation.bundler);
  }
  if (typeof invocation.bundle === 'string') {
    tokens.push('--bundle', invocation.bundle);
  } else if (invocation.bundle) {
    tokens.push('--bundle');
  }
  if (typeof invocation.compile === 'string') {
    tokens.push('--compile', invocation.compile);
  } else if (invocation.compile) {
    tokens.push('--compile');
  }
  if (invocation.runtime) {
    tokens.push('--runtime', invocation.runtime);
  }
  if (invocation.timeoutMs && invocation.timeoutMs !== 30_000) {
    tokens.push('--timeout', String(invocation.timeoutMs));
  }
  if (invocation.minify) {
    tokens.push('--minify');
  }
  return tokens.map(shellQuote).join(' ');
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./@%-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseGenerateFlags(args: string[]): GenerateFlags {
  const common = extractGeneratorFlags(args);
  let server: string | undefined;
  let name: string | undefined;
  let command: CommandInput | undefined;
  let description: string | undefined;
  let output: string | undefined;
  let bundler: 'rolldown' | 'bun' | undefined;
  let bundle: boolean | string | undefined;
  let compile: boolean | string | undefined;
  const runtime: 'node' | 'bun' | undefined = common.runtime;
  const timeout = common.timeout ?? 30_000;
  let minify: boolean | undefined;
  let from: string | undefined;
  let dryRun = false;

  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (!token) {
      index += 1;
      continue;
    }
    if (token === '--from') {
      from = expectValue(token, args[index + 1]);
      args.splice(index, 2);
      continue;
    }
    if (token === '--dry-run') {
      dryRun = true;
      args.splice(index, 1);
      continue;
    }
    if (token === '--server') {
      server = expectValue(token, args[index + 1]);
      args.splice(index, 2);
      continue;
    }
    if (token === '--name') {
      name = expectValue(token, args[index + 1]);
      args.splice(index, 2);
      continue;
    }
    if (token === '--command') {
      const value = expectValue(token, args[index + 1]);
      command = normalizeCommandInput(value);
      args.splice(index, 2);
      continue;
    }
    if (token === '--description') {
      description = expectValue(token, args[index + 1]);
      args.splice(index, 2);
      continue;
    }
    if (token === '--output') {
      output = expectValue(token, args[index + 1]);
      args.splice(index, 2);
      continue;
    }
    if (token === '--bundle') {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) {
        bundle = true;
        args.splice(index, 1);
      } else {
        bundle = next;
        args.splice(index, 2);
      }
      continue;
    }
    if (token === '--bundler') {
      const value = expectValue(token, args[index + 1]);
      if (value !== 'rolldown' && value !== 'bun') {
        throw new Error("--bundler must be 'rolldown' or 'bun'.");
      }
      bundler = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--compile') {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) {
        compile = true;
        args.splice(index, 1);
      } else {
        compile = next;
        args.splice(index, 2);
      }
      continue;
    }
    if (token === '--minify') {
      minify = true;
      args.splice(index, 1);
      continue;
    }
    if (token === '--no-minify') {
      minify = false;
      args.splice(index, 1);
      continue;
    }
    if (token.startsWith('--')) {
      throw new Error(`Unknown flag '${token}' for generate-cli.`);
    }
    index += 1;
  }

  if (!server && !command && !from) {
    const positional = args.find((token) => token && !token.startsWith('--'));
    if (positional) {
      const position = args.indexOf(positional);
      if (position !== -1) {
        args.splice(position, 1);
      }
      if (looksLikeInlineCommand(positional)) {
        command = normalizeCommandInput(positional);
      } else if (looksLikeHttpUrl(positional) || positional.includes('://')) {
        command = positional;
      } else {
        server = positional;
      }
    }
  }

  return {
    server,
    name,
    command,
    description,
    output,
    bundler,
    bundle,
    compile,
    runtime,
    timeout,
    minify,
    from,
    dryRun,
  };
}

type CommandInput = string | InlineCommandSpec;

interface InlineCommandSpec {
  command: string;
  args?: string[];
}

function buildInlineServerDefinition(
  name: string,
  command: CommandInput,
  description?: string
): Record<string, unknown> {
  const base: Record<string, unknown> = { name };
  if (description) {
    base.description = description;
  }
  if (typeof command === 'string') {
    base.command = command;
    return base;
  }
  base.command = command.command;
  if (command.args && command.args.length > 0) {
    base.args = command.args;
  }
  return base;
}

function inferNameFromCommand(command: CommandInput): string | undefined {
  if (typeof command === 'string') {
    const trimmed = command.trim();
    if (!trimmed) {
      return undefined;
    }
    const candidate = normalizeHttpUrlCandidate(trimmed) ?? trimmed;
    try {
      const url = new URL(candidate);
      const derived = deriveNameFromUrl(url);
      if (derived) {
        return derived;
      }
    } catch {
      // not a URL; fall through to filesystem heuristics
    }
    const firstToken = trimmed.split(/\s+/)[0] ?? trimmed;
    const candidateToken = firstToken.split(/[\\/]/).pop() ?? firstToken;
    return slugify(candidateToken.replace(/\.[a-z0-9]+$/i, ''));
  }
  const parts = [command.command, ...(command.args ?? [])];
  if (parts.length === 0) {
    return undefined;
  }
  const script = parts.find((part) => /\.[cm]?(ts|js)x?$/i.test(part));
  if (script) {
    return slugify(stripExtension(basename(script)));
  }
  const packageArg = parts.find((_part, index) => index > 0 && /[@/]/.test(_part));
  if (packageArg) {
    return slugify(packageArg.replace(/^@/, '').split('@')[0] ?? packageArg);
  }
  return slugify(basename(parts[0] ?? 'command'));
}

function slugify(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || undefined;
}

function basename(value: string): string {
  const segments = value.split(/[\\/]/);
  return segments[segments.length - 1] ?? value;
}

function stripExtension(value: string): string {
  const index = value.lastIndexOf('.');
  if (index === -1) {
    return value;
  }
  return value.slice(0, index);
}

function looksLikeInlineCommand(value: string): boolean {
  if (!value) {
    return false;
  }
  if (!/\s/.test(value)) {
    return false;
  }
  try {
    const parts = splitCommandLine(value.trim());
    return parts.length > 0;
  } catch {
    return false;
  }
}

function deriveNameFromUrl(url: URL): string | undefined {
  const genericHosts = new Set(['www', 'api', 'mcp', 'service', 'services', 'app', 'localhost']);
  const knownTlds = new Set(['com', 'net', 'org', 'io', 'ai', 'app', 'dev', 'co', 'cloud']);
  const parts = url.hostname.split('.').filter(Boolean);
  const filtered = parts.filter((part) => {
    const lower = part.toLowerCase();
    if (genericHosts.has(lower)) {
      return false;
    }
    if (knownTlds.has(lower)) {
      return false;
    }
    if (/^\d+$/.test(part)) {
      return false;
    }
    return true;
  });
  if (filtered.length > 0) {
    const last = filtered[filtered.length - 1];
    if (last) {
      return last;
    }
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const firstSegment = segments[0];
  if (firstSegment) {
    return firstSegment.replace(/[^a-zA-Z0-9-_]/g, '-');
  }
  return undefined;
}

function parseInlineCommand(value: string): InlineCommandSpec {
  const parts = splitCommandLine(value.trim());
  if (parts.length === 0) {
    throw new Error('--command requires a non-empty value.');
  }
  const [binary, ...rest] = parts as [string, ...string[]];
  return rest.length > 0 ? { command: binary, args: rest } : { command: binary };
}

function normalizeCommandInput(value: string): CommandInput {
  const target = extractHttpServerTarget(value);
  if (target) {
    return target;
  }
  return parseInlineCommand(value);
}

export const __test = {
  parseGenerateFlags,
  normalizeCommandInput,
  inferNameFromCommand,
  deriveNameFromUrl,
};
