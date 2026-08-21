import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Moon, Sun } from "lucide-react";
import { type ThemeAccent, useThemeStore } from "../services/themeStore.ts";
import { cn } from "../lib/utils.ts";

const ACCENTS: { id: ThemeAccent; label: string; swatch: string }[] = [
  { id: "teal", label: "Teal", swatch: "168 80% 48%" },
  { id: "blue", label: "Blue", swatch: "217 91% 60%" },
  { id: "violet", label: "Violet", swatch: "262 83% 66%" },
  { id: "amber", label: "Amber", swatch: "38 92% 55%" },
];

/** Dark/light toggle — always visible in the header. Accent color lives in
 * Settings (see AccentPicker below), since it's a less-frequent preference. */
export function ThemeSwitcher() {
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  return (
    <button
      onClick={toggleMode}
      title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="text-muted-foreground hover:text-foreground max-md:flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center"
    >
      {mode === "dark" ? <Moon className="h-7 w-7" /> : <Sun className="h-7 w-7" />}
    </button>
  );
}

/** Accent-color picker, used in Settings → Account. */
export function AccentPicker() {
  const accent = useThemeStore((s) => s.accent);
  const setAccent = useThemeStore((s) => s.setAccent);

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          title="Accent color"
          className="flex items-center justify-center outline-none"
        >
          <span
            className="h-3 w-3 rounded-full border border-border"
            style={{ background: `hsl(${ACCENTS.find((a) => a.id === accent)?.swatch})` }}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="end"
            sideOffset={6}
            className="z-50 min-w-[140px] rounded-md border border-border bg-card p-1 text-xs shadow-xl"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Accent
            </div>
            {ACCENTS.map((a) => (
              <DropdownMenu.Item
                key={a.id}
                onSelect={() => setAccent(a.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-foreground outline-none hover:bg-secondary focus:bg-secondary",
                )}
              >
                <span className="h-3 w-3 rounded-full border border-border" style={{ background: `hsl(${a.swatch})` }} />
                <span className="flex-1">{a.label}</span>
                {a.id === accent && <Check className="h-7 w-7 text-muted-foreground" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
