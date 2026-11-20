import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client. ONLY for: the Meta webhook, the runner it calls, the dispatcher job, and sending a reply an
// agent's own session has just logged (actions/inbox.ts). Never imported by pages; never sent to the browser.
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
