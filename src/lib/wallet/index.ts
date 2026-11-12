export type {
  BankrConfig,
  EvmTransactionRequest,
  SignMessageRequest,
  SignTypedDataRequest,
  SvmTransactionRequest,
  SvmWalletAdapter,
  TransactionResult,
  WalletAdapter,
  WalletCapabilities,
  WalletProvider,
  WalletSelector,
} from "@opensea/wallet-adapters"
export {
  BankrAdapter,
  createWalletForProvider,
  createWalletFromEnv,
  FireblocksAdapter,
  PrivateKeyAdapter,
  PrivyAdapter,
  PrivySvmAdapter,
  TurnkeyAdapter,
  WALLET_PROVIDERS,
} from "@opensea/wallet-adapters"

import { requireEvmAdapter } from "@opensea/wallet-adapters"

export {
  isEvmAdapter,
  isSvmAdapter,
  requireEvmAdapter,
  WrongChainTypeError,
} from "@opensea/wallet-adapters"

import type { WalletAdapter } from "@opensea/wallet-adapters"
import { walletAdapterToViemClient } from "@opensea/wallet-adapters/viem"
import type { Account, Chain, Transport, WalletClient } from "viem"

export async function walletAdapterToClient(
  adapter: WalletAdapter,
  chain: Chain,
  rpcUrl?: string,
): Promise<WalletClient<Transport, Chain, Account>> {
  // viem is an EVM client, so a Solana adapter cannot back one.
  const evm = requireEvmAdapter(adapter, "a viem client")
  const client = await walletAdapterToViemClient(evm, chain, rpcUrl)
  return client as WalletClient<Transport, Chain, Account>
}
