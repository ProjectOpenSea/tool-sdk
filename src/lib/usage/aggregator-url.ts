/**
 * Every usage report carries an `x-api-key` header and payment attestation
 * data, so none of them may travel in plaintext. `aggregatorUrl` is operator
 * config that defaults to `https://api.opensea.io/api/v2/tools/usage`, and an
 * operator who points it at an `http:` host would ship their API key in the
 * clear without noticing.
 *
 * Require `https`, allowing `http://localhost` and `http://127.0.0.1` so a
 * local aggregator still works during development. This is a scheme check,
 * not a private-address guard: loopback is deliberately permitted, so
 * resolving the hostname and refusing private addresses would break the one
 * case the exception exists for.
 */
export function isSecureAggregatorUrl(aggregatorUrl: string): boolean {
  try {
    const url = new URL(aggregatorUrl)
    if (url.protocol === "https:") return true
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  } catch {
    return false
  }
}
