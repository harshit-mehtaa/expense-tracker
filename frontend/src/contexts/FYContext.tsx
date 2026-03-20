import React, { createContext, useContext, useState } from 'react';
import { getCurrentFY, listFYOptions } from '@/lib/financialYear';

interface FYContextValue {
  selectedFY: string;
  setSelectedFY: (fy: string) => void;
  fyOptions: string[];
}

const FYContext = createContext<FYContextValue | null>(null);

export function FYProvider({ children }: { children: React.ReactNode }) {
  const [selectedFY, setSelectedFY] = useState<string>(getCurrentFY);
  const fyOptions = listFYOptions(5);

  return (
    <FYContext.Provider value={{ selectedFY, setSelectedFY, fyOptions }}>
      {children}
    </FYContext.Provider>
  );
}

export function useFY(): FYContextValue {
  const ctx = useContext(FYContext);
  if (!ctx) throw new Error('useFY must be used within FYProvider');
  return ctx;
}
