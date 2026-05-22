'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Package, Tractor, FileText, Bell, LogOut, CircleDollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/estoque', label: 'Estoque', icon: Package },
  { href: '/operacoes', label: 'Operações', icon: Tractor },
  { href: '/nfe', label: 'NF-e', icon: FileText },
  { href: '/financeiro', label: 'Financeiro', icon: CircleDollarSign },
  { href: '/alertas', label: 'Alertas', icon: Bell },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <aside
      className="w-60 shrink-0 flex flex-col"
      style={{
        background: 'linear-gradient(180deg, #2A5010 0%, #1E3B0A 100%)',
        boxShadow: '2px 0 12px rgba(0,0,0,0.15)',
      }}
    >
      {/* Logo */}
      <div
        className="flex flex-col items-center gap-2 py-5 px-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="h-16 w-16 rounded-2xl overflow-hidden bg-white flex items-center justify-center shadow-md">
          <Image
            src="/logo.png"
            alt="AgroMouro"
            width={56}
            height={56}
            className="w-14 h-14 object-contain"
          />
        </div>
        <div className="text-center leading-tight">
          <p className="font-extrabold text-white text-lg tracking-tight">AGROMOURO</p>
          <p className="text-white/40 text-[11px] font-medium tracking-widest uppercase">Gestão Agrícola</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold transition-all duration-150',
                active
                  ? 'text-white'
                  : 'text-white/55 hover:text-white/85 hover:bg-white/6'
              )}
              style={active ? { backgroundColor: 'rgba(143,184,64,0.18)' } : undefined}
            >
              <Icon
                className={cn('h-[17px] w-[17px] shrink-0', active ? 'text-[#8FB840]' : 'text-white/40')}
              />
              <span>{label}</span>
              {active && (
                <span
                  className="ml-auto h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: '#8FB840' }}
                />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Sair */}
      <div
        className="px-3 py-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
      >
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-white/40 hover:text-white/70 hover:bg-white/6 transition-all duration-150"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sair
        </button>
      </div>
    </aside>
  )
}
