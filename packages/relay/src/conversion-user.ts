/** what the visitor entered for a conversion; a destination that identifies hashes it as it requires */
export type ConversionUser = {
  email?: string | undefined;
  phone?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
};

/** the identifiers of a visitor as the ad platforms match them: normalized, then sha256 as lowercase hex */
export type HashedUser = {
  email?: string | undefined;
  phone?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
};

export type HashOptions = {
  /**
   * The country calling code a national phone number gets (`49` for a German site): a number
   * with one leading zero is taken as national, `+` or `00` prefixes are international.
   */
  countryCallingCode?: string | undefined;
};

/** normalizes and hashes the identifiers the way the pixels and the conversions apis expect them */
export async function hashUser(user: ConversionUser, options: HashOptions = {}): Promise<HashedUser> {
  const [email, phone, firstName, lastName] = await Promise.all([
    hashOptional(normalizeEmail(user.email)),
    hashOptional(normalizePhone(user.phone, options.countryCallingCode)),
    hashOptional(normalizeName(user.firstName)),
    hashOptional(normalizeName(user.lastName)),
  ]);

  return withoutEmpty({ email, phone, firstName, lastName });
}

export function normalizeEmail(email: string | undefined): string | undefined {
  return email?.trim().toLowerCase() || undefined;
}

/**
 * Digits only, with the country calling code: a national number (one leading zero) gets the
 * site's code, `+` and `00` prefixes are dropped. Returns `undefined` for anything that is not
 * 8 to 15 digits afterwards.
 */
export function normalizePhone(phone: string | undefined, countryCallingCode: string | undefined): string | undefined {
  const compact = phone?.replaceAll(/[\s().-]/g, '');

  if (!compact) {
    return undefined;
  }

  const international = compact.startsWith('+') || compact.startsWith('00');
  const national = compact.replace(/^\+?0*/, '');
  const digits = international || !compact.startsWith('0') ? national : `${countryCallingCode ?? ''}${national}`;

  return /^\d{8,15}$/.test(digits) ? digits : undefined;
}

/** lowercase, without whitespace and punctuation */
export function normalizeName(name: string | undefined): string | undefined {
  return name?.toLowerCase().replaceAll(/[\s!-/:-@[-`{-~]/g, '') || undefined;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashOptional(value: string | undefined): Promise<string | undefined> {
  return value ? sha256(value) : undefined;
}

function withoutEmpty(user: HashedUser): HashedUser {
  return Object.fromEntries(Object.entries(user).filter(([, value]) => value)) as HashedUser;
}
