export const IToolRegistryABI = [
  {
    type: "event",
    name: "AccessPredicateUpdated",
    inputs: [
      { name: "toolId", type: "uint256", indexed: true },
      { name: "newPredicate", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ToolDeregistered",
    inputs: [
      { name: "toolId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ToolMetadataUpdated",
    inputs: [
      { name: "toolId", type: "uint256", indexed: true },
      { name: "newURI", type: "string", indexed: false },
      { name: "newHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ToolRegistered",
    inputs: [
      { name: "toolId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "accessPredicate", type: "address", indexed: true },
      { name: "metadataURI", type: "string", indexed: false },
      { name: "manifestHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "error",
    name: "InvalidAccessPredicate",
    inputs: [
      { name: "predicate", type: "address" },
    ],
  },
  {
    type: "error",
    name: "InvalidManifestHash",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidMetadataURI",
    inputs: [],
  },
  {
    type: "error",
    name: "NotToolCreator",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "caller", type: "address" },
    ],
  },
  {
    type: "error",
    name: "ToolIsDeregistered",
    inputs: [
      { name: "toolId", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ToolNotFound",
    inputs: [
      { name: "toolId", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "deregisterTool",
    inputs: [
      { name: "toolId", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getToolConfig",
    inputs: [
      { name: "toolId", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "metadataURI", type: "string" },
          { name: "manifestHash", type: "bytes32" },
          { name: "accessPredicate", type: "address" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasAccess",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "account", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [
      { name: "", type: "string" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerTool",
    inputs: [
      { name: "metadataURI", type: "string" },
      { name: "manifestHash", type: "bytes32" },
      { name: "accessPredicate", type: "address" },
    ],
    outputs: [
      { name: "toolId", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAccessPredicate",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "newPredicate", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "toolCount",
    inputs: [],
    outputs: [
      { name: "", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tryHasAccess",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "account", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "granted", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "updateToolMetadata",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "newURI", type: "string" },
      { name: "newHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "version",
    inputs: [],
    outputs: [
      { name: "", type: "string" },
    ],
    stateMutability: "view",
  },
] as const

export const ToolRegisteredEvent = IToolRegistryABI.find(
  (e) => e.type === "event" && e.name === "ToolRegistered",
)!

export const ToolDeregisteredEvent = IToolRegistryABI.find(
  (e) => e.type === "event" && e.name === "ToolDeregistered",
)!

export const IAccessPredicateABI = [
  {
    type: "function",
    name: "hasAccess",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "account", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRequirements",
    inputs: [{ name: "toolId", type: "uint256" }],
    outputs: [
      {
        name: "requirements",
        type: "tuple[]",
        components: [
          { name: "kind", type: "bytes4" },
          { name: "data", type: "bytes" },
          { name: "label", type: "string" },
        ],
      },
      { name: "logic", type: "uint8" },
    ],
    stateMutability: "view",
  },
] as const

export const ERC721OwnerPredicateABI = [
  {
    type: "function",
    name: "setCollections",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "collections", type: "address[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getCollections",
    inputs: [{ name: "toolId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
  },
] as const

export const ERC1155OwnerPredicateABI = [
  {
    type: "event",
    name: "CollectionTokensSet",
    inputs: [
      { name: "toolId", type: "uint256", indexed: true },
      {
        name: "entries",
        type: "tuple[]",
        indexed: false,
        components: [
          { name: "collection", type: "address" },
          { name: "tokenIds", type: "uint256[]" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "setCollectionTokens",
    inputs: [
      { name: "toolId", type: "uint256" },
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "collection", type: "address" },
          { name: "tokenIds", type: "uint256[]" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getCollectionTokens",
    inputs: [{ name: "toolId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "collection", type: "address" },
          { name: "tokenIds", type: "uint256[]" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const

export const SubscriptionPredicateABI = [
  {
    type: "event",
    name: "ToolGatingConfigured",
    inputs: [
      { name: "toolId", type: "uint256", indexed: true },
      { name: "collection", type: "address", indexed: true },
      { name: "minTier", type: "uint8", indexed: false },
    ],
  },
  {
    type: "function",
    name: "configureToolGating",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "collection", type: "address" },
      { name: "minTier", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getToolGatingConfig",
    inputs: [{ name: "toolId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "collection", type: "address" },
          { name: "minTier", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getSubscriptionStatus",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [
      { name: "hasNft", type: "bool" },
      { name: "tier", type: "uint8" },
      { name: "requiredTier", type: "uint8" },
      { name: "expiration", type: "uint64" },
      { name: "active", type: "bool" },
    ],
    stateMutability: "view",
  },
] as const

export const CompositePredicateABI = [
  {
    type: "event",
    name: "CompositionSet",
    inputs: [
      { name: "toolId", type: "uint256", indexed: true },
      { name: "op", type: "uint8", indexed: false },
      {
        name: "terms",
        type: "tuple[]",
        indexed: false,
        components: [
          { name: "predicate", type: "address" },
          { name: "negate", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "setComposition",
    inputs: [
      { name: "toolId", type: "uint256" },
      { name: "op", type: "uint8" },
      {
        name: "terms",
        type: "tuple[]",
        components: [
          { name: "predicate", type: "address" },
          { name: "negate", type: "bool" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getOp",
    inputs: [{ name: "toolId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTerms",
    inputs: [{ name: "toolId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "predicate", type: "address" },
          { name: "negate", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const

/**
 * Minimal ABI for delegate.xyz's DelegateRegistry V2.
 * Only includes `checkDelegateForAll` which is the function we use to verify
 * wallet-level delegations.
 * @see https://docs.delegate.xyz/technical-documentation/delegate-registry/idelegateregistry.sol
 */
export const IDelegateRegistryABI = [
  {
    type: "function",
    name: "checkDelegateForAll",
    inputs: [
      { name: "to", type: "address" },
      { name: "from", type: "address" },
      { name: "rights", type: "bytes32" },
    ],
    outputs: [{ name: "valid", type: "bool" }],
    stateMutability: "view",
  },
] as const
