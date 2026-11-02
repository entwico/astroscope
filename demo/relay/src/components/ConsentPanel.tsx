import { useEffect, useState } from 'react';

type Row = { name: string; id: string };

type Snapshot = {
  choice: string;
  crm: Row[];
  dataLayer: string[];
};

const EMPTY: Snapshot = { choice: 'unknown', crm: [], dataLayer: [] };

function snapshot(): Snapshot {
  return {
    choice: JSON.stringify(window.demoConsent.get() ?? null),
    crm: window.crmLog.map(({ name, id }) => ({ name, id })),
    dataLayer: (window.dataLayer ?? []).map((entry) => JSON.stringify([...(entry as Iterable<unknown>)])),
  };
}

/** the demo's cmp banner and the live view of what the destinations took */
export default function ConsentPanel() {
  const [state, setState] = useState<Snapshot>(EMPTY);

  useEffect(() => {
    const refresh = () => setState(snapshot());

    document.addEventListener('crm', refresh);

    const timer = setInterval(refresh, 300);

    return () => {
      document.removeEventListener('crm', refresh);
      clearInterval(timer);
    };
  }, []);

  const choose = (ga4: boolean, crm: boolean) => window.demoConsent.set({ ga4, crm });

  const loadCrm = () => {
    document.documentElement.dataset['crmLoaded'] = 'true';
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm btn-primary" onClick={() => choose(true, true)}>Accept all</button>
        <button className="btn btn-sm" onClick={() => choose(true, false)}>Only ga4</button>
        <button className="btn btn-sm" onClick={() => choose(false, false)}>Decline</button>
        <button className="btn btn-sm btn-ghost" onClick={() => window.demoConsent.set(undefined)}>Forget</button>
        <button className="btn btn-sm btn-secondary" onClick={loadCrm}>Load crm sdk</button>
      </div>
      <div className="text-sm">consent: <code>{state.choice}</code></div>
      <div>
        <div className="font-bold text-sm">dataLayer (ga4)</div>
        <pre className="bg-base-300 p-2 rounded text-xs" data-testid="datalayer">{state.dataLayer.join('\n') || '–'}</pre>
      </div>
      <div>
        <div className="font-bold text-sm">crm pixel</div>
        <pre className="bg-base-300 p-2 rounded text-xs" data-testid="crm">{state.crm.map((row) => `${row.name} ${row.id}`).join('\n') || '–'}</pre>
      </div>
    </div>
  );
}
