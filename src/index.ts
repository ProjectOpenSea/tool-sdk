export type { ExpressRequest, ExpressResponse } from "./lib/adapters/express.js"
export { toExpressHandler } from "./lib/adapters/express.js"
export type { VercelRequest, VercelResponse } from "./lib/adapters/vercel.js"
export { toVercelHandler } from "./lib/adapters/vercel.js"
export type { Eip3009AuthenticatedFetchOptions } from "./lib/client/eip3009-auth.js"
export {
  createEip3009AuthHeader,
  eip3009AuthenticatedFetch,
} from "./lib/client/eip3009-auth.js"
export {
  createBankrAccount,
  createExternalSignerAccount,
} from "./lib/client/external-signer.js"
export type { PaidAuthenticatedFetchOptions } from "./lib/client/paid-authenticated-fetch.js"
export { paidAuthenticatedFetch } from "./lib/client/paid-authenticated-fetch.js"
/** @deprecated Use `eip3009AuthenticatedFetch` instead. */
export type { AuthenticatedFetchOptions } from "./lib/client/siwe-auth.js"
/** @deprecated Use `eip3009AuthenticatedFetch` and `createEip3009AuthHeader` instead. */
export {
  authenticatedFetch,
  createSiweAuthHeader,
  createSiweMessage,
} from "./lib/client/siwe-auth.js"
export type {
  PaidFetchOptions,
  PaymentRequirements,
} from "./lib/client/x402-payment.js"
export {
  buildSettlementResponseHeader,
  extractSettlementTxHash,
  paidFetch,
  signX402Payment,
} from "./lib/client/x402-payment.js"
export { ToolHandlerError } from "./lib/handler/error.js"
export type { ToolHandlerConfig } from "./lib/handler/index.js"
export { createToolHandler } from "./lib/handler/index.js"
export type { EnvResolver, ManifestDefinition } from "./lib/manifest/index.js"
export {
  defineManifest,
  findBareExtensionKeys,
  resolveManifest,
  validateManifest,
} from "./lib/manifest/index.js"
export {
  AccessRequirementSchema,
  AccessSchema,
  AttestationSchema,
  PricingEntrySchema,
  ReproducibleBuildSchema,
  ToolManifestSchema,
  VerifiabilitySchema,
} from "./lib/manifest/schema.js"
export type {
  Access,
  AccessRequirement,
  Attestation,
  PricingEntry,
  ReproducibleBuild,
  ToolManifest,
  Verifiability,
} from "./lib/manifest/types.js"
export type {
  HardwareAttestedConfig,
  SelfAttestedConfig,
  VerifiableConfig,
} from "./lib/manifest/verifiability.js"
export { defineVerifiability } from "./lib/manifest/verifiability.js"
export type {
  PaidPredicateGateConfig,
  PredicateGateConfig,
} from "./lib/middleware/predicate-gate.js"
export {
  paidPredicateGate,
  predicateGate,
} from "./lib/middleware/predicate-gate.js"
export type { WellKnownHandlerOptions } from "./lib/middleware/well-known.js"
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
  CompositePredicateABI,
  ERC20BalancePredicateABI,
  ERC721OwnerPredicateABI,
  ERC1155OwnerPredicateABI,
  IAccessPredicateABI,
  IDelegateRegistryABI,
  IToolRegistryABI,
  SubscriptionPredicateABI,
  TraitGatedPredicateABI,
} from "./lib/onchain/abis.js"
export type {
  AccessRequirementInfo,
  CheckToolAccessOptions,
  CheckToolAccessResult,
  DecodedERC20BalanceRequirement,
  DecodedERC721Requirement,
  DecodedERC1155Requirement,
  DecodedERC7496TraitRequirement,
  DecodedRequirement,
  DecodedSubscriptionRequirement,
  DecodedUnknownRequirement,
  DecodedWalletStateAttestationRequirement,
  DescribeToolAccessOptions,
  ToolAccessDescription,
} from "./lib/onchain/access.js"
export {
  checkToolAccess,
  decodeRequirement,
  describeToolAccess,
  ERC20_BALANCE_KIND,
  ERC721_KIND,
  ERC1155_KIND,
  ERC7496_TRAIT_KIND,
  SUBSCRIPTION_KIND,
  WALLET_STATE_ATTESTATION_KIND,
} from "./lib/onchain/access.js"
export type { Deployment } from "./lib/onchain/chains.js"
export {
  DELEGATE_REGISTRY,
  deploymentAddress,
  ERC20_BALANCE_PREDICATE,
  ERC721_OWNER_PREDICATE,
  ERC1155_OWNER_PREDICATE,
  SUBSCRIPTION_PREDICATE,
  TOOL_REGISTRY,
  TRAIT_GATED_PREDICATE,
} from "./lib/onchain/chains.js"
export { computeManifestHash } from "./lib/onchain/hash.js"
export type {
  CompositeTerm,
  PredicateClientConfig,
} from "./lib/onchain/predicate-clients.js"
export {
  CompositeOp,
  CompositePredicateClient,
  ERC20BalancePredicateClient,
  ERC721OwnerPredicateClient,
  ERC1155OwnerPredicateClient,
  SubscriptionPredicateClient,
  TraitGatedPredicateClient,
} from "./lib/onchain/predicate-clients.js"
export { ToolRegistryClient } from "./lib/onchain/registry.js"
export type {
  CallerEip3009UsageEvent,
  CallerUsageReporterConfig,
  CallerX402UsageEvent,
} from "./lib/usage/caller-reporter.js"
export {
  reportCallerEip3009Usage,
  reportCallerX402Usage,
} from "./lib/usage/caller-reporter.js"
export type {
  SignZeroValueAuthorizationParams,
  ZeroValueAuthorization,
} from "./lib/usage/eip3009-auth.js"
export { signZeroValueAuthorization } from "./lib/usage/eip3009-auth.js"
export type { Eip3009UsageReporterConfig } from "./lib/usage/eip3009-reporter.js"
export { createEip3009UsageReporter } from "./lib/usage/eip3009-reporter.js"
export type {
  X402UsageEvent,
  X402UsageReporterConfig,
} from "./lib/usage/x402-reporter.js"
export { createX402UsageReporter } from "./lib/usage/x402-reporter.js"
export { deriveSlug } from "./lib/utils.js"
export type {
  TransactionRequest,
  TransactionResult,
  WalletAdapter,
  WalletCapabilities,
  WalletProvider,
} from "./lib/wallet/index.js"
export {
  BankrAdapter,
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
  InvocationEvent,
  ToolContext,
} from "./types.js"
