import { useCallback, useEffect, useState } from "react";

interface EthereumProvider {
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window { ethereum?: EthereumProvider }
}

const SEPOLIA_CHAIN_ID = "0xaa36a7";

function getProvider() {
  const injected = window.ethereum;
  if (!injected) return null;
  return injected.providers?.find((provider) => provider.isMetaMask) ?? injected.providers?.[0] ?? injected;
}

function getErrorMessage(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : 0;
  if (code === 4001) return "Wallet request was rejected.";
  if (code === -32002) return "A wallet request is already open. Check your wallet.";
  if (code === 4902) return "Sepolia is not added to this wallet yet. Add the Sepolia test network, then try again.";
  return error instanceof Error ? error.message : "Could not connect to the wallet.";
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;
    let active = true;
    const readAccounts = (value: unknown) => {
      const accounts = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      if (active) setAddress(accounts[0] ?? null);
    };
    const readChain = (value: unknown) => { if (active && typeof value === "string") setChainId(value.toLowerCase()); };
    const onAccountsChanged = (...args: unknown[]) => readAccounts(args[0]);
    const onChainChanged = (...args: unknown[]) => readChain(args[0]);
    const onDisconnect = () => { if (active) { setAddress(null); setChainId(null); } };

    void provider.request({ method: "eth_accounts" }).then(readAccounts).catch(() => undefined);
    void provider.request({ method: "eth_chainId" }).then(readChain).catch(() => undefined);
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    provider.on?.("disconnect", onDisconnect);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    setError(null);
    if (!provider) { setError("No Ethereum wallet found. Install or enable a wallet extension first."); return; }
    setPending(true);
    try {
      const result = await provider.request({ method: "eth_requestAccounts" });
      const accounts = Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : [];
      setAddress(accounts[0] ?? null);
      const network = await provider.request({ method: "eth_chainId" });
      if (typeof network === "string") setChainId(network.toLowerCase());
      if (!accounts[0]) setError("The wallet did not return an account.");
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setPending(false); }
  }, []);

  const switchToSepolia = useCallback(async () => {
    const provider = getProvider();
    setError(null);
    if (!provider) { setError("No Ethereum wallet found."); return; }
    setPending(true);
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
      setChainId(SEPOLIA_CHAIN_ID);
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setPending(false); }
  }, []);

  return { address, chainId, error, pending, connect, switchToSepolia, clearError: () => setError(null) };
}
