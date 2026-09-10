/**
 * Streaming scanner that prepends handler html before `<astro-island …>` opening
 * tags. Everything else, the tag included, passes through byte-verbatim.
 *
 * It tokenizes only as far as needed to know when `<` starts an element. The
 * invariant is asymmetric: a missed island costs a preload, a false positive
 * would inject into a script or attribute — every deviation from the WHATWG
 * tokenizer errs towards not injecting, and the parse5 oracle test checks that.
 */

export type IslandTagRewrite = {
  /** html emitted immediately before the island opening tag */
  prepend?: string | undefined;
};

export type IslandTagHandler = (attrs: Record<string, string>) => IslandTagRewrite | null;

export type IslandRewriter = {
  write(chunk: string): string;
  end(): string;
};

const ISLAND = 'astro-island';
// raw text by name alone, also inside `<svg>`/`<math>` where the browser would not — a real island cannot sit there
const RAW_TEXT = new Set(['style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);

// longest marker a raw-text scan must be able to complete across a chunk boundary: `</script` plus its terminator
const RAW_TAIL = 9;

// the named references astro's escaper emits; any other stays literal, which at worst mismatches a manifest url
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// numeric references in the C1 control range map to windows-1252 code points
const C1_REMAP: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

type Mode =
  | { kind: 'data' }
  | { kind: 'comment'; bangAt: number }
  | { kind: 'cdata' }
  | { kind: 'bogus' }
  | { kind: 'rawtext'; endTag: string }
  | { kind: 'script'; escape: 0 | 1 | 2 }
  | { kind: 'plaintext' };

const DATA: Mode = { kind: 'data' };

export function encodeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** whitespace, `/` or `>`: what ends a tag name and what may follow an end tag name in raw text */
function isTagEnd(code: number): boolean {
  return isWhitespace(code) || code === 0x2f || code === 0x3e;
}

function decodeAttribute(value: string): string {
  if (!value.includes('&') && !value.includes('\r') && !value.includes('\0')) {
    return value;
  }

  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, '�')
    .replace(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (match, hex, dec, name) => {
      if (name) {
        return NAMED_ENTITIES[name] ?? match;
      }

      const code = parseInt(hex ?? dec, hex ? 16 : 10);

      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return '�';
      }

      return String.fromCodePoint(C1_REMAP[code] ?? code);
    });
}

const NAMES_BY_LENGTH: Record<number, string[]> = {
  3: ['xmp'],
  5: ['style', 'title'],
  6: ['script', 'iframe'],
  7: ['noembed'],
  8: ['noframes', 'noscript', 'textarea', 'template'],
  9: ['plaintext'],
  12: [ISLAND],
};

function equalsIgnoreCase(buf: string, start: number, name: string): boolean {
  for (let k = 0; k < name.length; k++) {
    if ((buf.charCodeAt(start + k) | 0x20) !== name.charCodeAt(k)) return false;
  }

  return true;
}

/**
 * reads a tag name from its start (just after `<` or `</`): the end of the name,
 * and the name itself only when it is one the scanner acts on — every other
 * tag passes through without allocating. null when not terminated in `buf`.
 */
function readTagName(buf: string, i: number): { name: string | null; end: number } | null {
  const nameStart = i;

  while (i < buf.length && !isTagEnd(buf.charCodeAt(i))) i++;

  if (i >= buf.length) return null;

  const candidates = NAMES_BY_LENGTH[i - nameStart];
  const name = candidates?.find((candidate) => equalsIgnoreCase(buf, nameStart, candidate)) ?? null;

  return { name, end: i };
}

/**
 * walks a tag's attributes from just after its name to its `>`, collecting them
 * into `attrs` when given; -1 when the tag is not complete in `buf`. Follows the
 * attribute states exactly: a quote opens a value only right after `=` in the
 * attribute-name position, anywhere else it is a plain name or value character.
 */
