import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  LogOut,
  Palette,
  TrendingUp,
  Trash2,
  User,
  type LucideIcon,
} from "lucide-react";
import { AccentPicker, ThemeSwitcher } from "../components/ThemeSwitcher.tsx";
import { useIsDesktop } from "../hooks/useIsDesktop.ts";
import { LoginForm } from "./LoginForm.tsx";
import { api, type ExchangeCredentialInput } from "../services/api.ts";
import { useAuthStore } from "../services/store.tsx";
import { toast } from "../services/toast.ts";
import { cn } from "../lib/utils.ts";
import { mobileIcon, mobilePage, mobileText, mobileTouch } from "../lib/mobile-ui.ts";
import { trimCredentialFields, validateOkxCredentials } from "../lib/okx-credentials.ts";
import { TradingModeSwitch } from "./trading/TradingModeSwitch.tsx";

// ── Settings — Account / Trading / Appearance. Global controls that used to
// sit in the mobile footer now live here; the top bar carries only a mode
// indicator and this entry point. A view-swap inside TradingPage (not a route).

type TabId = "account" | "trading" | "appearance";

const TABS: Array<{
  id: TabId;
  label: string;
  description: string;
  Icon: LucideIcon;
}> = [
  {
    id: "account",
    label: "Account",
    description: "Sign in and manage your identity",
    Icon: User,
  },
  {
    id: "trading",
    label: "Trading",
    description: "Trading mode and exchange connections",
    Icon: TrendingUp,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme and display preferences",
    Icon: Palette,
  },
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
    <div className="border-t border-border pt-4 pb-4 first:border-t-0 first:pt-0 max-md:pt-3 max-md:pb-3">
      <div className={cn("font-semibold text-foreground mb-0.5", mobileText.primary, "md:text-base md:font-semibold")}>
        {title}
      </div>
      {help && (
        <p className={cn("text-muted-foreground mb-3 max-md:mb-2", mobileText.meta, "md:text-sm")}>{help}</p>
      )}
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
    <div className="flex max-md:flex-col max-md:items-stretch max-md:gap-2 md:items-center justify-between gap-5 py-3 border-t border-border first:border-t-0">
      <div>
        <div className={cn("font-medium text-foreground", mobileText.ui, "md:text-sm")}>{label}</div>
        {sub && <div className={cn("text-muted-foreground mt-0.5", mobileText.meta)}>{sub}</div>}
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
        <div className="w-full max-md:max-w-none md:max-w-sm">
          <LoginForm />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Profile" help="Account information is managed here, not in the trading panel.">
      <SettingRow label="Email" sub="Used for sign-in and account notifications">
        <div className={cn(mobileText.ui, "text-foreground md:text-sm")}>{user?.email}</div>
      </SettingRow>
      <SettingRow label="Session" sub="End your session on this device">
        <button
          type="button"
          onClick={logout}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive",
            mobileText.ui,
            mobileTouch.target,
            "max-md:w-full max-md:justify-center",
          )}
        >
          <LogOut className={mobileIcon.ui} aria-hidden="true" />
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
      <p className={cn("text-muted-foreground", mobileText.meta, "md:text-sm")}>
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
    <div className={cn("w-full space-y-4 max-md:max-w-none md:max-w-sm")}>
      {credentials.length > 0 && (
        <ul className={cn("space-y-1", mobileText.ui)}>
          {credentials.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded bg-secondary/50 px-2 py-1.5">
              <span>
                {c.exchange.toUpperCase()} · {c.isDemo ? "demo" : "live"} · {c.label}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(c.id)}
                aria-label={`Remove ${c.label} credentials`}
                className={cn("text-muted-foreground hover:text-destructive", mobileTouch.target, "flex items-center justify-center")}
              >
                <Trash2 className={cn(mobileIcon.ui, "md:h-7 md:w-7")} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className={cn("space-y-2", mobileText.ui)}>
        <div className="flex rounded border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setIsDemo(true)}
            className={cn(
              "flex-1 uppercase",
              mobileTouch.target,
              isDemo ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            Demo
          </button>
          <button
            type="button"
            onClick={() => setIsDemo(false)}
            className={cn(
              "flex-1 uppercase",
              mobileTouch.target,
              !isDemo ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
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
          className={cn(
            "w-full rounded bg-primary font-medium text-primary-foreground disabled:opacity-50",
            mobileTouch.target,
          )}
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
        <div className={cn(mobileText.label, "uppercase text-muted-foreground")}>Accent Color</div>
        <AccentPicker />
      </div>
    </SectionCard>
  );
}

function SettingsTabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case "account":
      return <AccountTab />;
    case "trading":
      return <TradingTab />;
    case "appearance":
      return <AppearanceTab />;
  }
}

function MobileBackLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label === "Settings" ? "Back to Settings" : "Back to Trading"}
      className={cn(
        "inline-flex items-center gap-1 text-muted-foreground active:text-foreground",
        mobileText.ui,
        mobileTouch.target,
        "-ml-2 px-2",
      )}
    >
      <ArrowLeft className={mobileIcon.ui} aria-hidden="true" />
      {label}
    </button>
  );
}

