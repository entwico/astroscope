import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixtureRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../../demo/tweaks-e2e');

export const skip = !existsSync(path.join(fixtureRoot, 'node_modules'));
