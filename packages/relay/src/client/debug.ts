import type { EventMeta, TrackInput } from '../shared.js';

/** what became of an event at one destination when it was tracked */
export type Outcome = {
  name: string;
  payload: unknown;
  status: 'sent' | 'declined' | 'consent pending' | 'waiting for sdk';
};

const titleStyle = 'color: #5c7ced;';
const sentStyle = 'color: #5c7ced;';
const pendingStyle = 'color: #999;';
const declinedStyle = 'color: #999;text-decoration: line-through;';

function styleOf(status: Outcome['status']): string {
  switch (status) {
    case 'sent': {
      return sentStyle;
    }
    case 'declined': {
      return declinedStyle;
    }
    default: {
      return pendingStyle;
    }
  }
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.error('relay: failed printing the debug log', error);
    console.groupEnd();
  }
}

/** one collapsed group per tracked event: what came in, and what each destination got or why not */
export function reportTracked(input: TrackInput, meta: EventMeta, outcomes: readonly Outcome[]): void {
  safely(() => {
    const sent = outcomes.filter(({ status }) => status === 'sent').length;

    console.groupCollapsed(`%crelay ${meta.key ?? 'event'} #${meta.id} → sent to ${sent} of ${outcomes.length}`, titleStyle);
    console.log('%c>>', titleStyle, input);

    for (const { name, payload, status } of outcomes) {
      console.log(`%c<< ${name}`, styleOf(status), status === 'sent' ? payload : status, status === 'sent' ? '' : payload);
    }

    console.groupEnd();
  });
}

/** a delivery after the event's own group: consent given later, an sdk that appeared */
export function reportLate(name: string, payload: unknown, meta: EventMeta): void {
  safely(() => {
    console.groupCollapsed(`%crelay ${meta.key ?? 'event'} #${meta.id} → ${name}, later`, titleStyle);
    console.log(`%c<< ${name}`, sentStyle, payload);
    console.groupEnd();
  });
}
