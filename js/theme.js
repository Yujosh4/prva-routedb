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

// Thin-stroke line icons (matches the site's own restrained visual
// language) instead of an emoji glyph, whose look varies wildly by OS/
// browser and reads as an off-the-shelf phone keyboard symbol rather than
// something the site actually designed. currentColor means these pick up
// the button's existing hover/theme color for free.
const SUN_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"></circle><path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"></path></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 14.6A8.6 8.6 0 1 1 9.4 3.8a7 7 0 0 0 10.8 10.8Z"></path></svg>`;

export function initThemeToggle(buttonId = "themeToggle") {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  function refresh() {
    const theme = effectiveTheme();
    // Icon shown is the theme you'd SWITCH TO, matching how the old
    // text label worked ("Dark" shown while in light mode, etc.).
    btn.innerHTML = theme === "dark" ? SUN_ICON : MOON_ICON;
    btn.setAttribute("aria-pressed", String(theme === "dark"));
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    btn.title = btn.getAttribute("aria-label");
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
