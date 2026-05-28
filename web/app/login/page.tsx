'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard')
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('E-mail ou senha inválidos.')
      setLoading(false)
    } else {
      router.replace('/dashboard')
    }
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ backgroundColor: '#F7F9F4' }}
    >
      {/* Painel lateral verde */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12"
        style={{ backgroundColor: '#1E3B0A' }}
      >
        <Image src="/logo.png" alt="AgroMouro" width={120} height={120} className="mb-8" />
        <h1 className="text-white text-4xl font-bold text-center leading-tight">AgroMouro</h1>
        <p className="text-white/60 text-lg mt-3 text-center max-w-xs">
          Plataforma digital de gestão agrícola
        </p>

        <div className="mt-12 space-y-4 w-full max-w-xs">
          {[
            { icon: '🌾', text: 'Registro de operações via WhatsApp' },
            { icon: '📦', text: 'Controle de estoque automático' },
            { icon: '📊', text: 'Dashboard completo da fazenda' },
          ].map(item => (
            <div key={item.text} className="flex items-center gap-3">
              <span className="text-xl">{item.icon}</span>
              <p className="text-white/70 text-sm">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Formulário */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-2 mb-8 lg:hidden">
            <Image src="/logo.png" alt="AgroMouro" width={64} height={64} />
            <h1 className="text-xl font-bold" style={{ color: '#1E3B0A' }}>AgroMouro</h1>
          </div>

          <h2 className="text-2xl font-bold text-foreground">Bem-vindo de volta</h2>
          <p className="text-muted-foreground text-sm mt-1 mb-8">Faça login para acessar o sistema</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="font-medium">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="font-medium">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="h-11"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full h-11 font-semibold" disabled={loading}>
              {loading ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
