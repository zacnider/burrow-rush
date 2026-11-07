import { useCallback, useState } from "react";
import { sepolia } from "wagmi/chains";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain, type Connector } from "wagmi";

function errorMessage(error: unknown) {
  const value = error as { code?: number; name?: string; shortMessage?: string; message?: string } | null;
  const code = Number(value?.code);
  if (code === 4001 || value?.name === "UserRejectedRequestError") return "Wallet request was rejected.";
  if (code === -32002) return "A wallet request is already open. Check your wallet.";
  if (code === 4902) return "Sepolia is not added to this wallet yet. Add the Sepolia test network, then try again.";
  return value?.shortMessage || value?.message || "Wallet request failed.";
}

export function useWallet() {
  const { address, chainId } = useAccount();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { disconnectAsync, isPending: disconnecting } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (connector: Connector) => {
    setError(null);
    try { await connectAsync({ connector }); return true; }
    catch (reason) { setError(errorMessage(reason)); return false; }
  }, [connectAsync]);

  const disconnect = useCallback(async () => {
    setError(null);
    try { await disconnectAsync(); }
    catch (reason) { setError(errorMessage(reason)); }
  }, [disconnectAsync]);

  const switchToSepolia = useCallback(async () => {
    setError(null);
    try { await switchChainAsync({ chainId: sepolia.id }); }
    catch (reason) { setError(errorMessage(reason)); }
  }, [switchChainAsync]);

  const signMessage = useCallback(async (message: string) => signMessageAsync({ message }), [signMessageAsync]);

  return {
    address: address ?? null,
    chainId: chainId ? `0x${chainId.toString(16)}` : null,
    connectors,
    error,
    pending: connecting || disconnecting || switching,
    connect,
    disconnect,
    switchToSepolia,
    signMessage,
    clearError: () => setError(null),
  };
}
