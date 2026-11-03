/**
 * The dot-separated names astro resolves `/_actions/<name>` against: every
 * function reachable through the registry's nested objects, named by its key
 * path. Astro treats a function as a leaf, so its own properties are not part
 * of the namespace.
 */
export function collectActionNames(server: unknown, prefix = ''): Set<string> {
  const names = new Set<string>();

  if (!server || typeof server !== 'object') {
    return names;
  }

  for (const [key, value] of Object.entries(server)) {
    const name = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'function') {
      names.add(name);
    } else if (value && typeof value === 'object') {
      for (const nested of collectActionNames(value, name)) {
        names.add(nested);
      }
    }
  }

  return names;
}

/** the label unknown action paths share, so probing shows as one series instead of minting one per path */
export const UNKNOWN_ACTION = 'unknown';

/**
 * The action name a request path addresses, as the metric label and span
 * name: the registry name when astro can resolve it, `unknown` otherwise.
 * Without a registry (dev) every path is taken as it is.
 */
export function resolveActionName(path: string, actions: ReadonlySet<string> | undefined): string {
  const name = path.replace(/\/$/, '');

  if (!actions) {
    return name;
  }

  let decoded: string;

  try {
    decoded = name
      .split('.')
      .map((key) => decodeURIComponent(key))
      .join('.');
  } catch {
    return UNKNOWN_ACTION;
  }

  return actions.has(decoded) ? decoded : UNKNOWN_ACTION;
}