function scanAttributes(buf: string, i: number, attrs: Record<string, string> | null): number {
  const len = buf.length;

  for (;;) {
    while (i < len && (isWhitespace(buf.charCodeAt(i)) || buf.charCodeAt(i) === 0x2f)) i++;

    if (i >= len) return -1;
    if (buf.charCodeAt(i) === 0x3e) return i + 1;

    const nameStart = i;

    // a leading `=` is part of the attribute name
    if (buf.charCodeAt(i) === 0x3d) i++;

    while (i < len) {
      const code = buf.charCodeAt(i);

      // everything above `>` (letters, `_`, non-ascii) is a name character; only `=`, `/`, `>` and whitespace end it
      if (code <= 0x3e && (code === 0x3d || isTagEnd(code))) break;

      i++;
    }

    if (i >= len) return -1;

    const nameEnd = i;

    while (i < len && isWhitespace(buf.charCodeAt(i))) i++;

    if (i >= len) return -1;

    let valueStart = i;
    let valueEnd = i;

    if (buf.charCodeAt(i) === 0x3d) {
      i++;

      while (i < len && isWhitespace(buf.charCodeAt(i))) i++;

      if (i >= len) return -1;

      const quote = buf.charCodeAt(i);

      if (quote === 0x22 || quote === 0x27) {
        const close = buf.indexOf(String.fromCharCode(quote), i + 1);

        if (close < 0) return -1;

        valueStart = i + 1;
        valueEnd = close;
        i = close + 1;
      } else {
        valueStart = i;

        while (i < len && !isWhitespace(buf.charCodeAt(i)) && buf.charCodeAt(i) !== 0x3e) i++;

        if (i >= len) return -1;

        valueEnd = i;
      }
    }

    if (attrs) {
      const name = buf.slice(nameStart, nameEnd).toLowerCase();

      if (!(name in attrs)) {
        defineLazyAttribute(attrs, name, buf.slice(valueStart, valueEnd));
      }
    }
  }
}

// values decode on first access: islands carry kilobytes of escaped props the handler never reads
function defineLazyAttribute(attrs: Record<string, string>, name: string, raw: string): void {
  let decoded: string | undefined;

  Object.defineProperty(attrs, name, {
    enumerable: true,
    configurable: true,
    get: () => (decoded ??= decodeAttribute(raw)),
    set: (value: string) => {
      decoded = value;
    },
  });
}

type ScriptMarker = 'escape-open' | 'end' | 'script-open' | 'none' | 'incomplete';

/** classifies the `<` at `lt` inside script data */
function classifyScriptMarker(buf: string, lt: number): ScriptMarker {
  const rest = buf.slice(lt, lt + RAW_TAIL);
  const lower = rest.toLowerCase();

  if (rest.startsWith('<!--')) return 'escape-open';
  if (lower.startsWith('</script') && lower.length > 8 && isTagEnd(lower.charCodeAt(8))) return 'end';
  if (lower.startsWith('<script') && lower.length > 7 && isTagEnd(lower.charCodeAt(7))) return 'script-open';

  const incomplete =
    (rest.length < 4 && '<!--'.startsWith(rest)) ||
    (lower.length <= 8 && '</script'.startsWith(lower)) ||
    (lower.length <= 7 && '<script'.startsWith(lower));

  return incomplete ? 'incomplete' : 'none';
}

