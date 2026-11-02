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

type Batch<Ctx, Item> = {
  context: Ctx;
  items: Item[];
  cancel: () => void;
};

const DEFAULT_WITHIN = 500;

/**
 * Folds single sightings into batched events: a list of items is seen one item at a time as the
 * rows enter the viewport, while `view_item_list` is one event with the items. The collector
 * keeps a buffer per key and flushes it after the quiet time, in chunks of at most `max` items.
 * Buffers are shared by every caller of the collector, so sightings with the same key from
 * several components go out as one batch.
 */
export function collect<Ctx, Item>(
  options: CollectOptions<Ctx, Item> & KeyOption<Ctx>,
): (context: Ctx, item: Item) => void {
  const { flush, within = DEFAULT_WITHIN } = options;
  const max = Math.max(1, options.max ?? Infinity);
  const keyOf = options.key ?? ((context: Ctx) => context as string);
  const batches = new Map<string, Batch<Ctx, Item>>();

  const flushBatch = (key: string): void => {
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
    const key = keyOf(context);
    const existing = batches.get(key);

    existing?.cancel();

    const handle = setTimeout(() => flushBatch(key), within);
    const batch: Batch<Ctx, Item> = {
      context: existing?.context ?? context,
      items: existing?.items ?? [],
      cancel: () => clearTimeout(handle),
    };

    batch.items.push(item);
    batches.set(key, batch);
  };
}
