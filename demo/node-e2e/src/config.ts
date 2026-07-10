import { log } from '@astroscope/node/log';

if (process.env['E2E_FAIL_CONFIG'] === '1') {
  throw new Error('e2e config validation failed');
}

export const config = {
  value: process.env['E2E_CONFIG_VALUE'] ?? 'default',
};

log.info({ value: config.value }, 'config loaded');
