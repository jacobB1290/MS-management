import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

// One client for the whole tab. Building a fresh client per call (and we call
// this from the conversation list, the thread, and the contact panel) spins up
// several GoTrueClients and several realtime sockets that then fight over the
// auth-refresh Web Lock on tab refocus — that contention is the multi-second
// freeze when you come back to the tab. A module singleton means one auth
// instance and one socket, shared by every subscription.
let client: SupabaseClient<Database> | undefined

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  if (client) return client

  client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        // THE freeze-on-return fix. iOS suspends the JS runtime, sometimes
        // mid-token-refresh, which orphans the Web Lock (navigator.locks) that
        // guards auth. On resume the next refresh — and every getSession() and
        // authed query waiting behind it — blocks until the lock is stolen,
        // which by default takes a full 5s. That's the "frozen ~5–10s then it
        // comes back" stall. Stealing the orphaned lock sooner collapses the
        // freeze to a beat. Safe here: this is a single-window installed PWA,
        // and a genuinely in-flight refresh still runs to completion when stolen.
        lockAcquireTimeout: 1500,
      },
      realtime: {
        // The OS kills the websocket while backgrounded; a shorter heartbeat
        // detects the dead socket and rejoins faster on return (default 30s),
        // so live updates resume promptly instead of lagging after a resume.
        heartbeatIntervalMs: 15000,
      },
    },
  )

  // Realtime postgres_changes are filtered through each table's RLS using the
  // JWT carried on the websocket. messages/contacts are staff-only, so an
  // anonymous socket passes app.is_staff() = false and every change event is
  // dropped — the "inbox doesn't update until I refresh" bug. Push the signed
  // in user's token onto the socket and keep it fresh on every rotation so the
  // subscription stays authorized for the life of the session.
  const c = client
  void c.auth.getSession().then(({ data }) => {
    c.realtime.setAuth(data.session?.access_token)
  })
  c.auth.onAuthStateChange((_event, session) => {
    c.realtime.setAuth(session?.access_token)
  })

  return client
}
