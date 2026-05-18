import { type BootModule, runShutdown, runStartup } from './lifecycle/lifecycle.js';

export async function setup(boot: BootModule, config: { host: string; port: number }): Promise<void> {
  const context = {
    dev: false,
    host: process.env['HOST'] ?? config.host,
    port: process.env['PORT'] ? Number(process.env['PORT']) : config.port,
  };

  try {
    await runStartup(boot, context);
  } catch (err) {
    console.error('[boot] startup failed:', err);

    try {
      await runShutdown(boot, context);
    } catch {
      // best-effort cleanup
    }

    process.exit(1);
  }

  process.on('SIGTERM', async () => {
    try {
      await runShutdown(boot, context);
    } catch (err) {
      console.error('[boot] shutdown failed:', err);
    }

    process.exit(0);
  });
}
