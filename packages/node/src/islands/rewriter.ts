/* eslint-disable unicorn/prefer-code-point, unicorn/no-break-in-nested-loop -- byte-level html scanner on the hot path: `charCodeAt` and in-loop `break` are deliberate */
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

/**
 * a complete tag seen in the data state of html content (one the scanner has a name
 * for), `[start, end)` its bounds in everything written so far
 */
export type TagHandler = (name: string, closing: boolean, start: number, end: number) => void;

const ISLAND = 'astro-island';
const RAW_TEXT = new Set(['style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);

// an island inside `<svg>`/`<math>` is a foreign element, never hydrated, so nothing is injected there:
// the scanner tracks the namespaces the way the tree builder does — html start tags that break out of
// foreign content, the integration points whose content follows html rules again — only to leave it at
// the right place, and its raw-text rules apply to html content alone
type Namespace = 'html' | 'svg' | 'math';

const BREAKOUT = new Set(
  (
    'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing ' +
    'menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var'
  ).split(' '),
);
const SVG_INTEGRATION = new Set(['foreignobject', 'desc', 'title']);
const MATH_INTEGRATION = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);
const ANNOTATION_ENCODINGS = new Set(['text/html', 'application/xhtml+xml']);

// longest marker a raw-text scan must be able to complete across a chunk boundary: `</script` plus its terminator
const RAW_TAIL = 9;

// the named references astro's escaper emits; any other stays literal, which at worst mismatches a manifest url
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

// numeric references in the C1 control range map to windows-1252 code points
const C1_REMAP: Record<number, number> = {
  0x80: 0x20_AC,
  0x82: 0x20_1A,
  0x83: 0x01_92,
  0x84: 0x20_1E,
  0x85: 0x20_26,
  0x86: 0x20_20,
  0x87: 0x20_21,
  0x88: 0x02_C6,
  0x89: 0x20_30,
  0x8A: 0x01_60,
  0x8B: 0x20_39,
  0x8C: 0x01_52,
  0x8E: 0x01_7D,
  0x91: 0x20_18,
  0x92: 0x20_19,
  0x93: 0x20_1C,
  0x94: 0x20_1D,
  0x95: 0x20_22,
  0x96: 0x20_13,
  0x97: 0x20_14,
  0x98: 0x02_DC,
  0x99: 0x21_22,
  0x9A: 0x01_61,
  0x9B: 0x20_3A,
  0x9C: 0x01_53,
  0x9E: 0x01_7E,
  0x9F: 0x01_78,
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
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function isWhitespace(code: number): boolean {
  // eslint-disable-next-line unicorn/prefer-includes-over-repeated-comparisons -- hot path, the comparisons stay in registers
  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0C || code === 0x0D;
}

function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A);
}

/** whitespace, `/` or `>`: what ends a tag name and what may follow an end tag name in raw text */
function isTagEnd(code: number): boolean {
  return isWhitespace(code) || code === 0x2F || code === 0x3E;
}

function decodeAttribute(value: string): string {
  if (!value.includes('&') && !value.includes('\r') && !value.includes('\0')) {
    return value;
  }

  return value
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll('\u{0}', '�')
    .replaceAll(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (match, hex, dec, name) => {
      if (name) {
        return NAMED_ENTITIES[name] ?? match;
      }

      const code = Number.parseInt(hex ?? dec, hex ? 16 : 10);

      if (code === 0 || code > 0x10_FF_FF || (code >= 0xD8_00 && code <= 0xDF_FF)) {
        return '�';
      }

      return String.fromCodePoint(C1_REMAP[code] ?? code);
    });
}

type NamesByLength = Record<number, string[]>;

// the names html content acts on — every other tag passes through without a lookup
const HTML_NAMES: NamesByLength = {
  3: ['xmp', 'svg'],
  4: ['math'],
  5: ['style', 'title'],
  6: ['script', 'iframe'],
  7: ['noembed'],
  8: ['noframes', 'noscript', 'textarea', 'template'],
  9: ['plaintext'],
  12: [ISLAND],
};

// inside or right below foreign content the breakout tags and integration points matter too
const FOREIGN_NAMES: NamesByLength = mergeNames(HTML_NAMES, [
  ...BREAKOUT,
  ...SVG_INTEGRATION,
  ...MATH_INTEGRATION,
  'annotation-xml',
  'font',
]);

