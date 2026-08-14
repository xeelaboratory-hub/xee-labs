/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend, e.g. "http://localhost:3000". Optional — when
   * unset, requests go same-origin through the vite dev proxy (/api, /ws). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(element: HTMLElement, options: Record<string, string>): void;
  prompt(): void;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}
