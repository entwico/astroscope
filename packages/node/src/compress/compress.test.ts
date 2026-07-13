import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { AstroIntegrationLogger } from 'astro';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { compressClientDir } from './compress';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createClientDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'astroscope-compress-'));

  dirs.push(dir);

  return dir;
}

function createLogger(): { logger: AstroIntegrationLogger; info: ReturnType<typeof vi.fn> } {
  const info = vi.fn();

  return { logger: { info } as unknown as AstroIntegrationLogger, info };
}

const COMPRESSIBLE_CONTENT = `<html><body>${'compress me well '.repeat(256)}</body></html>`;

describe('compressClientDir', () => {
  test('writes .br and .gz variants that decompress to the original', async () => {
    const dir = await createClientDir();

    await writeFile(path.join(dir, 'index.html'), COMPRESSIBLE_CONTENT);

    const { logger } = createLogger();

    await compressClientDir(dir, logger);

    const original = await readFile(path.join(dir, 'index.html'));
    const br = await readFile(path.join(dir, 'index.html.br'));
    const gz = await readFile(path.join(dir, 'index.html.gz'));

    expect(br.byteLength).toBeLessThan(original.byteLength);
    expect(gz.byteLength).toBeLessThan(original.byteLength);
    expect(brotliDecompressSync(br).toString()).toBe(COMPRESSIBLE_CONTENT);
    expect(gunzipSync(gz).toString()).toBe(COMPRESSIBLE_CONTENT);
  });

  test('recurses into nested directories', async () => {
    const dir = await createClientDir();

    await mkdir(path.join(dir, 'assets', 'js'), { recursive: true });
    await writeFile(path.join(dir, 'assets', 'js', 'app.js'), COMPRESSIBLE_CONTENT);

    await compressClientDir(dir, createLogger().logger);

    await expect(readFile(path.join(dir, 'assets', 'js', 'app.js.br'))).resolves.toBeDefined();
    await expect(readFile(path.join(dir, 'assets', 'js', 'app.js.gz'))).resolves.toBeDefined();
  });

  test('skips files with non-compressible extensions', async () => {
    const dir = await createClientDir();

    await writeFile(path.join(dir, 'image.png'), COMPRESSIBLE_CONTENT);

    await compressClientDir(dir, createLogger().logger);

    await expect(readFile(path.join(dir, 'image.png.br'))).rejects.toThrow();
    await expect(readFile(path.join(dir, 'image.png.gz'))).rejects.toThrow();
  });

  test('skips empty files', async () => {
    const dir = await createClientDir();

    await writeFile(path.join(dir, 'empty.css'), '');

    await compressClientDir(dir, createLogger().logger);

    await expect(readFile(path.join(dir, 'empty.css.br'))).rejects.toThrow();
    await expect(readFile(path.join(dir, 'empty.css.gz'))).rejects.toThrow();
  });

  test('skips variants that do not shrink the file', async () => {
    const dir = await createClientDir();

    await writeFile(path.join(dir, 'noise.txt'), randomBytes(64));

    await compressClientDir(dir, createLogger().logger);

    await expect(readFile(path.join(dir, 'noise.txt.br'))).rejects.toThrow();
    await expect(readFile(path.join(dir, 'noise.txt.gz'))).rejects.toThrow();
  });

  test('logs a compression summary', async () => {
    const dir = await createClientDir();

    await writeFile(path.join(dir, 'a.html'), COMPRESSIBLE_CONTENT);
    await writeFile(path.join(dir, 'b.css'), COMPRESSIBLE_CONTENT);
    await writeFile(path.join(dir, 'image.png'), COMPRESSIBLE_CONTENT);

    const { logger, info } = createLogger();

    await compressClientDir(dir, logger);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/^2 files compressed, saved up to .+ \(\d+%\)$/));
  });

  test('logs zero savings for an empty directory', async () => {
    const dir = await createClientDir();
    const { logger, info } = createLogger();

    await compressClientDir(dir, logger);

    expect(info).toHaveBeenCalledWith('0 files compressed, saved up to 0 B (0%)');
  });
});
