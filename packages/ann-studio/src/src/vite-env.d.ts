/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GMAIDEN_INSTALL_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
