/**
 * Takes over the click on the widget's vendor credits link: the widget's own handler prevents
 * the anchor navigation and calls `window.open(url, '_blank')` with no features, which hands the
 * vendor tab a referrer and `window.opener`. The listener sits on the document in the capture
 * phase, ahead of the widget's, so it covers every widget of the page whenever it was created and
 * survives the shadow ui the widget rebuilds on each reconnect.
 */
export function protectCreditsLink(): void {
  document.addEventListener('click', openCreditsWithoutReferrer, { capture: true });
}

function openCreditsWithoutReferrer(event: MouseEvent): void {
  const path = event.composedPath();
  const [target] = path;

  if (!(target instanceof HTMLAnchorElement) || !target.classList.contains('credits')) return;
  if (path.every((node) => !(node instanceof Element && node.localName === 'cap-widget'))) return;

  event.preventDefault();
  event.stopPropagation();

  window.open(target.href, '_blank', 'noopener,noreferrer');
}
