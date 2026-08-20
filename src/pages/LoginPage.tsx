import { useState } from "react";
import { X } from "lucide-react";
import { useAuthStore } from "../services/store.tsx";

export function LoginPage({ onClose }: { onClose?: () => void }) {
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, firstName, lastName);
      }
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`${onClose ? "fixed inset-0 z-50" : "h-screen w-screen"} flex items-center justify-center bg-background text-foreground`}
    >
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close login"
            className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <h1 className="text-center text-lg font-semibold">Xee.Labs</h1>

        <div className="flex rounded border border-border text-sm">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 py-1.5 ${mode === "login" ? "bg-secondary" : "text-muted-foreground"}`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`flex-1 py-1.5 ${mode === "register" ? "bg-secondary" : "text-muted-foreground"}`}
          >
            Register
          </button>
        </div>

        {mode === "register" && (
          <div className="flex gap-2">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              required
              className="w-1/2 rounded border border-border bg-input px-2 py-1.5 text-sm"
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              required
              className="w-1/2 rounded border border-border bg-input px-2 py-1.5 text-sm"
            />
          </div>
        )}

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          minLength={mode === "register" ? 8 : 6}
          className="w-full rounded border border-border bg-input px-2 py-1.5 text-sm"
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-primary py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
