import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { DEMO_TABLES, DEMO_AUTH_USER } from "./fixtures"
import { demoEvents } from "./events-fixtures"

type Row = Record<string, unknown>

// The generated fixtures.ts is byte-matched by sim:verify, so the events demo
// data lives in its own module and is merged in here.
const DEMO_TABLES_ALL: Record<string, Row[]> = { ...DEMO_TABLES, events: demoEvents }

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  const as = String(a ?? "")
  const bs = String(b ?? "")
  return as < bs ? -1 : as > bs ? 1 : 0
}

/**
 * Minimal stand-in for a Supabase query builder, backed by in-memory fixtures.
 * Supports the read/write shapes the app actually uses; fuzzy filters
 * (overlaps/contains/or/ilike) are treated as pass-through, which is fine for a
 * demo. Writes never persist — they resolve to a believable success shape.
 */
class DemoQuery implements PromiseLike<{ data: unknown; count: number | null; error: null }> {
  private predicates: ((r: Row) => boolean)[] = []
  private sortCol: string | null = null
  private sortAsc = true
  private limitN: number | null = null
  private headOnly = false
  private wantCount = false
  private writeMode: "read" | "insert" | "update" | "upsert" | "delete" = "read"
  private writeRows: Row[] = []

  constructor(private rows: Row[]) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.headOnly = true
    if (opts?.count) this.wantCount = true
    return this
  }

  insert(payload: Row | Row[]) {
    this.writeMode = "insert"
    this.writeRows = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
      id: p.id ?? `demo_${Math.random().toString(36).slice(2, 10)}`,
      ...p,
    }))
    return this
  }
  update(_payload: Row) {
    this.writeMode = "update"
    return this
  }
  upsert(_payload: Row | Row[], _opts?: unknown) {
    this.writeMode = "upsert"
    return this
  }
  delete() {
    this.writeMode = "delete"
    return this
  }

  eq(col: string, val: unknown) {
    this.predicates.push((r) => r[col] === val)
    return this
  }
  neq(col: string, val: unknown) {
    this.predicates.push((r) => r[col] !== val)
    return this
  }
  is(col: string, val: unknown) {
    this.predicates.push((r) => r[col] === val)
    return this
  }
  in(col: string, vals: unknown[]) {
    this.predicates.push((r) => vals.includes(r[col]))
    return this
  }
  gte(col: string, val: unknown) {
    this.predicates.push((r) => compare(r[col], val) >= 0)
    return this
  }
  lte(col: string, val: unknown) {
    this.predicates.push((r) => compare(r[col], val) <= 0)
    return this
  }
  not(_col: string, _op: string, _val: unknown) {
    return this
  }
  overlaps() {
    return this
  }
  contains() {
    return this
  }
  or() {
    return this
  }
  ilike() {
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.sortCol = col
    this.sortAsc = opts?.ascending ?? true
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  range() {
    return this
  }

  private resolveRows(): Row[] {
    let out = this.rows.filter((r) => this.predicates.every((p) => p(r)))
    if (this.sortCol) {
      const col = this.sortCol
      out = [...out].sort((a, b) => {
        const c = compare(a[col], b[col])
        return this.sortAsc ? c : -c
      })
    }
    if (this.limitN != null) out = out.slice(0, this.limitN)
    return out
  }

  private firstRow(): Row | null {
    if (this.writeMode === "insert") return this.writeRows[0] ?? null
    return this.resolveRows()[0] ?? null
  }

  maybeSingle() {
    return Promise.resolve({ data: this.firstRow(), error: null })
  }
  single() {
    return Promise.resolve({ data: this.firstRow(), error: null })
  }

  then<R1 = { data: unknown; count: number | null; error: null }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; count: number | null; error: null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    let result: { data: unknown; count: number | null; error: null }
    if (this.writeMode !== "read") {
      result = { data: this.writeMode === "insert" ? this.writeRows : null, count: null, error: null }
    } else if (this.headOnly) {
      const count = this.rows.filter((r) => this.predicates.every((p) => p(r))).length
      result = { data: null, count, error: null }
    } else {
      const rows = this.resolveRows()
      result = { data: rows, count: this.wantCount ? rows.length : null, error: null }
    }
    return Promise.resolve(result).then(onfulfilled, onrejected)
  }
}

function demoStorageBucket() {
  return {
    list: async () => ({ data: [], error: null }),
    getPublicUrl: (_name: string) => ({ data: { publicUrl: "" } }),
    remove: async () => ({ data: null, error: null }),
    upload: async () => ({ data: { path: "" }, error: null }),
  }
}

/**
 * Returns an object shaped like the Supabase client but served entirely from
 * in-memory fixtures. Cast to SupabaseClient at the boundary — every method the
 * app calls is implemented; anything unknown resolves to an empty result.
 */
export function createDemoClient(): SupabaseClient<Database> {
  const client = {
    from(table: string) {
      return new DemoQuery((DEMO_TABLES_ALL[table] ?? []).map((r) => ({ ...r })))
    },
    // RPCs used by rendered pages return believable demo values; everything
    // else resolves empty so demo mode never throws.
    async rpc(name: string) {
      if (name === "database_size") return { data: 12_582_912, error: null }
      return { data: null, error: null }
    },
    auth: {
      getUser: async () => ({ data: { user: DEMO_AUTH_USER }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOtp: async () => ({
        data: { user: null, session: null },
        error: { message: 'Demo mode is on. Type "demo" as the email to enter the demo.' },
      }),
      verifyOtp: async () => ({
        data: { user: null, session: null },
        error: { message: "Demo mode is on." },
      }),
      signOut: async () => ({ error: null }),
    },
    storage: { from: () => demoStorageBucket() },
  }
  return client as unknown as SupabaseClient<Database>
}
