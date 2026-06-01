#!/usr/bin/env tsx
/**
 * Valida o roteamento do webhook NF-e para as 3 fazendas (mg / sp / mt).
 *
 * Uso:
 *   npx tsx tools/test-nfe-webhook.ts                      # testa todas as fazendas
 *   npx tsx tools/test-nfe-webhook.ts --fazenda=sp         # testa só Tejuco
 *   npx tsx tools/test-nfe-webhook.ts --url=http://localhost:3001
 *
 * Cada execução gera um número de NF-e único (TEST + timestamp) para evitar
 * que o dedup da API bloqueie re-execuções do script.
 */
import * as dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const BASE_URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
  ?? process.env.RAILWAY_URL
  ?? 'http://localhost:3001'

const SECRET = process.env.WEBHOOK_SECRET ?? ''

const FARMS = [
  { codigo: 'mg',  nome: 'Fazenda MG (existente)',   xmlFile: 'nfe_teste.xml'  },
  { codigo: 'sp',  nome: 'Fazenda Tejuco (novo)',     xmlFile: 'nfe_teste2.xml' },
  { codigo: 'mt',  nome: 'Fazenda MT (novo)',         xmlFile: 'nfe_teste3.xml' },
]

function uniqueXml(xml: string, suffix: string): string {
  // Troca o nNF por um número de teste único para evitar dedup entre execuções
  const unique = `TEST${suffix}`
  return xml.replace(/<nNF>[^<]+<\/nNF>/, `<nNF>${unique}<\/nNF>`)
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`)
    const body = await res.json() as Record<string, unknown>
    console.log(`  [health] ${res.status} —`, body)
    return res.ok
  } catch (err) {
    console.error(`  [health] Falha na conexão:`, (err as Error).message)
    return false
  }
}

async function testWebhook(codigo: string, nome: string, xmlFile: string, runId: string): Promise<boolean> {
  const xmlPath = path.resolve(__dirname, '..', xmlFile)

  if (!fs.existsSync(xmlPath)) {
    console.log(`  ❌ ${nome} (${codigo}) — XML não encontrado: ${xmlFile}`)
    return false
  }

  const rawXml = fs.readFileSync(xmlPath, 'utf-8')
  const xml    = uniqueXml(rawXml, `${codigo.toUpperCase()}${runId}`)
  const url    = `${BASE_URL}/webhook/nfe-email?fazenda=${codigo}`

  try {
    const res  = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'x-webhook-secret': SECRET,
      },
      body: xml,
    })
    const body = await res.text()

    if (res.ok) {
      console.log(`  ✅ ${nome} (${codigo}) — ${res.status} OK`)
      return true
    } else {
      console.log(`  ❌ ${nome} (${codigo}) — ${res.status}: ${body}`)
      return false
    }
  } catch (err) {
    console.log(`  ❌ ${nome} (${codigo}) — Erro de rede:`, (err as Error).message)
    return false
  }
}

async function main() {
  const targetCodigo = process.argv.find(a => a.startsWith('--fazenda='))?.split('=')[1]
  const runId        = Date.now().toString().slice(-6)

  console.log('\n═══════════════════════════════════════════════')
  console.log('  AgroMouro — Teste de Webhook NF-e Multi-Fazenda')
  console.log('═══════════════════════════════════════════════')
  console.log(`  URL   : ${BASE_URL}`)
  console.log(`  Secret: ${SECRET ? '✅ configurado' : '❌ AUSENTE — defina WEBHOOK_SECRET no .env'}`)
  console.log(`  Run ID: ${runId}`)
  console.log('───────────────────────────────────────────────\n')

  if (!SECRET) {
    console.error('Abortando: WEBHOOK_SECRET não encontrado no .env')
    process.exit(1)
  }

  console.log('[1/2] Health check...')
  const healthy = await checkHealth()
  if (!healthy) {
    console.error('\nAPI indisponível. Verifique se o servidor está rodando.')
    process.exit(1)
  }

  const farms = targetCodigo
    ? FARMS.filter(f => f.codigo === targetCodigo)
    : FARMS

  if (farms.length === 0) {
    console.error(`\nFazenda inválida: "${targetCodigo}". Use mg, sp ou mt.`)
    process.exit(1)
  }

  console.log('\n[2/2] Testando roteamento por fazenda...')
  const results = await Promise.all(
    farms.map(f => testWebhook(f.codigo, f.nome, f.xmlFile, runId))
  )

  const allOk = results.every(Boolean)
  console.log('\n═══════════════════════════════════════════════')
  console.log(`  Resultado: ${allOk ? '✅ TODOS OS CENÁRIOS OK' : '❌ FALHA EM ALGUM CENÁRIO'}`)
  console.log('═══════════════════════════════════════════════\n')

  if (!allOk) {
    console.log('Dados de teste inseridos usam nNF prefixado "TEST" — filtre ou delete pelo dashboard.\n')
  }

  process.exit(allOk ? 0 : 1)
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
