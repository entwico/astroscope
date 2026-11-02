/** the page without its query and fragment: a token or a click id in the url is no conversion api's business */
export function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}
