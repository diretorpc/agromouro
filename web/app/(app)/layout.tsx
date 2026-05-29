export const dynamic = 'force-dynamic'

import { AuthProvider } from '@/components/auth-provider'
import { AuthGuard } from '@/components/auth-guard'
import { Sidebar } from '@/components/sidebar'
import { MobileNav } from '@/components/mobile-nav'
import { FazendaProvider } from '@/context/fazenda-context'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGuard>
        <FazendaProvider>
          <div className="flex h-screen overflow-hidden">
            {/* Desktop sidebar — hidden on mobile */}
            <div className="hidden md:flex">
              <Sidebar />
            </div>

            {/* Main content column */}
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Mobile top bar with hamburger */}
              <MobileNav />

              <main className="flex-1 overflow-auto" style={{ backgroundColor: '#F4F6F1' }}>
                {children}
              </main>
            </div>
          </div>
        </FazendaProvider>
      </AuthGuard>
    </AuthProvider>
  )
}
