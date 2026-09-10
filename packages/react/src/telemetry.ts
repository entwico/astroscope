import { DURATION_BUCKETS, createCounter, createHistogram, errorType } from '@astroscope/node/telemetry';

const SCOPE = '@astroscope/react';

export const renderDuration = createHistogram('astro.island.render.duration', {
  scope: SCOPE,
  description: 'Server render of a React island, slots and form state included',
  unit: 's',
  buckets: DURATION_BUCKETS.compute,
});

export const checkDuration = createHistogram('astro.island.check.duration', {
  scope: SCOPE,
  description: 'Renderer detection probe for a component',
  unit: 's',
  buckets: DURATION_BUCKETS.compute,
});

const renderFailures = createCounter('astro.island.render.failures', {
  scope: SCOPE,
  description: 'React island server renders that threw',
  unit: '{render}',
});

/** the component's display name, through memo/forwardRef wrappers; bounded by the codebase */
export function componentName(Component: unknown): string {
  if (typeof Component === 'function' || (typeof Component === 'object' && Component !== null)) {
    const { displayName, name, type, render } = Component as {
      displayName?: unknown;
      name?: unknown;
      type?: unknown;
      render?: unknown;
    };

    if (typeof displayName === 'string' && displayName) return displayName;
    if (typeof name === 'string' && name) return name;
    // memo wraps as `type`, forwardRef as `render`
    if (type !== undefined && type !== Component) return componentName(type);
    if (typeof render === 'function') return componentName(render);
  }

  return 'anonymous';
}

/** `root`: the island produced no html; `boundary`: a suspense boundary inside it is left to the client */
export function recordRenderFailure(Component: unknown, kind: 'root' | 'boundary', error: unknown): void {
  renderFailures.add(1, {
    'astro.island.component': componentName(Component),
    'astro.island.error.kind': kind,
    'error.type': errorType(error),
  });
}
