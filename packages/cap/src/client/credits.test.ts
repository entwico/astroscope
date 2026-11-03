// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { protectCreditsLink } from './credits';

const open = vi.fn();

beforeEach(() => {
  vi.stubGlobal('open', open);
  vi.stubGlobal('Worker', class {
    postMessage() {}
    terminate() {}
    addEventListener() {}
  });
  vi.stubGlobal('CAP_SILENT', true);
  URL.createObjectURL ??= () => 'blob:worker';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

protectCreditsLink();

// the widget overrides `dispatchEvent(name, detail)` and happy-dom's propagation re-enters the
// override with the event object for every node on the path, which recurses without end; routing
// an event object to the native method keeps the widget's lifecycle events working here
let tolerated = false;

function tolerateReentrantDispatch(): void {
  if (tolerated) return;

  tolerated = true;

  const prototype = customElements.get('cap-widget')?.prototype as {
    dispatchEvent: (eventOrName: Event | string, detail?: unknown) => boolean;
  };
  const vendorDispatch = prototype.dispatchEvent;

  prototype.dispatchEvent = function (this: EventTarget, eventOrName, detail) {
    return eventOrName instanceof Event
      ? EventTarget.prototype.dispatchEvent.call(this, eventOrName)
      : vendorDispatch.call(this, eventOrName, detail);
  };
}

async function renderWidget(): Promise<HTMLAnchorElement> {
  const widget = document.createElement('cap-widget');

  document.body.append(widget);

  await import('cap-widget');
  await customElements.whenDefined('cap-widget');
  tolerateReentrantDispatch();

  const credits = widget.shadowRoot?.querySelector<HTMLAnchorElement>('.credits');

  if (!credits) throw new Error('the widget rendered no credits link');

  return credits;
}

test('a click on the credits link opens the vendor site without referrer and opener', async () => {
  const credits = await renderWidget();

  credits.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));

  expect(open).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith('https://trycap.dev/', '_blank', 'noopener,noreferrer');
});

test('a widget moved in the document keeps the protected link', async () => {
  const credits = await renderWidget();
  const { host } = credits.getRootNode() as ShadowRoot;
  const container = document.createElement('div');

  host.remove();
  document.body.append(container);
  container.append(host);

  host.shadowRoot
    ?.querySelector('.credits')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));

  expect(open).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith('https://trycap.dev/', '_blank', 'noopener,noreferrer');
});
