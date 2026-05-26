import { useEffect, useState } from 'react';

export function Island() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    void import('./canary').then((m) => {
      console.log(m.CANARY_MARKER);
    });
  }, []);

  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      count: {count}
    </button>
  );
}
