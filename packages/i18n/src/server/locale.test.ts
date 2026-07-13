import { describe, expect, test, vi } from 'vitest';

vi.mock('virtual:@astroscope/i18n/manifest', () => ({
  getManifest: () => ({ keys: [], chunks: {}, imports: {} }),
}));

async function createDetectLocale(locales: string[] = ['en', 'de']) {
  vi.resetModules();

  const { i18n } = await import('./i18n');
  const { detectLocale } = await import('./locale');

  await i18n.configure({ locales });

  return detectLocale;
}

const requestWith = (acceptLanguage?: string): Request =>
  new Request(
    'http://localhost/',
    acceptLanguage === undefined ? {} : { headers: { 'accept-language': acceptLanguage } },
  );

describe('detectLocale', () => {
  test('returns undefined when the header is missing', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith())).toBeUndefined();
  });

  test('returns an exact match', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('de'))).toBe('de');
  });

  test('strips region subtags', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('en-US'))).toBe('en');
  });

  test('lowercases the language', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('DE-CH'))).toBe('de');
  });

  test('picks the configured locale with the highest quality', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('de;q=0.5,en;q=0.9'))).toBe('en');
  });

  test('treats entries without quality as q=1', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('en;q=0.9,de'))).toBe('de');
  });

  test('skips unconfigured languages in favor of lower-quality matches', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('fr,de;q=0.8'))).toBe('de');
  });

  test('returns undefined when nothing matches', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('fr,it;q=0.9'))).toBeUndefined();
  });

  test('ignores whitespace around entries', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('fr , de;q=0.8'))).toBe('de');
  });

  test('ignores whitespace around the quality separator', async () => {
    const detectLocale = await createDetectLocale();

    expect(detectLocale(requestWith('de ; q=0.8'))).toBe('de');
  });

  test('returns undefined when i18n is not configured', async () => {
    vi.resetModules();

    const { detectLocale } = await import('./locale');

    expect(detectLocale(requestWith('de'))).toBeUndefined();
  });
});
