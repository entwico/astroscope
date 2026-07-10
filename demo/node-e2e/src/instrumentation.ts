import type { InstrumentationContext } from '@astroscope/node';

export function register(ctx: InstrumentationContext): void {
  console.log(`[e2e] instrumentation dev=${ctx.dev}`);
}
