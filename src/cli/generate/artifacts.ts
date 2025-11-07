import { execFile } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RolldownPlugin, rolldown } from 'rolldown';
import { verifyBunAvailable } from './runtime.js';

const localRequire = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('../../..', import.meta.url));
// Generated CLIs import commander/mcporter, but end-users run mcporter from directories
// that often lack node_modules. Pre-resolve those deps to this package so bundling works
// even in empty temp dirs (fixes #1).
const dependencyAliasPlugin = createLocalDependencyAliasPlugin(['commander', 'mcporter']);

export async function bundleOutput({
  sourcePath,
  targetPath,
  runtimeKind,
  minify,
  bundler,
}: {
  sourcePath: string;
  targetPath: string;
  runtimeKind: 'node' | 'bun';
  minify: boolean;
  bundler: 'rolldown' | 'bun';
}): Promise<string> {
  if (bundler === 'bun') {
    return await bundleWithBun({ sourcePath, targetPath, runtimeKind, minify });
  }
  return await bundleWithRolldown({ sourcePath, targetPath, runtimeKind, minify });
}

async function bundleWithRolldown({
  sourcePath,
  targetPath,
  runtimeKind,
  minify,
}: {
  sourcePath: string;
  targetPath: string;
  runtimeKind: 'node' | 'bun';
  minify: boolean;
}): Promise<string> {
  const absTarget = path.resolve(targetPath);
  await fs.mkdir(path.dirname(absTarget), { recursive: true });
  const plugins = dependencyAliasPlugin ? [dependencyAliasPlugin] : undefined;
  const bundle = await rolldown({
    input: sourcePath,
    treeshake: false,
    plugins,
    onLog(level, log, handler) {
      if (typeof (log as { code?: string }).code === 'string' && (log as { code?: string }).code === 'EVAL') {
        return;
      }
      handler(level, log);
    },
  });
  await bundle.write({
    file: absTarget,
    format: runtimeKind === 'bun' ? 'esm' : 'cjs',
    sourcemap: false,
    minify,
  });
  await fs.chmod(absTarget, 0o755);
  return absTarget;
}

async function bundleWithBun({
  sourcePath,
  targetPath,
  runtimeKind,
  minify,
}: {
  sourcePath: string;
  targetPath: string;
  runtimeKind: 'node' | 'bun';
  minify: boolean;
}): Promise<string> {
  const absTarget = path.resolve(targetPath);
  await fs.mkdir(path.dirname(absTarget), { recursive: true });
  const bunBin = await verifyBunAvailable();
  const tmpRoot = path.join(packageRoot, 'tmp');
  await fs.mkdir(tmpRoot, { recursive: true });
  const stagingDir = await fs.mkdtemp(path.join(tmpRoot, 'bundle-'));
  const stagingEntry = path.join(stagingDir, path.basename(sourcePath));
  // Copy the template into the package tree so Bun sees our node_modules deps even when the
  // CLI runs from an empty working directory.
  await fs.copyFile(sourcePath, stagingEntry);
  try {
    const args = ['build', stagingEntry, '--outfile', absTarget, '--target', runtimeKind === 'bun' ? 'bun' : 'node'];
    if (minify) {
      args.push('--minify');
    }
    await new Promise<void>((resolve, reject) => {
      execFile(bunBin, args, { cwd: packageRoot, env: process.env }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
  await fs.chmod(absTarget, 0o755);
  return absTarget;
}

export async function compileBundleWithBun(bundlePath: string, outputPath: string): Promise<void> {
  const bunBin = await verifyBunAvailable();
  await new Promise<void>((resolve, reject) => {
    execFile(
      bunBin,
      ['build', bundlePath, '--compile', '--outfile', outputPath],
      { cwd: process.cwd(), env: process.env },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }
    );
  });

  await fs.chmod(outputPath, 0o755);
}

export function resolveBundleTarget({
  bundle,
  compile,
  outputPath,
}: {
  bundle?: boolean | string;
  compile?: boolean | string;
  outputPath: string;
}): string {
  if (typeof bundle === 'string') {
    return bundle;
  }
  if (bundle) {
    throw new Error('--bundle requires an explicit output path when used with --compile.');
  }
  if (typeof compile === 'string') {
    const ext = path.extname(compile);
    const base = ext ? path.join(path.dirname(compile), path.basename(compile, ext)) : compile;
    return `${base}.js`;
  }
  if (compile) {
    const tmpDir = path.join(process.cwd(), 'tmp', 'mcporter-cli-bundles');
    const baseName = path.basename(outputPath, path.extname(outputPath)) || 'bundle';
    return path.join(tmpDir, `${baseName}-${Date.now()}.bundle.js`);
  }
  throw new Error('--compile requires an explicit bundle target.');
}

export function computeCompileTarget(
  compileOption: boolean | string | undefined,
  _bundlePath: string,
  serverName: string
): string {
  if (typeof compileOption === 'string') {
    return compileOption;
  }
  const baseName = sanitizeFileName(serverName) || 'mcporter-cli';
  return resolveUniquePath(process.cwd(), baseName);
}

function createLocalDependencyAliasPlugin(specifiers: string[]): RolldownPlugin | undefined {
  const resolvedEntries = specifiers
    .map((specifier) => ({ specifier, path: resolveLocalDependency(specifier) }))
    .filter((entry): entry is { specifier: string; path: string } => Boolean(entry.path));
  if (resolvedEntries.length === 0) {
    return undefined;
  }
  return {
    name: 'mcporter-local-deps',
    resolveId(source) {
      const match = resolvedEntries.find((entry) => entry.specifier === source);
      if (match) {
        return match.path;
      }
      return null;
    },
  };
}

function resolveLocalDependency(specifier: string): string | undefined {
  try {
    return localRequire.resolve(specifier);
  } catch {
    if (specifier === 'mcporter') {
      // During development or unpublished builds there may not be an installed entry,
      // so fall back to the files inside the repo that represent the published surface.
      const fallbacks = [
        path.join(packageRoot, 'dist', 'index.js'),
        path.join(packageRoot, 'dist', 'index.mjs'),
        path.join(packageRoot, 'src', 'index.ts'),
        path.join(packageRoot, 'src', 'index.js'),
      ];
      for (const candidate of fallbacks) {
        if (fsSync.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  }
}

function sanitizeFileName(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return slug.replace(/^-+|-+$/g, '');
}

function resolveUniquePath(directory: string, baseName: string): string {
  let attempt = path.join(directory, baseName);
  let suffix = 1;
  while (fsSync.existsSync(attempt)) {
    attempt = path.join(directory, `${baseName}-${suffix}`);
    suffix += 1;
  }
  return attempt;
}
