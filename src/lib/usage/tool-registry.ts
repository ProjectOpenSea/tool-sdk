export function normalizeToolRegistryAddress(registry: string): string {
  switch (registry.toLowerCase()) {
    case "x402:bazaar":
      return "x402_bazaar"
    case "x402:bankr":
      return "x402_bankr"
    default:
      return registry
  }
}
