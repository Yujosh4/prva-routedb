// Dark/light mode toggle for the Route Network Database. The actual theme
// application on page load happens via a small inline <script> in each
// page's <head> (see any .html file) -- it has to run synchronously before
// first paint to avoid a flash of the wrong theme, which a module script
// (this file) can't guarantee. This file only wires up the toggle button
// once the page is interactive.
const STORAGE_KEY = "prva-routedb-theme";

function storedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function effectiveTheme() {
  return storedTheme() || (systemPrefersDark() ? "dark" : "light");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function initThemeToggle(buttonId = "themeToggle") {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  function refresh() {
    const theme = effectiveTheme();
    btn.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
    btn.setAttribute("aria-pressed", String(theme === "dark"));
  }

  btn.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private browsing, etc.) -- theme just
      // won't persist across reloads, still applies for this session.
    }
    applyTheme(next);
    refresh();
  });

  refresh();
}
