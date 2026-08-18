import { supabase } from "./supabase-client.js";

// Redirects to the login page if there's no active staff session. Any
// authenticated user counts as staff -- accounts are created manually in
// the Supabase dashboard, there's no public signup, so "authenticated" and
// "staff" are the same set of people by construction (matches the RLS
// policies in sql/001_schema.sql).
export async function requireStaffSession() {
  if (!supabase) {
    document.body.innerHTML = `<p style="padding:40px;font-family:sans-serif;">This page needs the Route DB's Supabase project connected first.</p>`;
    throw new Error("Supabase not configured");
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "auth.html";
    throw new Error("No staff session");
  }
  return session;
}
