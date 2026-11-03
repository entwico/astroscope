/**
 * The query parameters OpenTelemetry's semantic conventions redact by default in `url.query`:
 * the credentials of signed urls (S3 presigned urls, Azure SAS tokens, Google Cloud signed urls).
 * Keys match case-sensitively, as the convention asks. Spread it to add a site's own, `code`,
 * `token`, … — the convention leaves application secrets to the application.
 */
export const OTEL_REDACTED_QUERY_PARAMS: readonly string[] = ['AWSAccessKeyId', 'Signature', 'sig', 'X-Goog-Signature'];

const REDACTED = 'REDACTED';

/** the query string with the values of the named parameters replaced, everything else byte for byte as sent */
export function redactQuery(query: string, names: ReadonlySet<string>): string {
  if (query === '' || names.size === 0) {
    return query;
  }

  return query
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=');
      const key = separator === -1 ? pair : pair.slice(0, separator);

      return names.has(key) ? `${key}=${REDACTED}` : pair;
    })
    .join('&');
}
