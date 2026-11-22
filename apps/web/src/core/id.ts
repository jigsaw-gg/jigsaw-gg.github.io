/**
 * ULID-shaped ids without the timestamp prefix.
 *
 * Same length (26) and Crockford Base32 alphabet as ULID, but every character
 * is random — no sortable time component. The first character is restricted to
 * letters (`A`–`Z` excluding ambiguous Crockford omissions) so ids never start
 * with a digit.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CROCKFORD_LETTER = 'ABCDEFGHJKMNPQRSTVWXYZ'
export const ULID_LIKE_LENGTH = 26
export const ULID_LIKE =
  /^[ABCDEFGHJKMNPQRSTVWXYZ][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/

function randomChar(alphabet: string): string {
  const bytes = new Uint8Array(1)
  crypto.getRandomValues(bytes)
  return alphabet[bytes[0]! % alphabet.length]!
}

export function createUlidLikeId(): string {
  let out = randomChar(CROCKFORD_LETTER)
  for (let i = 1; i < ULID_LIKE_LENGTH; i++) {
    out += randomChar(CROCKFORD)
  }
  return out
}