function MobileSettingsHome({
  onSelect,
  onBackToTrading,
}: {
  onSelect: (tab: TabId) => void;
  onBackToTrading: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col bg-background text-foreground", mobilePage.paddingX)}>
      <div className={cn("shrink-0 safe-top", mobilePage.paddingY)}>
        <MobileBackLink label="Trading" onClick={onBackToTrading} />
        <h1 className={cn("mt-2", mobileText.label, "uppercase text-muted-foreground")}>Settings</h1>
      </div>

      <nav className={cn("min-h-0 flex-1 overflow-y-auto pb-3", mobilePage.sectionGap)} aria-label="Settings categories">
        {TABS.map(({ id, label, description, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={cn(
              "flex w-full items-center gap-3 border-b border-border py-3 text-left active:bg-secondary/60",
              mobileTouch.target,
            )}
          >
            <Icon className={cn(mobileIcon.ui, "text-muted-foreground")} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className={cn("block", mobileText.primary)}>{label}</span>
              <span className={cn("block truncate", mobileText.meta, "text-muted-foreground")}>{description}</span>
            </span>
            <ChevronRight className={cn(mobileIcon.ui, "text-muted-foreground")} aria-hidden="true" />
          </button>
        ))}
      </nav>

      {accessToken && (
        <div className={cn("shrink-0 border-t border-border py-3", mobileText.meta, "text-muted-foreground safe-area-bottom")}>
          <div className="truncate">{user?.email}</div>
          <span className="text-buy">● Authenticated</span>
        </div>
      )}
    </div>
  );
}

function MobileSettingsDetail({
  tab,
  onBack,
}: {
  tab: TabId;
  onBack: () => void;
}) {
  const [title, description] = TITLES[tab];

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col bg-background text-foreground", mobilePage.paddingX)}>
      <div className={cn("shrink-0 safe-top", mobilePage.paddingY)}>
        <MobileBackLink label="Settings" onClick={onBack} />
        <div className="mt-2">
          <h1 className={cn(mobileText.primary, "text-base font-semibold md:text-lg")}>{title}</h1>
          <p className={cn("mt-0.5", mobileText.meta, "text-muted-foreground md:text-sm")}>{description}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4 safe-area-bottom">
        <SettingsTabContent tab={tab} />
      </div>
    </div>
  );
}

function DesktopSettingsLayout({
  tab,
  onTabChange,
  onBack,
}: {
  tab: TabId;
  onTabChange: (tab: TabId) => void;
  onBack: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-card px-2.5 py-4">
        <div className="px-2 mb-2.5 text-label uppercase text-muted-foreground">Settings</div>
        <nav className="flex flex-col gap-0.5">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                tab === id
                  ? "bg-secondary text-foreground shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-7 w-7" aria-hidden="true" />
              {label}
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
            type="button"
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-7 w-7" />
            Back to Trading
          </button>
        </div>

        <div className="max-w-[760px]">
          <SettingsTabContent tab={tab} />
        </div>
      </section>
    </div>
  );
}

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const isDesktop = useIsDesktop();
  const [desktopTab, setDesktopTab] = useState<TabId>("account");
  const [mobileTab, setMobileTab] = useState<TabId | null>(null);

  if (!isDesktop) {
    if (mobileTab === null) {
      return <MobileSettingsHome onSelect={setMobileTab} onBackToTrading={onBack} />;
    }
    return <MobileSettingsDetail tab={mobileTab} onBack={() => setMobileTab(null)} />;
  }

  return (
    <DesktopSettingsLayout tab={desktopTab} onTabChange={setDesktopTab} onBack={onBack} />
  );
}
