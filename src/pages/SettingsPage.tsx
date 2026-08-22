import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogOut, Palette, TrendingUp, Trash2, User } from "lucide-react";
import { AccentPicker, ThemeSwitcher } from "../components/ThemeSwitcher.tsx";
import { LoginForm } from "./LoginForm.tsx";
import { api, type ExchangeCredentialInput } from "../services/api.ts";
import { useAuthStore } from "../services/store.tsx";
import { toast } from "../services/toast.ts";
import { cn } from "../lib/utils.ts";
import { trimCredentialFields, validateOkxCredentials } from "../lib/okx-credentials.ts";
import { TradingModeSwitch } from "./trading/TradingModeSwitch.tsx";

// ── Settings — Account / Trading / Appearance. Global controls that used to
// sit in the mobile footer now live here; the top bar carries only a mode
// indicator and this entry point. A view-swap inside TradingPage (not a route).

type TabId = "account" | "trading" | "appearance";

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "account", label: "Account", icon: <User className="h-7 w-7" /> },
  { id: "trading", label: "Trading", icon: <TrendingUp className="h-7 w-7" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="h-7 w-7" /> },
];

const TITLES: Record<TabId, [string, string]> = {
  account: ["Account", "Sign in and manage your identity."],
  trading: ["Trading", "Execution environment and exchange connections."],
  appearance: ["Appearance", "Visual preferences for Xee.Labs."],
};

function SectionCard({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border pt-4 pb-4 first:border-t-0 first:pt-0">
      <div className="font-semibold text-foreground mb-0.5">{title}</div>
      {help && <p className="text-muted-foreground mb-3">{help}</p>}
      {children}
    </div>
  );
}

function SettingRow({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 py-3 border-t border-border first:border-t-0">
      <div>
        <div className="font-medium text-foreground">{label}</div>
        {sub && <div className="text-meta text-muted-foreground mt-0.5">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const logout = useAuthStore((s) => s.logout);

  if (!accessToken) {
    return (
      <SectionCard title="Sign in" help="Log in to manage your account and exchange connections.">
        <div className="max-w-sm">
          <LoginForm />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Profile" help="Account information is managed here, not in the trading panel.">
      <SettingRow label="Email" sub="Used for sign-in and account notifications">
        <div className="text-sm text-foreground">{user?.email}</div>
      </SettingRow>
      <SettingRow label="Session" sub="End your session on this device">
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out
        </button>
      </SettingRow>
    </SectionCard>
  );
}

function ExchangeConnectionsSection() {
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
      <p className="text-sm text-muted-foreground">
        Log in on the Account tab to manage exchange connections.
      </p>
    );
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["credentials"] });

  const validation = validateOkxCredentials({ apiKey, apiSecret, passphrase });
  const raw: Record<string, string> = { apiKey, apiSecret, passphrase };
  const liveErrors = validation.errors.filter((issue) => !(issue.kind === "required" && raw[issue.field] === ""));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = trimCredentialFields({ apiKey, apiSecret, passphrase });
    if (validateOkxCredentials(trimmed).errors.length > 0) return;

    setSubmitting(true);
    const input: ExchangeCredentialInput = { exchange: "okx", isDemo, ...trimmed, label };
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
        {liveErrors.map((issue) => (
          <p key={issue.message} className="text-destructive">
            {issue.message}
          </p>
        ))}
        {validation.warnings.map((issue) => (
          <p key={issue.message} className="text-warning">
            {issue.message}
          </p>
        ))}
        {error && <p className="text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={submitting || validation.errors.length > 0}
          className="w-full rounded bg-primary py-1.5 font-medium text-primary-foreground disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save credentials"}
        </button>
      </form>
    </div>
  );
}

function TradingTab() {
  return (
    <>
      <SectionCard
        title="Trading mode"
        help="Demo uses paper trading credentials. Live routes orders to your real OKX account."
      >
        <TradingModeSwitch />
      </SectionCard>
      <SectionCard title="Exchange connections" help="OKX API keys for demo and live trading.">
        <ExchangeConnectionsSection />
      </SectionCard>
    </>
  );
}

function AppearanceTab() {
  return (
    <SectionCard title="Appearance" help="Keep visual preferences separate from execution controls.">
      <SettingRow label="Theme" sub="Switch between light and dark mode">
        <ThemeSwitcher />
      </SettingRow>
      <div className="space-y-1 pt-3 border-t border-border">
        <div className="text-label uppercase text-muted-foreground">Accent Color</div>
        <AccentPicker />
      </div>
    </SectionCard>
  );
}

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<TabId>("account");
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-card px-2.5 py-4">
        <div className="px-2 mb-2.5 text-label uppercase text-muted-foreground">Settings</div>
        <nav className="flex flex-col gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                tab === t.id
                  ? "bg-secondary text-foreground shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        {accessToken && (
          <div className="mt-4 truncate border-t border-border px-2 pt-3 text-meta text-muted-foreground">
            {user?.email}
            <br />
            <span className="text-buy">● Authenticated</span>
          </div>
        )}
      </aside>

      <section className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6 flex items-start justify-between gap-5">
          <div>
            <h1 className="text-lg font-semibold">{TITLES[tab][0]}</h1>
            <p className="text-muted-foreground">{TITLES[tab][1]}</p>
          </div>
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-7 w-7" />
            Back to Trading
          </button>
        </div>

        <div className="max-w-[760px]">
          {tab === "account" && <AccountTab />}
          {tab === "trading" && <TradingTab />}
          {tab === "appearance" && <AppearanceTab />}
        </div>
      </section>
    </div>
  );
}
