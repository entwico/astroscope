import { Suspense, lazy } from 'react';

// visible on the initial render, so the island suspends on the server: the
// renderer must fall back to streaming and still deliver the full content
const LazyContent = lazy(() => import('./LazyContent'));

export function SuspendingIsland() {
  return (
    <div className="suspending">
      <Suspense fallback={<p id="fallback">loading</p>}>
        <LazyContent />
      </Suspense>
    </div>
  );
}
