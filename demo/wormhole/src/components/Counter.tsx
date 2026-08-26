import { wormholes } from '@astroscope/wormhole';
import { useWormhole } from '@astroscope/wormhole/react';
import { actions } from 'astro:actions';

export default function Counter() {
  const { count } = useWormhole(wormholes.counter);

  async function update(newCount: number) {
    const result = await actions.updateCounter({ count: newCount });

    if (!result.error) {
      wormholes.counter.set(result.data);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button className="btn btn-sm btn-outline" onClick={() => update(count - 1)}>
        -
      </button>
      <span className="text-2xl font-bold tabular-nums">{count}</span>
      <button className="btn btn-sm btn-outline" onClick={() => update(count + 1)}>
        +
      </button>
    </div>
  );
}
