import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadEnvFiles } from './env';

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
const tempDirs: string[] = [];

function makeTempDir(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astroscope-env-'));

  tempDirs.push(dir);

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }

  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();

  process.chdir(originalCwd);

  // restore by mutating: reassigning process.env would detach it from the real environment,
  // making later process.loadEnvFile writes invisible
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, originalEnv);

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadEnvFiles', () => {
  test('loads the file referenced by CONFIG_PATH', () => {
    const dir = makeTempDir({ 'custom.env': 'TEST_ENV_FROM_CONFIG=config-value\n' });

    vi.stubEnv('CONFIG_PATH', path.join(dir, 'custom.env'));

    loadEnvFiles();

    expect(process.env['TEST_ENV_FROM_CONFIG']).toBe('config-value');
  });

  test('CONFIG_PATH takes precedence and skips ./.env entirely', () => {
    const dir = makeTempDir({
      'custom.env': 'TEST_ENV_SHARED=from-config\n',
      '.env': 'TEST_ENV_SHARED=from-dotenv\nTEST_ENV_DOTENV_ONLY=x\n',
    });

    vi.stubEnv('CONFIG_PATH', path.join(dir, 'custom.env'));
    process.chdir(dir);

    loadEnvFiles();

    expect(process.env['TEST_ENV_SHARED']).toBe('from-config');
    expect(process.env['TEST_ENV_DOTENV_ONLY']).toBeUndefined();
  });

  test('loads ./.env from the working directory when CONFIG_PATH is not set', () => {
    const dir = makeTempDir({ '.env': 'TEST_ENV_FROM_DOTENV=dotenv-value\n' });

    delete process.env['CONFIG_PATH'];
    process.chdir(dir);

    loadEnvFiles();

    expect(process.env['TEST_ENV_FROM_DOTENV']).toBe('dotenv-value');
  });

  test('does nothing when neither CONFIG_PATH nor ./.env exist', () => {
    const dir = makeTempDir();

    delete process.env['CONFIG_PATH'];
    process.chdir(dir);

    expect(() => loadEnvFiles()).not.toThrow();
  });

  test('existing process env vars win over file values', () => {
    const dir = makeTempDir({ '.env': 'TEST_ENV_WINNER=from-file\nTEST_ENV_FILE_ONLY=file-value\n' });

    delete process.env['CONFIG_PATH'];
    vi.stubEnv('TEST_ENV_WINNER', 'from-process');
    process.chdir(dir);

    loadEnvFiles();

    expect(process.env['TEST_ENV_WINNER']).toBe('from-process');
    expect(process.env['TEST_ENV_FILE_ONLY']).toBe('file-value');
  });

  test('throws when CONFIG_PATH points to a missing file', () => {
    const dir = makeTempDir();

    vi.stubEnv('CONFIG_PATH', path.join(dir, 'does-not-exist.env'));

    expect(() => loadEnvFiles()).toThrow();
  });
});
