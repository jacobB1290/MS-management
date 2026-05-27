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
