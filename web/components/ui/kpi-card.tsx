import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'

export interface KpiCardProps {
  href?: string
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  valueColor?: string
}

export function KpiCard({ href, label, value, sub, icon, iconBg, iconColor, valueColor }: KpiCardProps) {
  const content = (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow h-full">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className={`text-2xl font-extrabold mt-2 leading-none tracking-tight tabular-nums ${valueColor ?? 'text-foreground'}`}>
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-1.5 font-medium">{sub}</p>}
          </div>
          <div
            className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: iconBg }}
          >
            <span style={{ color: iconColor }}>{icon}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block">{content}</Link> : content
}
