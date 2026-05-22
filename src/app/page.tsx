import { redirect } from "next/navigation"

export default function RootPage() {
  // Middleware handles unauthenticated → /login. Signed-in users land here
  // briefly before redirecting to the operator inbox.
  redirect("/inbox")
}
