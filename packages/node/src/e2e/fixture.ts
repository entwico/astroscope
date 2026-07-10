import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixtureRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../../demo/node-e2e');

export const skip = !existsSync(path.join(fixtureRoot, 'node_modules'));

export const devFixtureRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../../demo/node-dev-e2e');

export const devSkip = !existsSync(path.join(devFixtureRoot, 'node_modules'));
