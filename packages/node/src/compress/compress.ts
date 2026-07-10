import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip as _gzip, brotliCompress, constants } from 'node:zlib';
import type { AstroIntegrationLogger } from 'astro';
import { COMPRESSIBLE } from '../server/mime.js';

const brotli = promisify(brotliCompress);
const gzip = promisify(_gzip);

/**
 * Pre-compress every compressible file in the client build dir at maximum
 * quality, writing `.br`/`.gz` variants next to the originals. Variants that
 * don't shrink the file are skipped. The static handler negotiates
 * `Accept-Encoding` against these at request time.
 */
export async function compressClientDir(clientDir: string, logger: AstroIntegrationLogger): Promise<void> {
  const files = await walkDir(clientDir);

  let compressed = 0;
  let savedBytes = 0;
  let totalRaw = 0;

  await Promise.all(
    files.map(async (filePath) => {
      if (!COMPRESSIBLE.has(path.extname(filePath))) return;

      const raw = await readFile(filePath);

      if (!raw.byteLength) return;

      const [brBuf, gzBuf] = await Promise.all([
        brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY } }),
        gzip(raw, { level: 9 }),
      ]);

      if (brBuf.byteLength < raw.byteLength) {
        await writeFile(`${filePath}.br`, brBuf);
      }

      if (gzBuf.byteLength < raw.byteLength) {
        await writeFile(`${filePath}.gz`, gzBuf);
      }

      compressed++;
      totalRaw += raw.byteLength;

      const best = Math.min(
        brBuf.byteLength < raw.byteLength ? brBuf.byteLength : raw.byteLength,
        gzBuf.byteLength < raw.byteLength ? gzBuf.byteLength : raw.byteLength,
      );

      savedBytes += raw.byteLength - best;
    }),
  );

  const savedPercent = totalRaw > 0 ? Math.round((savedBytes / totalRaw) * 100) : 0;

  logger.info(`${compressed} files compressed, saved up to ${formatBytes(savedBytes)} (${savedPercent}%)`);
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });

  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

const UNITS = ['B', 'KB', 'MB', 'GB'];

function formatBytes(bytes: number): string {
  let value = bytes;

  for (const unit of UNITS) {
    if (value < 1024 || unit === UNITS[UNITS.length - 1]) {
      return unit === 'B' ? `${value} ${unit}` : `${value.toFixed(1)} ${unit}`;
    }

    value /= 1024;
  }

  return `${value.toFixed(1)} GB`;
}
