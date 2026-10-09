// imported by both the server and the client entries — no node or astro runtime imports here

export const DEFAULT_CAP_PATH = '/_cap/';

/** the request field a solved token travels in: an action input key, a form field, a json body key */
export const CAP_FIELD_NAME = '_cap';

/** `/_cap` and `_cap/` both become `/_cap/`, so endpoints can be appended as plain names */
export function normalizeCapPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '');

  if (!trimmed) {
    throw new Error('@astroscope/cap: path must not be empty or "/"');
  }

  return `/${trimmed}/`;
}
