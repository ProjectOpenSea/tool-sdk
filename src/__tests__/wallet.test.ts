import { afterEach, beforeEach, describe, expect, it } from "vitest"

describe("createWalletFromEnv", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear all wallet-related env vars
    delete process.env.PRIVY_APP_ID
    delete process.env.PRIVY_APP_SECRET
    delete process.env.PRIVY_WALLET_ID
    delete process.env.FIREBLOCKS_API_KEY
    delete process.env.FIREBLOCKS_API_SECRET
    delete process.env.FIREBLOCKS_VAULT_ID
    delete process.env.TURNKEY_API_PUBLIC_KEY
    delete process.env.TURNKEY_API_PRIVATE_KEY
    delete process.env.TURNKEY_ORGANIZATION_ID
    delete process.env.TURNKEY_WALLET_ADDRESS
    delete process.env.TURNKEY_RPC_URL
    delete process.env.PRIVATE_KEY
    delete process.env.RPC_URL
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("should throw when no provider env vars are set", async () => {
    const { createWalletFromEnv } = await import("../lib/wallet/index.js")
    expect(() => createWalletFromEnv()).toThrow("No wallet provider configured")
  })

  it("should create PrivyAdapter when Privy env vars are set", async () => {
    process.env.PRIVY_APP_ID = "test-app-id"
    process.env.PRIVY_APP_SECRET = "test-app-secret"
    process.env.PRIVY_WALLET_ID = "test-wallet-id"

    const { createWalletFromEnv } = await import("../lib/wallet/index.js")
    const wallet = createWalletFromEnv()
    expect(wallet.name).toBe("privy")
  })

  it("should create FireblocksAdapter when Fireblocks env vars are set", async () => {
    process.env.FIREBLOCKS_API_KEY = "test-key"
    process.env.FIREBLOCKS_API_SECRET =
      "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----"
    process.env.FIREBLOCKS_VAULT_ID = "0"

    const { createWalletFromEnv } = await import("../lib/wallet/index.js")
    const wallet = createWalletFromEnv()
    expect(wallet.name).toBe("fireblocks")
  })

  it("should create TurnkeyAdapter when Turnkey env vars are set", async () => {
    process.env.TURNKEY_API_PUBLIC_KEY = "test-pubkey"
    process.env.TURNKEY_API_PRIVATE_KEY = "test-privkey"
    process.env.TURNKEY_ORGANIZATION_ID = "test-org-id"
    process.env.TURNKEY_WALLET_ADDRESS =
      "0x1234567890abcdef1234567890abcdef12345678"
    process.env.TURNKEY_RPC_URL = "http://localhost:8545"

    const { createWalletFromEnv } = await import("../lib/wallet/index.js")
    const wallet = createWalletFromEnv()
    expect(wallet.name).toBe("turnkey")
  })

  it("should create PrivateKeyAdapter when private key env vars are set", async () => {
    process.env.PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    process.env.RPC_URL = "http://localhost:8545"

    const { createWalletFromEnv } = await import("../lib/wallet/index.js")
    const wallet = createWalletFromEnv()
    expect(wallet.name).toBe("private-key")
  })

  it("should prefer Privy over other providers when multiple are configured", async () => {
    process.env.PRIVY_APP_ID = "test-app-id"
    process.env.PRIVY_APP_SECRET = "test-app-secret"
    process.env.PRIVY_WALLET_ID = "test-wallet-id"
    process.env.PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    process.env.RPC_URL = "http://localhost:8545"

    const { createWalletFromEnv } = await import("../lib/wallet/index.js")
    const wallet = createWalletFromEnv()
    expect(wallet.name).toBe("privy")
  })

  it("should use explicit provider via createWalletForProvider", async () => {
    process.env.PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    process.env.RPC_URL = "http://localhost:8545"

    const { createWalletForProvider } = await import("../lib/wallet/index.js")
    const wallet = createWalletForProvider("private-key")
    expect(wallet.name).toBe("private-key")
  })
})

describe("PrivateKeyAdapter", () => {
  it("should derive address from private key", async () => {
    const { PrivateKeyAdapter } = await import("@opensea/wallet-adapters")
    const adapter = new PrivateKeyAdapter({
      privateKey:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      rpcUrl: "http://localhost:8545",
    })
    const address = await adapter.getAddress()
    expect(address.toLowerCase()).toBe(
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    )
  })

  it("should throw if PRIVATE_KEY is missing in fromEnv", async () => {
    delete process.env.PRIVATE_KEY
    delete process.env.RPC_URL

    const { PrivateKeyAdapter } = await import("@opensea/wallet-adapters")
    expect(() => PrivateKeyAdapter.fromEnv()).toThrow(
      "PRIVATE_KEY environment variable is required",
    )
  })

  it("should throw if RPC_URL is missing in fromEnv", async () => {
    process.env.PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    delete process.env.RPC_URL

    const { PrivateKeyAdapter } = await import("@opensea/wallet-adapters")
    expect(() => PrivateKeyAdapter.fromEnv()).toThrow(
      "RPC_URL environment variable is required",
    )
  })
})

describe("PrivyAdapter", () => {
  it("should throw if PRIVY_APP_ID is missing in fromEnv", async () => {
    delete process.env.PRIVY_APP_ID
    const { PrivyAdapter } = await import("@opensea/wallet-adapters")
    expect(() => PrivyAdapter.fromEnv()).toThrow(
      "PRIVY_APP_ID environment variable is required",
    )
  })
})

describe("TurnkeyAdapter", () => {
  it("should throw if TURNKEY_RPC_URL is missing in fromEnv", async () => {
    process.env.TURNKEY_API_PUBLIC_KEY = "test"
    process.env.TURNKEY_API_PRIVATE_KEY = "test"
    process.env.TURNKEY_ORGANIZATION_ID = "test"
    process.env.TURNKEY_WALLET_ADDRESS = "0x1234"
    delete process.env.TURNKEY_RPC_URL

    const { TurnkeyAdapter } = await import("@opensea/wallet-adapters")
    expect(() => TurnkeyAdapter.fromEnv()).toThrow(
      "TURNKEY_RPC_URL environment variable is required",
    )
  })

  it("should return wallet address from getAddress", async () => {
    const { TurnkeyAdapter } = await import("@opensea/wallet-adapters")
    const adapter = new TurnkeyAdapter({
      apiPublicKey: "test",
      apiPrivateKey: "test",
      organizationId: "test",
      walletAddress: "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
      rpcUrl: "http://localhost:8545",
    })
    const address = await adapter.getAddress()
    expect(address).toBe("0xAbCdEf1234567890abcdef1234567890AbCdEf12")
  })
})
