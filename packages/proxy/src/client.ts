import { Agent } from 'undici';
import type { ClientOptions } from './types.js';

const DEFAULT_CLIENT_OPTIONS: Required<ClientOptions> = {
  pipelining: 10,
  allowH2: true,
  maxConcurrentStreams: 128,
  keepAliveTimeout: 60_000,
  connectTimeout: 10_000,
  headersTimeout: 60_000,
  bodyTimeout: 60_000,
};

export function createHttpAgent(options?: ClientOptions): Agent {
  const config = { ...DEFAULT_CLIENT_OPTIONS, ...options };

  return new Agent({
    pipelining: config.pipelining,
    allowH2: config.allowH2,
    maxConcurrentStreams: config.maxConcurrentStreams,
    keepAliveTimeout: config.keepAliveTimeout,
    headersTimeout: config.headersTimeout,
    bodyTimeout: config.bodyTimeout,
    connect: { timeout: config.connectTimeout },
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 25,
  });
}
