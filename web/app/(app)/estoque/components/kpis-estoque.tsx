import { AlertTriangle, PackageX, Boxes, Wallet } from 'lucide-react'
import { KpiCard } from '@/components/ui/kpi-card'
import type { Estoque } from '@/lib/types'
import { TIPOS } from '../constants'

export function KpisEstoque({ estoque }: { estoque: Estoque[] }) {
  const estoqueNegativo = estoque.filter(e => e.quantidade_atual < 0)
  const estoqueCritico  = estoque.filter(e => e.quantidade_atual >= 0 && e.quantidade_atual <= e.quantidade_minima_alerta)
  const valorInventario = estoque.reduce(
    (s, e) => s + Math.max(0, e.quantidade_atual) * (e.preco_medio_unitario ?? 0), 0,
  )

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        label="Valor em Estoque"
        value={valorInventario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
        sub="soma quantidade × preço médio"
        icon={<Wallet className="h-5 w-5" />}
        iconBg="#EFF6FF" iconColor="#2563EB"
      />
      <KpiCard
        label="Insumos Cadastrados"
        value={estoque.length}
        sub={`${TIPOS.length} tipos disponíveis`}
        icon={<Boxes className="h-5 w-5" />}
        iconBg="#EEF5E5" iconColor="#5B8C2A"
      />
      <KpiCard
        label="Críticos"
        value={estoqueCritico.length}
        sub={estoqueCritico.length === 0 ? 'tudo acima do mínimo' : 'abaixo do mínimo'}
        icon={<AlertTriangle className="h-5 w-5" />}
        iconBg={estoqueCritico.length > 0 ? '#FFFBEB' : '#EDFAF1'}
        iconColor={estoqueCritico.length > 0 ? '#D97706' : '#16A34A'}
        valueColor={estoqueCritico.length > 0 ? 'text-amber-600' : undefined}
      />
      <KpiCard
        label="Negativos"
        value={estoqueNegativo.length}
        sub={estoqueNegativo.length === 0 ? 'nenhum saldo negativo' : 'saldo abaixo de zero'}
        icon={<PackageX className="h-5 w-5" />}
        iconBg={estoqueNegativo.length > 0 ? '#FEF2F2' : '#EDFAF1'}
        iconColor={estoqueNegativo.length > 0 ? '#DC2626' : '#16A34A'}
        valueColor={estoqueNegativo.length > 0 ? 'text-red-600' : undefined}
      />
    </div>
  )
}
