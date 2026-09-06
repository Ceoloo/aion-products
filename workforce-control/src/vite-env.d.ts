/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AION_RUNTIME_URL?: string;
  readonly VITE_AION_TENANT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
