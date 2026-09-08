import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { RuntimeApi } from '@/lib/runtime-api';

interface TenantContextValue {
  tenantId: string;
  setTenantId: (id: string) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

const PRESETS = ['aion-systems', 'aion-media'] as const;

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantId] = useState(RuntimeApi.defaultTenant);
  const value = useMemo(() => ({ tenantId, setTenantId }), [tenantId]);
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant requires TenantProvider');
  return ctx;
}

export { PRESETS };
