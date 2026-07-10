import fs from 'node:fs';
import { log } from '../observability/log/index.js';

/**
 * Platform env loading (position −1, before the config seam):
 * `CONFIG_PATH` → `./.env` → none. Existing process env vars win
 */
export function loadEnvFiles(): void {
  const configPath = process.env['CONFIG_PATH'];

  if (configPath) {
    process.loadEnvFile(configPath);

    log.debug({ path: configPath }, 'loaded env file from CONFIG_PATH');

    return;
  }

  if (fs.existsSync('.env')) {
    process.loadEnvFile('.env');
    log.debug({ path: '.env' }, 'loaded env file');

    return;
  }

  log.debug('no env file loaded');
}
