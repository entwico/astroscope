import fs from 'node:fs';
import path from 'node:path';
import { createIslandsTransformer } from './transform.js';
import type { IslandsManifest } from './types.js';

function* walkHtmlFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walkHtmlFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      yield full;
    }
  }
}

/**
 * Prerendered pages never pass through the middleware — they get the same rewrite
 * once, at build time, before the client dir is compressed. Runs without a request
 * context, so registered emitters that need one contribute nothing here.
 */
export async function transformPrerenderedHtml(clientDir: string, manifest: IslandsManifest): Promise<number> {
  const transformer = createIslandsTransformer(manifest);
  let transformed = 0;

  for (const file of walkHtmlFiles(clientDir)) {
    const html = fs.readFileSync(file, 'utf-8');
    const rewriter = transformer.createDocumentRewriter();
    const result = rewriter.write(html) + (await rewriter.end());

    if (result !== html) {
      fs.writeFileSync(file, result);
      transformed++;
    }
  }

  return transformed;
}
