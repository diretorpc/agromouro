export const dynamic = 'force-dynamic'

import { AuthProvider } from '@/components/auth-provider'
import { AuthGuard } from '@/components/auth-guard'
import { Sidebar } from '@/components/sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGuard>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto" style={{ backgroundColor: '#F4F6F1' }}>
            {children}
          </main>
        </div>
      </AuthGuard>
    </AuthProvider>
  )
}
