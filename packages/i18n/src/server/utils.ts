const LOWERCASE_A = 97;

/**
 * Convert index to lowercase letter: 0→'a', 1→'b', ..., 25→'z'
 */
function indexToLetter(index: number): string {
  return String.fromCharCode(LOWERCASE_A + index);
}

/**
 * Generate short variable name using bijective base-26: 0→'a', 25→'z', 26→'aa', 27→'ab', ...
 */
export function generateBB26(index: number): string {
  let name = '';
  let remaining = index;

  do {
    name = indexToLetter(remaining % 26) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);

  return name;
}

/**
 * Generate a JS-safe variable name for the inline i18n script.
 */
export function generateVarName(index: number): string {
  return `_${generateBB26(index)}`;
}
