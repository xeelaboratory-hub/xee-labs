import { useState } from "react";
import { useAuthStore } from "../services/store.tsx";

export function LoginPage() {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-neutral-200">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-6"
      >
        <h1 className="text-center text-lg font-semibold">Xee.Labs</h1>

        <div className="flex rounded border border-neutral-800 text-sm">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 py-1.5 ${mode === "login" ? "bg-neutral-800" : "text-neutral-500"}`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`flex-1 py-1.5 ${mode === "register" ? "bg-neutral-800" : "text-neutral-500"}`}
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
              className="w-1/2 rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm"
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              required
              className="w-1/2 rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm"
            />
          </div>
        )}

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          minLength={mode === "register" ? 8 : 6}
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-neutral-100 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
