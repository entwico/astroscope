import { emit } from './events.js';
import type { BootContext } from './types.js';

export interface BootModule {
  onStartup?: ((context: BootContext) => Promise<void> | void) | undefined;
  onShutdown?: ((context: BootContext) => Promise<void> | void) | undefined;
}

export async function runStartup(boot: BootModule, context: BootContext): Promise<void> {
  await emit('beforeOnStartup', context);
  await boot.onStartup?.(context);
  await emit('afterOnStartup', context);
}

export async function runShutdown(boot: BootModule, context: BootContext): Promise<void> {
  try {
    await emit('beforeOnShutdown', context);
    await boot.onShutdown?.(context);
  } finally {
    await emit('afterOnShutdown', context);
  }
}