function mergeNames(base: NamesByLength, names: string[]): NamesByLength {
  const merged: NamesByLength = Object.fromEntries(Object.entries(base).map(([length, list]) => [length, [...list]]));

  for (const name of names) {
    const list = (merged[name.length] ??= []);

    if (!list.includes(name)) list.push(name);
  }

  return merged;
}

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
function readTagName(buf: string, i: number, names: NamesByLength): { name: string | null; end: number } | null {
  const nameStart = i;

  while (i < buf.length && !isTagEnd(buf.charCodeAt(i))) i++;

  if (i >= buf.length) return null;

  const candidates = names[i - nameStart];
  const name = candidates?.find((candidate) => equalsIgnoreCase(buf, nameStart, candidate)) ?? null;

  return { name, end: i };
}

// whether the tag `scanAttributes` last completed carried the self-closing flag: a `/` directly before its `>`
let selfClosing = false;

/**
 * walks a tag's attributes from just after its name to its `>`, collecting them
 * into `attrs` when given; -1 when the tag is not complete in `buf`. Follows the
 * attribute states exactly: a quote opens a value only right after `=` in the
 * attribute-name position, anywhere else it is a plain name or value character.
 */
function scanAttributes(buf: string, i: number, attrs: Record<string, string> | null): number {
  const len = buf.length;

  for (;;) {
    const between = i;

    while (i < len && (isWhitespace(buf.charCodeAt(i)) || buf.charCodeAt(i) === 0x2F)) i++;

    if (i >= len) return -1;

    if (buf.charCodeAt(i) === 0x3E) {
      selfClosing = i > between && buf.charCodeAt(i - 1) === 0x2F;

      return i + 1;
    }

    const nameStart = i;

    // a leading `=` is part of the attribute name
    if (buf.charCodeAt(i) === 0x3D) i++;

    while (i < len) {
      const code = buf.charCodeAt(i);

      // everything above `>` (letters, `_`, non-ascii) is a name character; only `=`, `/`, `>` and whitespace end it
      if (code <= 0x3E && (code === 0x3D || isTagEnd(code))) break;

      i++;
    }

    if (i >= len) return -1;

    const nameEnd = i;

    while (i < len && isWhitespace(buf.charCodeAt(i))) i++;

    if (i >= len) return -1;

    let valueStart = i;
    let valueEnd = i;

    if (buf.charCodeAt(i) === 0x3D) {
      i++;

      while (i < len && isWhitespace(buf.charCodeAt(i))) i++;

      if (i >= len) return -1;

      const quote = buf.charCodeAt(i);

      if (quote === 0x22 || quote === 0x27) {
        const close = buf.indexOf(String.fromCharCode(quote), i + 1);

        if (close === -1) return -1;

        valueStart = i + 1;
        valueEnd = close;
        i = close + 1;
      } else {
        valueStart = i;

        while (i < len && !isWhitespace(buf.charCodeAt(i)) && buf.charCodeAt(i) !== 0x3E) i++;

        if (i >= len) return -1;

        valueEnd = i;
      }
    }

    if (!attrs) continue;

    const name = buf.slice(nameStart, nameEnd).toLowerCase();

    if (!Object.hasOwn(attrs, name)) {
      defineLazyAttribute(attrs, name, buf.slice(valueStart, valueEnd));
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

export function createIslandRewriter(onIsland: IslandTagHandler, onTag: TagHandler | null = null): IslandRewriter {
  let mode: Mode = DATA;
  let carry = '';
  let written = 0;
  // islands inside `<template>` are inert until cloned, so they get nothing
  let templateDepth = 0;
  // the namespace stack, innermost first; html content sits above an integration point
  const namespaces: Namespace[] = ['html'];

  const names = (): NamesByLength => (onTag || namespaces.length > 1 ? FOREIGN_NAMES : HTML_NAMES);

  const foreign = (): boolean => namespaces[0] !== 'html';

  const leaveForeign = (): void => {
    while (foreign()) namespaces.shift();
  };

  // `</svg>` / `</math>` close through everything foreign above the matching element
  const closeForeign = (name: Namespace): void => {
    const at = namespaces.indexOf(name);
    const html = namespaces.indexOf('html');

    if (at === -1 || (html !== -1 && html < at)) return;

    namespaces.splice(0, at + 1);
  };

  const opensIntegrationPoint = (name: string, attrs: Record<string, string> | null): boolean => {
    if (namespaces[0] === 'svg') return SVG_INTEGRATION.has(name);
    if (name === 'annotation-xml') return ANNOTATION_ENCODINGS.has(attrs?.['encoding']?.toLowerCase() ?? '');

    return MATH_INTEGRATION.has(name);
  };

  // an end tag of the integration point html content sits in
  const closesIntegrationPoint = (name: string): boolean => {
    if (namespaces[1] === 'svg') return SVG_INTEGRATION.has(name);

    return name === 'annotation-xml' || MATH_INTEGRATION.has(name);
  };

  const breaksOut = (name: string, attrs: Record<string, string> | null): boolean => {
    if (name === 'font') return !!attrs && ('color' in attrs || 'face' in attrs || 'size' in attrs);

    return BREAKOUT.has(name);
  };

  const scan = (buf: string, offset: number): string => {
    const len = buf.length;
    // output is the input with insertions: everything between `emitted` and the
    // scan position is untouched source, flushed as one slice when something is
    // inserted, held back, or the buffer ends
    let out = '';
    let emitted = 0;
    let i = 0;

    const flush = (to: number): void => {
      if (!(to > emitted)) {
        return;
      }

      out += buf.slice(emitted, to);
      emitted = to;
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

          if (close === -1) {
            i = len;
          } else {
            i = close + 1;
            mode = DATA;
          }

          break;
        }

        case 'cdata': {
          const close = buf.indexOf(']]>', i);

          if (close === -1) {
            hold(Math.max(i, len - 2));
          } else {
            i = close + 3;
            mode = DATA;
          }

          break;
        }

        case 'comment': {
          const dashes = buf.indexOf('-->', i);
          const bang = buf.indexOf('--!>', mode.bangAt);
          const close = dashes !== -1 && (bang === -1 || dashes < bang) ? dashes + 3 : (bang === -1 ? -1 : bang + 4);

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

            if (dashes >= 0 && (lt === -1 || dashes < lt)) {
              mode = { kind: 'script', escape: 0 };
              k = dashes + 3;
              continue;
            }

            if (lt === -1) {
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

          if (lt === -1) {
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

          if (next === 0x3F) {
            i = lt + 2;
            mode = { kind: 'bogus' };
            break;
          }

          if (next === 0x2F) {
            if (lt + 2 >= len) {
              hold(lt);
              break;
            }

            const after = buf.charCodeAt(lt + 2);

            if (isLetter(after)) {
              const tag = readTagName(buf, lt + 2, names());
              const end = tag ? scanAttributes(buf, tag.end, null) : -1;

              if (end < 0) {
                hold(lt);
                break;
              }

              i = end;

              const { name } = tag!;

              if (name === null) break;

              // any other end tag inside foreign content closes nothing the scanner tracks
              if (name === 'svg' || name === 'math') {
                closeForeign(name);
              } else if (!foreign()) {
                if (namespaces.length > 1 && closesIntegrationPoint(name)) {
                  namespaces.shift();
                } else {
                  if (name === 'template' && templateDepth > 0) templateDepth--;
                  if (onTag) onTag(name, true, offset + lt, offset + end);
                }
              }
            } else if (after === 0x3E) {
              i = lt + 3;
            } else {
              i = lt + 2;
              mode = { kind: 'bogus' };
            }

            break;
          }

          if (isLetter(next)) {
            const head = readTagName(buf, lt + 1, names());

            if (!head) {
              hold(lt);
              break;
            }

            const { name } = head;
            const inForeign = foreign();
            const wantsAttrs = inForeign ? name === 'font' || name === 'annotation-xml' : name === ISLAND;
            const attrs: Record<string, string> | null = wantsAttrs ? Object.create(null) : null;
            const end = scanAttributes(buf, head.end, attrs);

            if (end < 0) {
              hold(lt);
              break;
            }

            i = end;

            if (name === null) break;

            if (inForeign) {
              if (!breaksOut(name, attrs)) {
                if (name === 'svg' || name === 'math') {
                  if (!selfClosing) namespaces.unshift(name);
                } else if (!selfClosing && opensIntegrationPoint(name, attrs)) {
                  namespaces.unshift('html');
                }

                break;
              }

              // the breakout tag itself is html content
              leaveForeign();
            }

            switch (name) {
              case ISLAND: {
                const rewrite = templateDepth === 0 ? onIsland(attrs!) : null;

                if (rewrite?.prepend) {
                  flush(lt);
                  out += rewrite.prepend;
                }

                break;
              }
              case 'script': {
                mode = { kind: 'script', escape: 0 };
                break;
              }
              case 'plaintext': {
                mode = { kind: 'plaintext' };
                break;
              }
              case 'template': {
                templateDepth++;
                break;
              }
              case 'svg':
              case 'math': {
                if (!selfClosing) namespaces.unshift(name);

                break;
              }
              default: {
                if (RAW_TEXT.has(name)) mode = { kind: 'rawtext', endTag: `</${name}` };
                else if (onTag) onTag(name, false, offset + lt, offset + end);
              }
            }

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
      const offset = written - carry.length;

      written += chunk.length;
      carry = '';

      return scan(buf, offset);
    },
    end() {
      const tail = carry;

      carry = '';

      // whatwg eof-in-tag: a partial tag is never emitted; anything else held back is plain bytes
      return mode.kind === 'data' && /^<\/?[a-zA-Z]/.test(tail) ? '' : tail;
    },
  };
}
