export const IToolRegistryABI = [
  {
    type: "event",
    name: "ToolRegistered",
    inputs: [
      { name: "toolId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      {
        name: "accessPredicate",
        type: "address",
        indexed: true,
      },
      { name: "metadataURI", type: "string", indexed: false },
      { name: "manifestHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "function",
    name: "registerTool",
    inputs: [
      { name: "metadataURI", type: "string" },
      { name: "manifestHash", type: "bytes32" },
      { name: "accessPredicate", type: "address" },
    ],
    outputs: [{ name: "toolId", type: "uint256" }],
    stateMutability: "nonpayable",
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
    name: "getToolConfig",
    inputs: [{ name: "toolId", type: "uint256" }],
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
    outputs: [{ name: "", type: "bool" }],
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
    name: "toolCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "version",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const

export const IAccessPredicateABI = [
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ type: "string" }],
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
