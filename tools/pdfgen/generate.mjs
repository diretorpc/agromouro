// Converte um markdown (com imagens relativas) em PDF.
// Uso: node generate.mjs <input.md> <output.pdf>
// Embute as imagens em base64 e imprime via Chromium headless do Playwright.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, resolve, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { marked } from 'marked'

const __dirname = dirname(fileURLToPath(import.meta.url))

const [, , inArg, outArg] = process.argv
if (!inArg || !outArg) {
  console.error('Uso: node generate.mjs <input.md> <output.pdf>')
  process.exit(1)
}

const inputPath = resolve(inArg)
const outputPath = resolve(outArg)
const baseDir = dirname(inputPath)

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' }

function localizarChrome() {
  const root = resolve(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (!existsSync(root)) throw new Error('Cache do Playwright não encontrado: ' + root)
  const candidatos = readdirSync(root).filter(d => d.startsWith('chromium-'))
  for (const c of candidatos) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      const p = resolve(root, c, sub)
      if (existsSync(p)) return p
    }
  }
  throw new Error('chrome.exe não encontrado no cache do Playwright')
}

// 1. Markdown -> HTML, embutindo imagens em base64
const md = readFileSync(inputPath, 'utf8')
let body = marked.parse(md)

body = body.replace(/<img([^>]*?)src="([^"]+)"([^>]*?)>/g, (m, pre, src, post) => {
  if (src.startsWith('data:') || src.startsWith('http')) return m
  const imgPath = resolve(baseDir, src)
  if (!existsSync(imgPath)) { console.warn('Imagem não encontrada:', src); return m }
  const b64 = readFileSync(imgPath).toString('base64')
  const mime = MIME[extname(imgPath).toLowerCase()] || 'application/octet-stream'
  return `<img${pre}src="data:${mime};base64,${b64}"${post}>`
})

const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a2417; line-height: 1.6; font-size: 16.5px; max-width: 100%; }
  h1 { font-size: 32px; color: #2A5010; border-bottom: 3px solid #8FB840; padding-bottom: 8px; margin: 0 0 16px; }
  h2 { font-size: 23px; color: #2A5010; margin: 28px 0 8px; page-break-after: avoid; }
  h3 { font-size: 18px; color: #3a5a1a; margin: 16px 0 6px; }
  p { margin: 6px 0; }
  a { color: #2A5010; text-decoration: none; }
  strong { color: #1a2417; }
  blockquote { border-left: 4px solid #8FB840; background: #f4f8ec; margin: 10px 0; padding: 8px 14px; color: #3a4a2a; border-radius: 0 6px 6px 0; }
  ul, ol { margin: 6px 0 6px 4px; padding-left: 20px; }
  li { margin: 3px 0; }
  code { background: #eef2e6; padding: 1px 5px; border-radius: 4px; font-size: 14px; font-family: "SF Mono", Consolas, monospace; }
  pre { background: #f4f8ec; padding: 12px; border-radius: 8px; overflow-x: auto; border: 1px solid #dde6cc; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; max-height: 155mm; width: auto; height: auto; border: 1px solid #dde6cc; border-radius: 8px; margin: 10px 0; display: block; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 15px; }
  th, td { border: 1px solid #cdd9bb; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #eef4e2; color: #2A5010; }
  tr:nth-child(even) td { background: #fafcf6; }
  hr { border: none; border-top: 1px solid #dde6cc; margin: 22px 0; }
  h2 + p img, h2 + img, h3 + p img { page-break-before: avoid; }
</style></head>
<body>${body}</body></html>`

const htmlPath = outputPath.replace(/\.pdf$/i, '.html')
writeFileSync(htmlPath, html, 'utf8')
console.log('HTML gerado:', htmlPath)

// 2. HTML -> PDF via Chromium headless
const chrome = localizarChrome()
execFileSync(chrome, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--no-pdf-header-footer',
  `--print-to-pdf=${outputPath}`,
  pathToFileURL(htmlPath).href,
], { stdio: 'inherit' })

console.log('PDF gerado:', outputPath)
