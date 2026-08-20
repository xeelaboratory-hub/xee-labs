import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, Plug, Trash2, Volume2, VolumeX, X, Zap } from "lucide-react";
import { ThemeSwitcher } from "../../components/ThemeSwitcher.tsx";
import { api, type ExchangeCredentialInput } from "../../services/api.ts";
import { ApiError } from "../../services/api/request.ts";
import { useAuthStore, useTradingStore } from "../../services/store.tsx";
import { toast } from "../../services/toast.ts";
import { cn } from "../../lib/utils.ts";
import type { TradingMode } from "../../services/schemas.ts";
import { LoginPage } from "../LoginPage.tsx";

export interface AccountPanelProps {
  oneClick?: boolean;
  onToggleOneClick?: () => void;
  soundMuted?: boolean;
  onToggleMute?: () => void;
}

/**
 * Mode switcher (OKX demo-trading vs live-trading) + exchange-credential
 * management. Replaces the old PropSim multi-account concept — there's just
 * one OKX identity per mode, and this is where a user connects it. Also
 * hosts the app-wide one-click-trading and trade-sound-mute toggles, since
 * it's the one panel always visible regardless of which right-panel tab
 * is open.
 */
export function AccountPanel({ oneClick, onToggleOneClick, soundMuted, onToggleMute }: AccountPanelProps) {
  const mode = useTradingStore((s) => s.mode);
  const setMode = useTradingStore((s) => s.setMode);
  const loadPositions = useTradingStore((s) => s.loadPositions);
  const loadOrders = useTradingStore((s) => s.loadOrders);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: account, error: accountError } = useQuery({
    queryKey: ["account", mode, user?.id ?? "guest"],
    queryFn: () => api.getAccount(mode),
    enabled: !!accessToken,
    retry: false,
    refetchInterval: 15_000,
  });
  const noCredentials = accountError instanceof ApiError && accountError.status === 404;

  const switchMode = (next: TradingMode) => {
    if (next === mode) return;
    setMode(next);
    queryClient.invalidateQueries({ queryKey: ["account"] });
    if (accessToken) {
      loadPositions();
      loadOrders();
    }
  };

  return (
    <div className="border-b border-border bg-secondary/40 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded border border-border overflow-hidden">
          {(["demo", "live"] as const).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={cn(
                "px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                m === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onToggleMute}
            title={soundMuted ? "Unmute trade sounds" : "Mute trade sounds"}
            className="text-muted-foreground hover:text-foreground"
          >
            {soundMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onToggleOneClick}
            title="One-click trading: skip confirmation for market orders"
            className={oneClick ? "text-buy" : "text-muted-foreground hover:text-foreground"}
          >
            <Zap className="h-3.5 w-3.5" />
          </button>
          <ThemeSwitcher />
          {accessToken && <div className="h-3.5 w-px bg-border" />}

          {accessToken ? (
            <div className="flex items-center gap-2 min-w-0">
              {accountError ? (
                <span className="text-destructive text-xs" title={accountError.message}>
                  {noCredentials ? `No ${mode} credentials` : "Exchange error"}
                </span>
              ) : (
                <span className="font-mono text-[13px] truncate">
                  {account ? `$${account.equity.toFixed(2)}` : "…"}
                </span>
              )}
              <button
                onClick={() => setOpen(true)}
                title="Connect exchange"
                className="text-muted-foreground hover:text-foreground"
              >
                <Plug className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={logout}
                title="Log out"
                className="text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>

        {!accessToken && (
          <button
            onClick={() => setLoginOpen(true)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <LogIn className="h-3.5 w-3.5" />
            Log in
          </button>
        )}
      </div>
      {user && <div className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</div>}

      {open && <CredentialsDialog onClose={() => setOpen(false)} />}
      {loginOpen && <LoginPage onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

function CredentialsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: credentials = [] } = useQuery({
    queryKey: ["credentials"],
    queryFn: () => api.listCredentials(),
  });

  const [isDemo, setIsDemo] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [label, setLabel] = useState("default");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["credentials"] });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const input: ExchangeCredentialInput = { exchange: "okx", isDemo, apiKey, apiSecret, passphrase, label };
    try {
      await api.createCredential(input);
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      refresh();
      toast.success("Connected", `OKX ${isDemo ? "demo" : "live"} credentials saved`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCredential(id);
      refresh();
    } catch {
      toast.error("Delete Failed", "Could not remove credential");
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 text-xs">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Connect OKX</h3>
            <button onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>

          {credentials.length > 0 && (
            <ul className="mb-3 space-y-1">
              {credentials.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1">
                  <span>
                    {c.exchange.toUpperCase()} · {c.isDemo ? "demo" : "live"} · {c.label}
                  </span>
                  <button onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAdd} className="space-y-2">
            <div className="flex rounded border border-border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setIsDemo(true)}
                className={cn("flex-1 py-1 uppercase", isDemo ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                Demo
              </button>
              <button
                type="button"
                onClick={() => setIsDemo(false)}
                className={cn("flex-1 py-1 uppercase", !isDemo ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                Live
              </button>
            </div>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API Key"
              required
              className="w-full rounded border border-border bg-background px-2 py-1"
            />
            <input
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="API Secret"
              type="password"
              required
              className="w-full rounded border border-border bg-background px-2 py-1"
            />
            <input
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Passphrase"
              type="password"
              required
              className="w-full rounded border border-border bg-background px-2 py-1"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label"
              className="w-full rounded border border-border bg-background px-2 py-1"
            />
            {error && <p className="text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-primary py-1.5 font-medium text-primary-foreground disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save credentials"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
