export type Theme = "dark" | "light";

export const DEFAULT_THEME: Theme = "dark";
export const THEME_STORAGE_KEY = "lps-theme";

/** Matches `--bg` in globals.css; used for the mobile browser chrome colour. */
export const THEME_COLORS: Record<Theme, string> = {
  dark: "#0d0e11",
  light: "#f3f3f1",
};

export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : DEFAULT_THEME;
}

/**
 * Runs synchronously in <head> so the saved theme is on <html> before first paint.
 * Anything missing, invalid or unreadable (blocked storage) falls back to dark.
 */
export const THEME_INIT_SCRIPT = `(function(){var t="${DEFAULT_THEME}";try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");if(s==="light"||s==="dark")t=s}catch(e){}document.documentElement.setAttribute("data-theme",t)})()`;
