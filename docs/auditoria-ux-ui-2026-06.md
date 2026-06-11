# Auditoria UX/UI — AgroMouro (www.agromouro.com.br)

**Data:** 11/06/2026 · **Escopo:** 10 telas (login + 9 internas), desktop (1440px) e mobile (390px)
**Fonte real:** Plus Jakarta Sans (título e corpo) · **Paleta:** verde agrário sobre off-white

---

## 1. Veredito geral

O produto tem uma **base visual sólida e coerente** — sidebar verde consistente, layout em cards,
gráficos de barra horizontais limpos e legíveis, bons empty states. Não é "AI slop": a identidade
agrária está clara e a tipografia (Plus Jakarta Sans) já foge do genérico (Inter/Arial).

**Mas** está no nível "SaaS competente e seguro", com **3 bugs visuais reais**, **inconsistências
de dados/rotulagem** e uma **experiência mobile a meio caminho** — justamente onde o produtor (público
principal, que usa celular) mais sente. Com correções focadas, sobe de "funcional" para "polido e confiável".

**Nota por área (0–10):**

| Área | Nota | Comentário |
|------|:---:|-----------|
| Identidade visual / coerência | 8 | Paleta e layout consistentes; falta personalidade tipográfica |
| Data viz (gráficos) | 7 | Barras horizontais ótimas; 1 gráfico quebrado no dashboard |
| Consistência entre telas | 6 | Rotulagem de categorias diverge; 2 estilos de KPI card |
| Mobile | 5 | Nav colapsa ok, mas tabelas e card de clima quebram |
| Acessibilidade | 6 | Contraste de texto muted suspeito; falta verificar foco/semântica |
| Microinterações / polish | 6 | Estático; sem hover/skeleton marcantes |

---

## 2. Pontos fortes (manter)

- **Sistema de cards consistente** em Financeiro, Cartões e Custo por Talhão — mesmos gráficos de
  barra horizontal, mesma hierarquia. Profissional.
- **Empty state de Alertas** ("Nenhum alerta não lido" + ícone + texto de apoio) — exemplar.
- **Sidebar**: estado ativo (pílula verde-clara) claro; navegação previsível; colapsa em hamburger no mobile.
- **Card de cotações CEPEA** (recém-refeito): ícones, fontes e hierarquia bons — referência de qualidade pro resto.
- **Plus Jakarta Sans**: escolha de fonte com caráter, não genérica.

---

## 3. Problemas por severidade

### 🔴 Críticos / bugs (corrigir já)

**C1 — Gráfico "Operações por Tipo" quebrado (Dashboard).**
Renderiza como um **quadradão verde** ocupando toda a área do gráfico. Com só 1 categoria
("pulverizacao"), a barra preenche 100% do plot e parece um bloco sem sentido. Passa imagem de
"sistema quebrado" logo na home. → Tratar caso de categoria única (largura mínima/barra fina + rótulo)
ou trocar por outro formato quando houver poucos dados.

**C2 — Card de clima estoura no mobile (Dashboard).**
A temperatura grande ("25°") e a min/máx ("25°/18°") **cortam na borda direita** em 390px.
Overflow horizontal do conteúdo do card. → Reduzir tamanho da fonte da temperatura em breakpoint
mobile e garantir `min-w-0`/`flex-wrap`.

**C3 — Tabelas com scroll horizontal no mobile (Estoque, NF-e, Operações).**
A tabela mantém todas as colunas e força **scroll lateral interno** — Qtd, Preço, Situação e Ações
ficam **escondidos fora da tela**. O produtor no celular não vê os dados que mais importam nem os
botões de ação. → Em mobile, trocar tabela por **lista de cards** (1 item = 1 card com label/valor
empilhados) ou colunas priorizadas + "ver mais".

### 🟡 Consistência / UX (corrigir na sequência)

**U1 — Rotulagem de categorias inconsistente.**
Em **Financeiro**, categorias aparecem cruas do banco: `veterinario`, `pedagio`, `tejuco_gado`,
`farmacia`, `predial` (minúsculas/snake_case) — enquanto em **Cartões** as mesmas viram
`Veterinário`, `Manutenção` (normalizadas). Passa desleixo. → Normalizar exibição num único helper
(`Title Case` + acento + de-snake) usado em todas as telas.

**U2 — Card "Categorias com Gasto" (Financeiro) é um paredão de texto.**
Lista 19 categorias separadas por vírgula num bloco denso, baixo valor informativo. → Mostrar só a
contagem em destaque + as 3–4 maiores, ou remover (o gráfico abaixo já cobre).

**U3 — KPI cards no mobile empurram o conteúdo pra baixo.**
4 cards full-width empilhados (Estoque) = muito scroll antes da tabela/dados reais. → Grid 2 colunas
no mobile pros KPIs.

**U4 — Dois estilos de KPI card.**
Dashboard usa um tratamento; Operações/Cartões/Custos usam outro (chip de ícone colorido no canto,
label em caps). Pequeno, mas quebra a unidade. → Padronizar um componente `KpiCard` único.

**U5 — Dados [DEMO] visíveis em produção.**
Operações mostram "[DEMO] Pulverização de teste". Se o site é o de produção, limpar dados de teste
(ou marcar visualmente como ambiente de teste).

### 🟢 Polish / evolução (quando der)

**P1 — Hierarquia tipográfica.** Título e corpo usam a MESMA fonte (Plus Jakarta Sans). Falta
contraste de personalidade. → Parear um **display font** nos títulos (algo com cara editorial/agrária)
mantendo Jakarta no corpo. Eleva a marca sem perder legibilidade.

**P2 — Seta de tendência "sempre verde" nas cotações.** O `TrendingUp` aparece verde/pra cima em
todas, independente da variação real (não guardamos variação). → Guardar variação do dia e refletir
cor/direção reais — ou remover a seta pra não enganar.

**P3 — Contraste de acessibilidade.** Textos "muted" (cinza claro) sobre fundo off-white parecem
**abaixo de WCAG AA** (4.5:1) em subtítulos e descrições. → Escurecer um tom o muted-foreground e
auditar foco de teclado + semântica de tabela.

**P4 — Microinterações.** App é estático: sem skeleton de loading, hover sutil em linhas de tabela,
ou transição nos cards. → Adicionar skeletons nos carregamentos e hovers discretos (ganho de
percepção de qualidade alto, custo baixo).

**P5 — Densidade do card de clima.** Funciona, mas a previsão de 5 dias e a seção principal podem
ganhar ritmo visual (divisores, alinhamento das unidades).

---

## 4. Roadmap proposto (pra você aprovar)

**Fase 1 — Bugs (rápido, alto impacto):** C1, C2, C3
→ Tira a cara de "quebrado" e conserta o mobile do produtor.

**Fase 2 — Consistência:** U1, U2, U4, U5
→ Padroniza rotulagem e KPI cards; limpa demo.

**Fase 3 — Mobile/UX:** U3 + refinar tabelas→cards em todas as telas de lista.

**Fase 4 — Polish/Marca:** P1 (display font), P3 (acessibilidade), P4 (microinterações), P2.

---

## 5. Telas auditadas (referência)

Login · Dashboard · Talhões · Estoque · Operações · NF-e · Cartões · Financeiro · Custo por Talhão · Alertas
(desktop 1440 + mobile 390 nas principais).
