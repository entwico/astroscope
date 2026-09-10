import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(fileURLToPath(import.meta.url), '../..');
export const resultsDir = path.join(root, 'benchmarks/results');

export interface MachineMeta {
  date: string;
  commit: string;
  dirty: boolean;
  node: string;
  cpu: string;
  cores: number;
  platform: string;
}

export function machineMeta(): MachineMeta {
  return {
    date: new Date().toISOString(),
    commit: execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(),
    dirty: execSync('git status --porcelain', { cwd: root }).toString().trim() !== '',
    node: process.version,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    platform: `${os.platform()} ${os.release()}`,
  };
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** newest result file with the given prefix, or undefined */
export function latestResult(prefix: string): string | undefined {
  let files: string[];

  try {
    files = readdirSync(resultsDir).filter(
      (f) => f.startsWith(`${prefix}-`) && f.endsWith('.json') && !f.endsWith('.meta.json'),
    );
  } catch {
    return undefined;
  }

  files.sort();

  return files.length ? path.join(resultsDir, files[files.length - 1]!) : undefined;
}
