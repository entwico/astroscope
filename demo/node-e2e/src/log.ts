import type { LoggerOptionsFactory } from '@astroscope/node/log';

const factory: LoggerOptionsFactory = () => ({
  base: { app: 'node-e2e' },
});

export default factory;
