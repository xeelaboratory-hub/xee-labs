import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogOut, Plug, Trash2, User } from "lucide-react";
import { AccentPicker } from "../components/ThemeSwitcher.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { api, type ExchangeCredentialInput } from "../services/api.ts";
import { useAuthStore, useTradingStore } from "../services/store.tsx";
import { toast } from "../services/toast.ts";
import { cn } from "../lib/utils.ts";

// ── Settings — Account / API connections, promoted out of the trading
// screen's always-visible chrome (see AccountPanel, which now only hosts
// the global DEMO/LIVE + connection + equity status strip). ──────────────

type TabId = "account" | "connections";

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "account", label: "Account", icon: <User className="h-7 w-7" /> },
  { id: "connections", label: "Exchange Connections", icon: <Plug className="h-7 w-7" /> },
];

function AppearanceSection() {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">Accent Color</div>
      <AccentPicker />
    </div>
  );
}

function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const logout = useAuthStore((s) => s.logout);
  const mode = useTradingStore((s) => s.mode);

  if (!accessToken) {
    return (
      <div className="max-w-sm space-y-6">
        <div>
          <h2 className="mb-1 text-sm font-semibold text-foreground">Account</h2>
          <p className="mb-4 text-xs text-muted-foreground">Log in to manage your account and exchange connections.</p>
          <LoginForm />
        </div>
        <AppearanceSection />
      </div>
    );
  }

  return (
    <div className="max-w-sm space-y-4">
      <h2 className="text-sm font-semibold text-foreground">Account</h2>
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground uppercase tracking-wider">Email</div>
        <div className="text-sm text-foreground">{user?.email}</div>
      </div>
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground uppercase tracking-wider">Currently trading in</div>
        <div className="text-sm text-foreground uppercase">{mode}</div>
        <p className="text-xs text-muted-foreground">Switch DEMO/LIVE from the status bar on the trading screen.</p>
      </div>
      <AppearanceSection />
      <button
        onClick={logout}
        className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <LogOut className="h-7 w-7" />
        Log out
      </button>
    </div>
  );
}

function ConnectionsTab() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const { data: credentials = [] } = useQuery({
    queryKey: ["credentials"],
    queryFn: () => api.listCredentials(),
    enabled: !!accessToken,
  });

  const [isDemo, setIsDemo] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [label, setLabel] = useState("default");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!accessToken) {
    return (
      <div className="max-w-sm">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Exchange Connections</h2>
        <p className="text-xs text-muted-foreground">Log in (Account tab) to manage exchange connections.</p>
      </div>
    );
  }

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
    <div className="max-w-sm space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Exchange Connections</h2>
        <p className="text-xs text-muted-foreground">OKX API keys for demo and live trading.</p>
      </div>

      {credentials.length > 0 && (
        <ul className="space-y-1 text-xs">
          {credentials.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1.5">
              <span>
                {c.exchange.toUpperCase()} · {c.isDemo ? "demo" : "live"} · {c.label}
              </span>
              <button onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-7 w-7" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="space-y-2 text-xs">
        <div className="flex rounded border border-border overflow-hidden">
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
          className="w-full rounded border border-border bg-background px-2 py-1.5"
        />
        <input
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          placeholder="API Secret"
          type="password"
          required
          className="w-full rounded border border-border bg-background px-2 py-1.5"
        />
        <input
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          type="password"
          required
          className="w-full rounded border border-border bg-background px-2 py-1.5"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
          className="w-full rounded border border-border bg-background px-2 py-1.5"
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
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>("account");

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-7 w-7" />
          Back to Trading
        </Link>
        <h1 className="text-sm font-semibold">Settings</h1>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-48 shrink-0 border-r border-border p-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors",
                tab === t.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {tab === "account" && <AccountTab />}
          {tab === "connections" && <ConnectionsTab />}
        </div>
      </div>
    </div>
  );
}
