import fs from 'node:fs';
import path from 'node:path';
import type { IntegrationResolvedRoute } from 'astro';

export const VIRTUAL_MODULE_ID = 'virtual:@astroscope/boot/warmup';
export const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

export const BOOT_VIRTUAL_MODULE_ID = 'virtual:@astroscope/boot/entry';
export const RESOLVED_BOOT_VIRTUAL_MODULE_ID = `\0${BOOT_VIRTUAL_MODULE_ID}`;

export const ASTRO_MIDDLEWARE_VIRTUAL = 'virtual:astro:middleware';

type RouteShape = Pick<IntegrationResolvedRoute, 'type' | 'isPrerendered' | 'entrypoint'>;

export function collectRouteEntrypoints(routes: readonly RouteShape[], projectRoot: string): string[] {
  const seen = new Set<string>();

  for (const route of routes) {
    if (route.isPrerendered) continue;
    if (route.type === 'redirect' || route.type === 'fallback') continue;
    if (!route.entrypoint) continue;

    const absolute = path.resolve(projectRoot, route.entrypoint);

    if (!fs.existsSync(absolute)) continue;

    seen.add(absolute);
  }

  return [...seen];
}

export function collectWarmupSpecifiers(routes: readonly RouteShape[], projectRoot: string): string[] {
  return [...collectRouteEntrypoints(routes, projectRoot), ASTRO_MIDDLEWARE_VIRTUAL];
}

export function generateWarmupCode(specifiers: string[]): string {
  if (specifiers.length === 0) return '';

  const imports = specifiers.map((s) => `  import(${JSON.stringify(s)})`).join(',\n');

  return [
    `const __astroscope_warmup_results = await Promise.allSettled([`,
    `${imports},`,
    `]);`,
    `for (let __i = 0; __i < __astroscope_warmup_results.length; __i++) {`,
    `  const __r = __astroscope_warmup_results[__i];`,
    `  if (__r.status === 'rejected') {`,
    `    console.error('[boot] warmup import failed:', __r.reason);`,
    `  }`,
    `}`,
    ``,
  ].join('\n');
}
