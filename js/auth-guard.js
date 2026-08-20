import { supabase } from "./supabase-client.js";

// Redirects to the login page if there's no active session with the
// is_staff app_metadata flag (sql/013_pilot_staff_role_split.sql). Crew
// Center pilot accounts are also real authenticated sessions now, so
// "authenticated" alone no longer implies staff -- this checks the same
// flag the RLS policies (is_staff()) check server-side, so a pilot who
// finds a staff page's URL gets redirected instead of seeing a broken,
// partial view of data RLS is quietly filtering out from under them.
export async function requireStaffSession() {
  if (!supabase) {
    document.body.innerHTML = `<p style="padding:40px;font-family:sans-serif;">This page needs the Route DB's Supabase project connected first.</p>`;
    throw new Error("Supabase not configured");
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !session.user.app_metadata?.is_staff) {
    window.location.href = "auth.html";
    throw new Error("No staff session");
  }
  return session;
}
