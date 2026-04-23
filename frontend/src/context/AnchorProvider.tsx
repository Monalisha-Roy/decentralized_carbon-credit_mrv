"use client";

import { createContext, useContext, useMemo, FC, ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "@/idl/solana_contract.json";

const PROGRAM_ID = new PublicKey("4XgM7JHxi24iXdAs2ykKrWtwZXM9X5rfxKd8dcUZk8Kr");

interface AnchorContextType {
  program: Program | null;
  provider: AnchorProvider | null;
}

const AnchorContext = createContext<AnchorContextType>({
  program: null,
  provider: null,
});

export const AnchorContextProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { connection } = useConnection();
  const wallet = useWallet();

  const { program, provider } = useMemo(() => {
    if (!wallet.publicKey) return { program: null, provider: null };

    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      skipPreflight: false,
    });

    // Program ID is extracted from IDL's address field
    const program = new Program(idl as Idl, provider);

    return { program, provider };
  }, [connection, wallet.publicKey]);

  return (
    <AnchorContext.Provider value={{ program, provider }}>
      {children}
    </AnchorContext.Provider>
  );
};

export const useAnchor = () => useContext(AnchorContext);