export function createIslandRewriter(onIsland: IslandTagHandler): IslandRewriter {
  let mode: Mode = DATA;
  let carry = '';
  // islands inside `<template>` are inert until cloned, so they get nothing
  let templateDepth = 0;

  const scan = (buf: string): string => {
    const len = buf.length;
    // output is the input with insertions: everything between `emitted` and the
    // scan position is untouched source, flushed as one slice when something is
    // inserted, held back, or the buffer ends
    let out = '';
    let emitted = 0;
    let i = 0;

    const flush = (to: number): void => {
      if (to > emitted) {
        out += buf.slice(emitted, to);
        emitted = to;
      }
    };

    // holds `buf` from `at` for the next write
    const hold = (at: number): void => {
      flush(at);
      carry = buf.slice(at);
      emitted = len;
      i = len;
    };

    while (i < len) {
      switch (mode.kind) {
        case 'plaintext': {
          i = len;
          break;
        }

        case 'bogus': {
          const close = buf.indexOf('>', i);

          if (close < 0) {
            i = len;
          } else {
            i = close + 1;
            mode = DATA;
          }

          break;
        }

        case 'cdata': {
          const close = buf.indexOf(']]>', i);

          if (close >= 0) {
            i = close + 3;
            mode = DATA;
          } else {
            hold(Math.max(i, len - 2));
          }

          break;
        }

        case 'comment': {
          const dashes = buf.indexOf('-->', i);
          const bang = buf.indexOf('--!>', mode.bangAt);
          const close = dashes >= 0 && (bang < 0 || dashes < bang) ? dashes + 3 : bang >= 0 ? bang + 4 : -1;

          if (close >= 0) {
            i = close;
            mode = DATA;
          } else {
            // a comment cannot hold an island: keep only what could be a partial closer
            const cut = Math.max(i, len - 3);

            hold(cut);
            mode = { kind: 'comment', bangAt: Math.max(0, mode.bangAt - cut) };
          }

          break;
        }

        case 'rawtext': {
          const { endTag } = mode;
          let k = i;
          let found = -1;

          while ((k = buf.indexOf('</', k)) >= 0) {
            if (k + endTag.length >= len) break;

            if (equalsIgnoreCase(buf, k, endTag) && isTagEnd(buf.charCodeAt(k + endTag.length))) {
              found = k;
              break;
            }

            k += 2;
          }

          if (found >= 0) {
            i = found;
            mode = DATA;
          } else {
            hold(Math.max(i, len - endTag.length));
          }

          break;
        }

        case 'script': {
          let k = i;
          let cut = -1;

          while (cut < 0) {
            const lt = buf.indexOf('<', k);
            const dashes = mode.escape === 0 ? -1 : buf.indexOf('-->', k);

            if (dashes >= 0 && (lt < 0 || dashes < lt)) {
              mode = { kind: 'script', escape: 0 };
              k = dashes + 3;
              continue;
            }

            if (lt < 0) {
              cut = Math.max(k, len - RAW_TAIL + 1);
              break;
            }

            const marker = classifyScriptMarker(buf, lt);

            if (marker === 'incomplete') {
              cut = lt;
            } else if (marker === 'end' && mode.escape !== 2) {
              i = lt;
              mode = DATA;
              break;
            } else if (marker === 'end') {
              mode = { kind: 'script', escape: 1 };
              k = lt + 8;
            } else if (marker === 'escape-open' && mode.escape === 0) {
              // the opener's own dashes count: `<!-->` leaves the escaped state at once
              mode = { kind: 'script', escape: 1 };
              k = lt + 2;
            } else if (marker === 'script-open' && mode.escape === 1) {
              mode = { kind: 'script', escape: 2 };
              k = lt + 7;
            } else {
              k = lt + 1;
            }
          }

          if (cut >= 0) {
            hold(cut);
          }

          break;
        }

        case 'data': {
          const lt = buf.indexOf('<', i);

          if (lt < 0) {
            i = len;
            break;
          }

          if (lt + 1 >= len) {
            hold(lt);
            break;
          }

          const next = buf.charCodeAt(lt + 1);

          if (next === 0x21) {
            if (buf.startsWith('<!--', lt)) {
              i = lt + 2;
              // `-->` may close on the opener's own dashes (`<!-->`), `--!>` needs two more
              mode = { kind: 'comment', bangAt: lt + 4 };
            } else if (buf.startsWith('<![CDATA[', lt)) {
              // cdata is text only in foreign content, where the browser ends it at `]]>`; ending
              // it there everywhere errs towards a missed preload, never towards injecting
              i = lt + 9;
              mode = { kind: 'cdata' };
            } else if (len - lt < 9 && ('<!--'.startsWith(buf.slice(lt)) || '<![CDATA['.startsWith(buf.slice(lt)))) {
              hold(lt);
            } else {
              i = lt + 2;
              mode = { kind: 'bogus' };
            }

            break;
          }

          if (next === 0x3f) {
            i = lt + 2;
            mode = { kind: 'bogus' };
            break;
          }

          if (next === 0x2f) {
            if (lt + 2 >= len) {
              hold(lt);
              break;
            }

            const after = buf.charCodeAt(lt + 2);

            if (isLetter(after)) {
              const tag = readTagName(buf, lt + 2);
              const end = tag ? scanAttributes(buf, tag.end, null) : -1;

              if (end < 0) {
                hold(lt);
                break;
              }

              i = end;

              if (tag!.name === 'template' && templateDepth > 0) templateDepth--;
            } else if (after === 0x3e) {
              i = lt + 3;
            } else {
              i = lt + 2;
              mode = { kind: 'bogus' };
            }

            break;
          }

          if (isLetter(next)) {
            const head = readTagName(buf, lt + 1);

            if (!head) {
              hold(lt);
              break;
            }

            const { name } = head;
            const attrs: Record<string, string> | null = name === ISLAND ? Object.create(null) : null;
            const end = scanAttributes(buf, head.end, attrs);

            if (end < 0) {
              hold(lt);
              break;
            }

            if (attrs && templateDepth === 0) {
              const rewrite = onIsland(attrs);

              if (rewrite?.prepend) {
                flush(lt);
                out += rewrite.prepend;
              }
            }

            i = end;

            if (name === 'script') mode = { kind: 'script', escape: 0 };
            else if (name !== null && RAW_TEXT.has(name)) mode = { kind: 'rawtext', endTag: `</${name}` };
            else if (name === 'plaintext') mode = { kind: 'plaintext' };
            else if (name === 'template') templateDepth++;

            break;
          }

          i = lt + 1;
          break;
        }
      }
    }

    flush(len);

    return out;
  };

  return {
    write(chunk) {
      const buf = carry + chunk;

      carry = '';

      return scan(buf);
    },
    end() {
      const tail = carry;

      carry = '';

      // whatwg eof-in-tag: a partial tag is never emitted; anything else held back is plain bytes
      return mode.kind === 'data' && /^<\/?[a-zA-Z]/.test(tail) ? '' : tail;
    },
  };
}
