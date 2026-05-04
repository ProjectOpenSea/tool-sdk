export type {
  BankrConfig,
  SignMessageRequest,
  SignTypedDataRequest,
  TransactionRequest,
  TransactionResult,
  WalletAdapter,
  WalletCapabilities,
  WalletProvider,
} from "@opensea/wallet-adapters"
export {
  BankrAdapter,
  createWalletForProvider,
  createWalletFromEnv,
  FireblocksAdapter,
  PrivateKeyAdapter,
  PrivyAdapter,
  TurnkeyAdapter,
  WALLET_PROVIDERS,
} from "@opensea/wallet-adapters"
import type { Account, Chain, Transport, WalletClient } from "viem"
import type { WalletAdapter } from "@opensea/wallet-adapters"
import { walletAdapterToViemClient } from "@opensea/wallet-adapters/viem"

export async function walletAdapterToClient(
  adapter: WalletAdapter,
  chain: Chain,
  rpcUrl?: string,
): Promise<WalletClient<Transport, Chain, Account>> {
  const client = await walletAdapterToViemClient(adapter, chain, rpcUrl)
  return client as WalletClient<Transport, Chain, Account>
}
