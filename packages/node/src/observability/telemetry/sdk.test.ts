import { metrics as metricsApi } from '@opentelemetry/api';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { getLogStore } from '../log/store';
import { shutdownTelemetry, startTelemetry } from './sdk';

const TELEMETRY_KEY = Symbol.for('@astroscope/node/telemetry');

afterEach(() => {
  vi.unstubAllEnvs();
  getLogStore().buffer.length = 0;
});

describe('startTelemetry', () => {
  test('OTEL_SDK_DISABLED=true starts nothing and leaves the exporter env alone', async () => {
    vi.stubEnv('OTEL_SDK_DISABLED', 'true');
    vi.stubEnv('OTEL_TRACES_EXPORTER', undefined);
    vi.stubEnv('OTEL_METRICS_EXPORTER', undefined);

    const noopMeter = metricsApi.getMeter('probe');

    await startTelemetry({ prometheus: { host: '127.0.0.1', port: 0 } });

    expect((globalThis as Record<symbol, unknown>)[TELEMETRY_KEY]).toBeUndefined();
    expect(metricsApi.getMeter('probe')).toBe(noopMeter);
    expect(process.env['OTEL_TRACES_EXPORTER']).toBeUndefined();
    expect(process.env['OTEL_METRICS_EXPORTER']).toBeUndefined();

    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
