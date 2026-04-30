export type { ExpressRequest, ExpressResponse } from "./lib/adapters/express.js"
export { toExpressHandler } from "./lib/adapters/express.js"
export type { VercelRequest, VercelResponse } from "./lib/adapters/vercel.js"
export { toVercelHandler } from "./lib/adapters/vercel.js"
export type { AuthenticatedFetchOptions } from "./lib/client/siwe-auth.js"
export {
  authenticatedFetch,
  createSiweMessage,
} from "./lib/client/siwe-auth.js"
export type {
  PaidFetchOptions,
  PaymentRequirements,
} from "./lib/client/x402-payment.js"
export { paidFetch, signX402Payment } from "./lib/client/x402-payment.js"
export { ToolHandlerError } from "./lib/handler/error.js"
export type { ToolHandlerConfig } from "./lib/handler/index.js"
export { createToolHandler } from "./lib/handler/index.js"
export {
  defineManifest,
  validateManifest,
} from "./lib/manifest/index.js"
export {
  PricingEntrySchema,
  ToolManifestSchema,
} from "./lib/manifest/schema.js"
export type {
  PricingEntry,
  ToolManifest,
} from "./lib/manifest/types.js"
export type { NFTGateConfig } from "./lib/middleware/nft-gate.js"
export { nftGate } from "./lib/middleware/nft-gate.js"
export type { PredicateGateConfig } from "./lib/middleware/predicate-gate.js"
export { predicateGate } from "./lib/middleware/predicate-gate.js"
export { createWellKnownHandler } from "./lib/middleware/well-known.js"
export type { X402GateConfig } from "./lib/middleware/x402.js"
/**
 * Low-level x402 gate. Prefer `payaiX402Gate` or `cdpX402Gate` for the
 * common case of verifying USDC payments via a hosted facilitator. Use this
 * directly only if you are running your own facilitator or implementing
 * payment verification from scratch.
 */
export { x402Gate } from "./lib/middleware/x402.js"
export type {
  CdpX402GateConfig,
  HostedX402GateConfig,
  ToolPaywallConfig,
  X402Network,
} from "./lib/middleware/x402-facilitators.js"
export {
  CDP_X402_FACILITATOR_URL,
  cdpX402Gate,
  defineToolPaywall,
  PAYAI_X402_FACILITATOR_URL,
  payaiX402Gate,
  USDC_BASE_ADDRESS,
  USDC_BASE_SEPOLIA_ADDRESS,
  x402UsdcPricing,
} from "./lib/middleware/x402-facilitators.js"
export {
  ERC721OwnerPredicateABI,
  ERC1155OwnerPredicateABI,
  IToolRegistryABI,
} from "./lib/onchain/abis.js"
export type {
  CheckToolAccessOptions,
  CheckToolAccessResult,
} from "./lib/onchain/access.js"
export { checkToolAccess } from "./lib/onchain/access.js"
export type { Deployment } from "./lib/onchain/chains.js"
export {
  deploymentAddress,
  ERC721_OWNER_PREDICATE,
  ERC1155_OWNER_PREDICATE,
  TOOL_REGISTRY,
} from "./lib/onchain/chains.js"
export { computeManifestHash } from "./lib/onchain/hash.js"
export { ToolRegistryClient } from "./lib/onchain/registry.js"
export { deriveSlug } from "./lib/utils.js"
export type {
  TransactionRequest,
  TransactionResult,
  WalletAdapter,
  WalletCapabilities,
  WalletProvider,
} from "./lib/wallet/index.js"
export {
  createWalletForProvider,
  createWalletFromEnv,
  FireblocksAdapter,
  PrivateKeyAdapter,
  PrivyAdapter,
  TurnkeyAdapter,
  WALLET_PROVIDERS,
  walletAdapterToClient,
} from "./lib/wallet/index.js"
export type {
  GateMiddleware,
  ToolContext,
} from "./types.js"
