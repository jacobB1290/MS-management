import { requireStaff } from "@/server/auth"
import { Sidebar } from "@/components/shell/sidebar"
import { MobileNav } from "@/components/shell/mobile-nav"
import { Topbar } from "@/components/shell/topbar"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireStaff()

  return (
    <div className="flex min-h-dvh bg-bg">
      <Sidebar user={user} />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} />
        <main className="flex-1 pb-[72px] md:pb-0">{children}</main>
        <MobileNav role={user.role} />
      </div>
    </div>
  )
}
