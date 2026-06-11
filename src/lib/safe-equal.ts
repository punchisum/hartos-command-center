/**
 * src/lib/safe-equal.ts
 *
 * Length-checked constant-time string comparison for shared-secret checks
 * (webhook secrets, access tokens). Avoids early-exit timing leaks that a
 * plain `===` comparison can exhibit.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
