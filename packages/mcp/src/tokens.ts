import { createHash, randomBytes } from "node:crypto";

// Personal API tokens: `tf_` + 32 random bytes (base64url). Only the SHA-256
// hash is stored (api_tokens.token_hash); the database hashes the same way
// (private.hash_api_token), so either side can look a token up.

const TOKEN_PATTERN = /^tf_[A-Za-z0-9_-]{43}$/;

/** A new token and the hash to store. Show `token` to the user once. */
export function generateApiToken(): { token: string; hash: string } {
  const token = `tf_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashApiToken(token) };
}

/** Lowercase hex SHA-256 of the token's UTF-8 bytes. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikeApiToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
