import type { Page } from 'playwright';

export type PageRecord = {
  /** every request the page made, in start order */
  requests: { method: string; url: string }[];
  /** uncaught exceptions */
  uncaught: string[];
  /** uncaught exceptions and `console.error` output, which is where the browser reports blocked requests */
  errors: string[];
};

/** attach before the navigation: records what the page requests and what goes wrong in it */
export function record(page: Page): PageRecord {
  const requests: PageRecord['requests'] = [];
  const uncaught: string[] = [];
  const errors: string[] = [];

  page.on('request', (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });
  page.on('pageerror', (error) => {
    uncaught.push(error.message);
    errors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  return { requests, uncaught, errors };
}

/**
 * The requests that left the page's origin. `blob:` and `data:` urls never reach the network; a
 * `blob:` url of another origin cannot exist in the page.
 */
export function foreignRequests(requests: PageRecord['requests'], origin: string): string[] {
  return requests
    .map((request) => request.url)
    .filter((url) => !url.startsWith('blob:') && !url.startsWith('data:') && new URL(url).origin !== origin);
}

/** the paths of the same-origin requests matching `pattern`, in start order */
export function requestPaths(requests: PageRecord['requests'], pattern: RegExp): string[] {
  return requests
    .filter((request) => !request.url.startsWith('blob:') && !request.url.startsWith('data:'))
    .map((request) => new URL(request.url).pathname)
    .filter((pathname) => pattern.test(pathname));
}
