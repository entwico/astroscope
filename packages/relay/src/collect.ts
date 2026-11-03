/** a collector's options; the context identifies the batch and is handed back with it */
export type CollectOptions<Ctx, Item> = {
  /** takes one batch: the context of its first sighting and the items collected under that key */
  flush: (context: Ctx, items: Item[]) => void;
  /** the quiet time after the last sighting before the batch goes out, in ms; default 500 */
  within?: number | undefined;
  /** the items a batch carries at most, 1 or more; a fuller buffer goes out as several batches; default unlimited */
  max?: number | undefined;
};

/** a string context is its own key; any other context needs a key function */
type KeyOption<Ctx> = Ctx extends string
  ? { key?: ((context: Ctx) => string) | undefined }
  : { key: (context: Ctx) => string };

export type Collect = <Ctx, Item>(
  options: CollectOptions<Ctx, Item> & KeyOption<Ctx>,
) => (context: Ctx, item: Item) => void;

type Batch<Ctx, Item> = {
  context: Ctx;
  items: Item[];
  cancel: () => void;
};

/** where the sightings of one scope are kept apart: the current scope and how to run a flush inside it */
export type CollectScope<Scope extends object> = {
  current: () => Scope | undefined;
  run: (scope: Scope, fn: () => void) => void;
};

const DEFAULT_WITHIN = 500;

/**
 * Makes the `collect()` of one environment. The scope separates the buffers: sightings seen under
 * different scope objects never share a batch, and a batch flushes inside the scope it was seen in.
 * The browser has no scope, the server one per request (its relay context), so a batch there goes
 * out under the request's consent. Outside any scope the buffers are shared by every caller.
 */
export function createCollect<Scope extends object>(scope?: CollectScope<Scope> | undefined): Collect {
  return <Ctx, Item>(options: CollectOptions<Ctx, Item> & KeyOption<Ctx>): ((context: Ctx, item: Item) => void) => {
    const { flush, within = DEFAULT_WITHIN } = options;
    const max = Math.max(1, options.max ?? Infinity);
    const keyOf = options.key ?? ((context: Ctx) => context as string);
    const unscoped = new Map<string, Batch<Ctx, Item>>();
    const scoped = new WeakMap<Scope, Map<string, Batch<Ctx, Item>>>();

    const batchesOf = (scope: Scope | undefined): Map<string, Batch<Ctx, Item>> => {
      if (!scope) {
        return unscoped;
      }

      let batches = scoped.get(scope);

      if (!batches) {
        batches = new Map();
        scoped.set(scope, batches);
      }

      return batches;
    };

    const flushBatch = (batches: Map<string, Batch<Ctx, Item>>, key: string): void => {
      const batch = batches.get(key);

      if (!batch) {
        return;
      }

      batches.delete(key);

      for (let start = 0; start < batch.items.length; start += max) {
        flush(batch.context, batch.items.slice(start, start + max));
      }
    };

    return (context, item) => {
      const current = scope?.current();
      const batches = batchesOf(current);
      const key = keyOf(context);
      const existing = batches.get(key);

      existing?.cancel();

      const flushScoped = (): void => {
        if (scope && current) {
          scope.run(current, () => flushBatch(batches, key));
        } else {
          flushBatch(batches, key);
        }
      };
      const handle = setTimeout(flushScoped, within);
      const batch: Batch<Ctx, Item> = {
        context: existing?.context ?? context,
        items: existing?.items ?? [],
        cancel: () => clearTimeout(handle),
      };

      batch.items.push(item);
      batches.set(key, batch);
    };
  };
}
