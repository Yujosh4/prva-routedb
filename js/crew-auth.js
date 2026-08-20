import { supabase } from "./supabase-client.js";
import { initThemeToggle } from "./theme.js";

initThemeToggle();

const PENDING_PROFILE_KEY = "prva-crew-pending-profile";

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginStatus = document.getElementById("loginStatus");
const signupStatus = document.getElementById("signupStatus");

document.querySelectorAll(".auth-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".auth-tabs button").forEach((b) => b.dataset.active = "false");
    btn.dataset.active = "true";
    document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
    document.getElementById(`${btn.dataset.tab}Form`).classList.add("active");
  });
});

if (!supabase) {
  loginStatus.textContent = "Supabase isn't connected yet.";
  loginStatus.className = "rn-sb-status error";
}

// Resolves the IFC username to an Infinite Flight userId via the
// resolve-if-user Edge Function (holds the INFINITE_FLIGHT_API_KEY
// server-side). Returns null if the username wasn't found -- signup
// still proceeds, just without PIREP verification working until the
// pilot fixes their username later.
async function resolveIfUserId(discourseUsername) {
  try {
    const { data, error } = await supabase.functions.invoke("resolve-if-user", {
      body: { discourseUsername },
    });
    if (error || !data?.found) return null;
    return data.infiniteFlightUserId;
  } catch (err) {
    console.error("[crew-auth] IF username resolution failed", err);
    return null;
  }
}

// Creates the pilots row for the now-authenticated user, if one doesn't
// already exist. Shared by both the signup flow (session available
// immediately) and the login flow (covers the case where Supabase
// requires email confirmation first -- signup couldn't create the row
// then, since there was no session yet to satisfy the RLS insert check,
// so it's finished here on first successful login instead).
async function ensurePilotProfile(userId, profile) {
  const { data: existing } = await supabase.from("pilots").select("id").eq("id", userId).maybeSingle();
  if (existing) return;
  if (!profile) return; // nothing pending and no row yet -- shouldn't normally happen, just don't crash

  const [infiniteFlightUserId, { data: startingRank }] = await Promise.all([
    resolveIfUserId(profile.discourseUsername),
    supabase.from("ranks").select("id").eq("sort_order", 0).single(),
  ]);
  await supabase.from("pilots").insert({
    id: userId,
    display_name: profile.displayName,
    discourse_username: profile.discourseUsername,
    infinite_flight_user_id: infiniteFlightUserId,
    rank_id: startingRank?.id,
  });
}

function readPendingProfile() {
  try {
    const raw = localStorage.getItem(PENDING_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearPendingProfile() {
  try {
    localStorage.removeItem(PENDING_PROFILE_KEY);
  } catch {
    // ignore
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!supabase) return;
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!email || !password) {
    loginStatus.textContent = "Enter both your email and password.";
    loginStatus.className = "rn-sb-status error";
    return;
  }
  loginStatus.textContent = "Logging in…";
  loginStatus.className = "rn-sb-status";
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      loginStatus.textContent = error.message;
      loginStatus.className = "rn-sb-status error";
      return;
    }
    await ensurePilotProfile(data.user.id, readPendingProfile());
    clearPendingProfile();
  } catch (err) {
    console.error("[crew-auth] login error", err);
    loginStatus.textContent = "Unexpected error: " + err.message;
    loginStatus.className = "rn-sb-status error";
    return;
  }
  window.location.href = "career.html";
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!supabase) return;
  const displayName = document.getElementById("signupName").value.trim();
  const discourseUsername = document.getElementById("signupIfc").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  if (!displayName || !discourseUsername || !email || !password) {
    signupStatus.textContent = "Fill in every field.";
    signupStatus.className = "rn-sb-status error";
    return;
  }
  signupStatus.textContent = "Creating your account…";
  signupStatus.className = "rn-sb-status";
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      signupStatus.textContent = error.message;
      signupStatus.className = "rn-sb-status error";
      return;
    }

    const profile = { displayName, discourseUsername };

    if (data.session) {
      // Confirmation not required (or already satisfied) -- session is
      // live immediately, finish the profile now.
      await ensurePilotProfile(data.user.id, profile);
      window.location.href = "career.html";
      return;
    }

    // Email confirmation required -- no session yet, so the pilots-row
    // insert would fail RLS if attempted now. Stash the profile details
    // for ensurePilotProfile() to pick up on first login instead.
    try {
      localStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // localStorage unavailable -- pilot will just need to be told to
      // re-enter these on first login if this ever actually happens.
    }
    signupStatus.textContent = "Check your email to confirm your account, then log in.";
    signupStatus.className = "rn-sb-status success";
  } catch (err) {
    console.error("[crew-auth] signup error", err);
    signupStatus.textContent = "Unexpected error: " + err.message;
    signupStatus.className = "rn-sb-status error";
  }
});
