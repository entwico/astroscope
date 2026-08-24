const LOWERCASE_A = 97;

/**
 * Convert index to lowercase letter: 0→'a', 1→'b', ..., 25→'z'
 */
function indexToLetter(index: number): string {
  return String.fromCharCode(LOWERCASE_A + index);
}

/**
 * Names in the bb26 sequence that are JavaScript reserved words. Emitting one
 * as a `var` name (`var do = ...`) is a SyntaxError that kills the whole
 * inline i18n script — every client translation on the page goes dark.
 */
const RESERVED_NAMES = new Set(['do', 'if', 'in', 'for', 'new', 'try', 'var', 'let']);

/**
 * Raw bijective base-26 name: 0→'a', 25→'z', 26→'aa', 27→'ab', ...
 */
function rawBB26(index: number): string {
  let name = '';
  let remaining = index;

  do {
    name = indexToLetter(remaining % 26) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);

  return name;
}

function rawRank(name: string): number {
  for (let i = 0; ; i++) {
    if (rawBB26(i) === name) return i;
  }
}

const RESERVED_RANKS = [...RESERVED_NAMES].map(rawRank).sort((a, b) => a - b);

/**
 * Generate the index-th short variable name in bijective base-26 order
 * (0→'a', 25→'z', 26→'aa', ...), skipping reserved words so every emitted
 * name is a valid JavaScript identifier.
 */
export function generateBB26(index: number): string {
  let shifted = index;

  for (const rank of RESERVED_RANKS) {
    if (shifted >= rank) shifted++;
  }

  return rawBB26(shifted);
}
