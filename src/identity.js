const UINT32_MAX = 0xffffffff;

export function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seedFor(id, salt = "seed") {
  return stableHash(`${salt}:${id}`) || 1;
}

export function nonceFor(id) {
  return (seedFor(id, "nonce") ^ UINT32_MAX) >>> 0;
}
