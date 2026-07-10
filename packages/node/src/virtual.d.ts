declare module 'virtual:@astroscope/node/config-entry' {
  const nothing: unknown;
  export default nothing;
}

declare module 'virtual:@astroscope/node/instrumentation-entry' {
  export const register: ((ctx: { dev: boolean }) => void | Promise<void>) | undefined;
}

declare module 'virtual:@astroscope/node/log-entry' {
  import type { LoggerOptionsFactory } from './observability/log/construct.js';

  const factory: LoggerOptionsFactory | undefined;
  export default factory;
}
