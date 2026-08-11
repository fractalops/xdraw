const UINT32_MAX = 0xffffffff;

/** @param {string} value */
export function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * @param {string} id
 * @param {string} [salt]
 */
export function seedFor(id, salt = "seed") {
  return stableHash(`${salt}:${id}`) || 1;
}

/** @param {string} id */
export function nonceFor(id) {
  return (seedFor(id, "nonce") ^ UINT32_MAX) >>> 0;
}
