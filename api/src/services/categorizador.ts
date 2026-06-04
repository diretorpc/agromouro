// Classificação automática de transações por estabelecimento.
// Prioridade: match exato > keyword rules > 'outros'

type Categoria =
  | 'alimentacao' | 'combustivel' | 'farmacia' | 'ferragens'
  | 'manutencao'  | 'mercado'     | 'outros'   | 'pedagio'
  | 'peca_maquina'| 'predial'     | 'servico'  | 'tejuco_gado'
  | 'veterinario'

// Mapa exato derivado das 200 transações já classificadas pelo usuário.
// Conflitos resolvidos pela categoria com maior frequência.
const MAPA_EXATO: Record<string, Categoria> = {
  // alimentacao
  'BAZAR DIONISIO 88 MIRA MIRACATU BR':         'alimentacao',
  "BOLETTI'S UBERABA BR":                       'alimentacao',
  'CAPPTA *RESTAURANTE E SANTA RITA DO BR':     'alimentacao',
  'CAXUXA II ALIMENTACAO UBERABA BR':           'alimentacao',
  'CHURRAS P BONITA UBERLANDIA BR':             'alimentacao',
  'CHURRASC. ITAMARATY ARAMINA BR':             'alimentacao',
  'CONVENIENCIA UBERLAND CRUZEIRO DOS BR':      'alimentacao',
  'DECIO UDIA UBERLANDIA BR':                   'alimentacao',
  'FRANGO ASSADO GUARA GUARA BR':               'alimentacao',
  'GIRLEI CARLOS CIGOLIN ARAXA BR':             'alimentacao',
  'JapaLanchesE UBERABA BR':                    'alimentacao',
  'L H KIYOTA LTDA MORRO AGUDO BR':             'alimentacao',
  'MCDONALDS UBERABA BR':                       'alimentacao',
  'MP*RESTAURANTE UBERABA BR':                  'alimentacao',
  'PADARIA E CONVENIENCIA UBERABA BR':          'alimentacao',
  'PADARIA E PIZZARIA ARAUUBERABA BR':          'alimentacao',
  'PAMONHARIA E RESTAURAN UBERLANDIA BR':       'alimentacao',
  'PANIF ARAUJO UBERABA UBERABA BR':            'alimentacao',
  'PANIFICADORA PAO DA CASUBERABA BR':          'alimentacao',
  'PEIXE PRIME UBERABA BR':                     'alimentacao',
  'POSTO DO PEPE UBERABA BR':                   'alimentacao',
  'RECANTO DAS LARANJEIRA UBERABA BR':          'alimentacao',
  'RECANTO DAS LARANJEIRASUBERABA BR':          'alimentacao',
  'REDE ARAUJO CHURRAS RIBEIRAO PRET BR':       'alimentacao',
  'RESTAURANTE 050 LTDA - UBERABA BR':          'alimentacao',
  'RESTAURANTE CAXUXA LTD UBERABA BR':          'alimentacao',
  'RESTAURANTE DO MEL GUATAPARA BR':            'alimentacao',
  'RESTAURANTE E LANCHONE MORRINHOS BR':        'alimentacao',
  'RESTAURANTE ROTA 365 MONTE ALEGRE BR':       'alimentacao',
  'RESTAURANTE ROTA SUL JUQUIA BR':             'alimentacao',
  'RODOSNACK CASTELO LANC LIMEIRA BR':          'alimentacao',
  'ROTA SUL JUQUIA BR':                         'alimentacao',
  'SACOLAO IDEAL UBERABA BR':                   'alimentacao',
  'SCALA UBERABA BR':                           'alimentacao',
  'SUCESSO 68 SAO PAULO BR':                    'alimentacao',
  'SUCESSO REDE DE RESTAU SAO PAULO BR':        'alimentacao',
  'TOCA DO LOBO UBERABA BR':                    'alimentacao',
  'XAPETUBA UBERLANDIA BR':                     'alimentacao',
  // combustivel — postos com lanchonete embutida ficam como combustivel (maioria das visitas)
  'AUTO POSTO DOS IPES UBERABA BR':             'combustivel',
  'AUTO POSTO O CAIPIRAO GOIATUBA BR':          'combustivel',
  'AUTO POSTO RIO PRETAO REGENTE FEIJO BR':     'combustivel',
  'AUTO POSTO VERA CRUZ L GOIANIA BR':          'combustivel',
  'AutoPostoEstancia UBERABA BR':               'combustivel',
  'AutoPostoEstoril UBERABA BR':                'combustivel',
  'CINQUENTAO COMERCIO UBERABA BR':             'combustivel',
  'DECIO UBERLANDIA UBERLANDIA BR':             'combustivel',
  'HIPOCAMPUS SAO JOSE DO R BR':                'combustivel',
  'POSTO ANHANGUERA SANTA ORLANDIA BR':         'combustivel',
  'POSTO ANTARES UBERABA BR':                   'combustivel',
  'POSTO CAXUXA MGM II UBERABA BR':             'combustivel',
  'POSTO DO JAPAO IGARAPAVA BRA':               'combustivel',
  'POSTO ITAMARATY ARAMINA BR':                 'combustivel',
  'POSTO LUNASA XXIII LTD UBERABA BR':          'combustivel',
  'POSTO MILANI UBERABA BR':                    'combustivel',
  'POSTO SAO DOM BOSCO LT UBERABA BR':          'combustivel',
  'POSTO XAPETUBA UBERLANDIA BR':               'combustivel',
  'REDE SAN MARINO UBERABA BR':                 'combustivel',
  'SEGOVIA UBERABA BR':                         'combustivel',
  'W-1 COMERCIO DE COMBU UBERABA BR':           'combustivel',
  // farmacia
  '4660 DROGASIL UBERABA BR':                   'farmacia',
  'DROGASIL2913 UBERABA BR':                    'farmacia',
  'DROGASIL3535 UBERABA BR':                    'farmacia',
  'FARMACIAS PA*791 UBERABA BR':                'farmacia',
  'PAGUE MENOS 06 8 GO@ BR':                    'farmacia',
  'PAGUE MENOS 07 1 MG@ BR':                    'farmacia',
  'UNIMED SAUDE UBERABA BR':                    'farmacia',
  // manutencao
  'AUTO ELETRICA BR PECA UBERABA BR':           'manutencao',
  'AutoTapecaria UBERABA BR':                   'manutencao',
  'BeijaFlorComercio UBERABA BR':               'manutencao',
  'BIGUAUTO PECAS UBERABA BR':                  'manutencao',
  'BORRACHARIA CALCARIO UBERABA BR':            'manutencao',
  'CasaDasBombas ITUIUTABA BR':                 'manutencao',
  'CENTRAL AUTO SERVICOS UBERABA BR':           'manutencao',
  'DIESELTUR SER PARC 01/04 UBERABA BR':        'manutencao',
  'DIESELTUR SER PARC 02/04 UBERABA BR':        'manutencao',
  'DIESELTUR SER PARC 03/04 UBERABA BR':        'manutencao',
  'DIESELTUR SER PARC 04/04 UBERABA BR':        'manutencao',
  'ELETRO FONTE UBERABA BR':                    'manutencao',
  'FERA DA BORRACHA UBERABA BR':                'manutencao',
  'FILTROPEL FILTROS PECA UBERABA BR':          'manutencao',
  'FORTES FERRAGISTA UBERABA BR':               'manutencao',
  'GIGANPAR PARAFUSOS E COUBERABA BR':          'manutencao',
  'GIGANPAR UBERABA BR':                        'manutencao',
  'HIDRAULICA UBERABA UBERABA BR':              'manutencao',
  'IMPERTEC PARC 01/02 UBERABA BR':             'manutencao',
  'IMPERTEC PARC 02/02 UBERABA BR':             'manutencao',
  'IMPERTEC UBERABA BR':                        'manutencao',
  'JABS AUTO PECAS UBERABA BR':                 'manutencao',
  'JIM.COM FIXXOPAR PARAFUUBERABA BR':          'manutencao',
  'JUAPOL UBERABA BR':                          'manutencao',
  'JUNITORK PARAFUSOS E F UBERABA BR':          'manutencao',
  'LEAL PECAS AGRICOLA UBERABA BR':             'manutencao',
  'MANZANO PARAFUSO E FER UBERABA BR':          'manutencao',
  'MAQAGRICOLA UBERABA BR':                     'manutencao',
  'MECATRIL TRATORES E I ITUIUTABA BR':         'manutencao',
  'MERCADOLIVRE*2PRODUTOS ATIBAIA BR':          'manutencao',
  'MINAS PECAS E ACESSORI UBERABA BR':          'manutencao',
  'MP*FORTESFERRAGI UBERABA BR':                'manutencao',
  'ND CELL UBERABA BR':                         'manutencao',
  'NG RADIADORES MORRO AGUDO BR':               'manutencao',
  'OSAKA UBERABA UBERABA BR':                   'manutencao',
  'PNEUS UBERABA UBERABA BR':                   'manutencao',
  'PneusUberaba PARC 01/03 UBERABA BR':         'manutencao',
  'PneusUberaba UBERABA BR':                    'manutencao',
  'POSTO DE MOLAS MARCELO UBERABA BR':          'manutencao',
  'POSTO DE MOLAS UBERABA BR':                  'manutencao',
  'PRODOESTE UBE PARC 01/02 UBERABA BR':        'manutencao',
  'PRODOESTE UBE PARC 01/03 UBERABA BR':        'manutencao',
  'PRODOESTE UBE PARC 02/03 UBERABA BR':        'manutencao',
  'PRODOESTE UBE PARC 03/03 UBERABA BR':        'manutencao',
  'PRODOESTE UBERABA UBERABA BR':               'manutencao',
  'PRODOESTE VEI PARC 01/06 UBERABA BR':        'manutencao',
  'PRODOESTE VEI PARC 02/06 UBERABA BR':        'manutencao',
  'REI DO OLEO UBERABA BR':                     'manutencao',
  'REI DOS PARAFUSOS UBERABA BR':               'manutencao',
  'REVOLUCAO MAQUINAS UBERLANDIA BR':           'manutencao',
  'RotaTelecom UBERABA BR':                     'manutencao',
  'SAN MARCO VEI PARC 01/02 UBERABA BR':        'manutencao',
  'SAN MARCO VEI PARC 02/02 UBERABA BR':        'manutencao',
  'SAN MARCO VEICULOS LT UBERABA BR':           'manutencao',
  'SOS BORRACHAS GOIANIA BR':                   'manutencao',
  'SOTRIL II UBERABA BR':                       'manutencao',
  'SUPERMOTOS LTDA UBERABA BR':                 'manutencao',
  'TIGUA FERRAG CONST ITUIUTABA BR':            'manutencao',
  'TOTAL METAL IND E COME UBERABA BR':          'manutencao',
  'TREVISAN E RO PARC 01/03 UBERABA BR':        'manutencao',
  'TREVISAN E RO PARC 02/03 UBERABA BR':        'manutencao',
  'TREVISAN E RO PARC 03/03 UBERABA BR':        'manutencao',
  'TREVISAN E ROTTA UBERABA BR':                'manutencao',
  'TRIANGULO MAQUINAS E UBERABA BR':            'manutencao',
  'TS DISTRIBUIDORA DE PE UBERABA BR':          'manutencao',
  'UBERABA MAQUINAS UBERABA BR':                'manutencao',
  'UBERCENTER SERVICOS UBERABA BR':             'manutencao',
  // mercado
  'BAHAMAS 0000 M NASGERAIS BR':                'mercado',
  'BUTIQUE DO BOI UBERABA BR':                  'mercado',
  'CASA DE CARNE MARAVIL ITUIUTABA BR':         'mercado',
  'EMPORIO DA CARNE UBERABA BR':                'mercado',
  'HORTIFRUTI MERCES LTDA UBERABA BR':          'mercado',
  'MATURADHA UBERABA BR':                       'mercado',
  'PRATICO.COM SUPERMERCA ITUIUTABA BR':        'mercado',
  'SUP LS GUARATO UBERABA BR':                  'mercado',
  // pedagio
  'CONCEBRA GOIANIA BR':                        'pedagio',
  'ECOVIAS DO CERRADO UBERLANDIA BR':           'pedagio',
  'EPR TRIANGULO UBERLANDIA BR':                'pedagio',
  'MONTE ALEGRE UBERLANDIA BR':                 'pedagio',
  'UBERABA UBERLANDIA BR':                      'pedagio',
  'ENTREVIAS CONCESSIONAR SERTAOZINHO BR':      'pedagio',
  // peca_maquina
  'MAQNELSON AGRICOLA UBERABA BR':              'peca_maquina',
  // predial
  'CENTER TINTAS UBERABA BR':                   'predial',
  'ELETROWATS UBERABA BR':                      'predial',
  'GREEN CENTER UBERABA BR':                    'predial',
  'MALU COLCHOES UBERABA BR':                   'predial',
  'MP*PLANALTOHORTF UBERABA BR':                'predial',
  'NEW TINTAS UBERABA BR':                      'predial',
  'ORTOSONO UBERABA BR':                        'predial',
  'PDV*TOMAZINI TINTAS UBERABA BR':             'predial',
  'PUXE E FECHE PUXADORES UBERABA BR':          'predial',
  'SHOPPING DAS PEDRAS UBERABA BR':             'predial',
  'ZAMPIERI ROCHA MATERIA UBERABA BR':          'predial',
  // servico
  'ADAIR GOMES UBERABA BR':                     'servico',
  'AutotacServicos UBERABA BR':                 'servico',
  'DL *Starlink Brazil Sao Paulo BR':           'servico',
  'DL*Starlink Braz Sao Paulo BR':              'servico',
  'EBN *Canva04764 37 CURITIBA BR':             'servico',
  'EBN *Canva04795 53 CURITIBA BR':             'servico',
  'EBN *Canva04823 53 CURITIBA BR':             'servico',
  'EBN *Canva04884 30 CURITIBA BR':             'servico',
  'EBN*CANVA0485 CURITIBA BR':                  'servico',
  'GM UBERABA UBERABA BR':                      'servico',
  'MP*SEABRAASSISTENCIATECUBERABA BR':          'servico',
  'SCRAPER API SCRAPERAPI.CO NV ; USD$49,00':   'servico',
  'STARLINK INTERNET Sao Paulo BR':             'servico',
  'TAVARES CAMINHOES LTDA UBERABA BR':          'servico',
  'VALDA FILOMENA FELICE UBERABA BR':           'servico',
  // tejuco_gado
  'AGROCAMPO UBERABA UBERABA BR':               'tejuco_gado',
  'ESTEIO RURAL ITUIUTABA BR':                  'tejuco_gado',
  'NUTRIPASTO ITUIUTABA BR':                    'tejuco_gado',
  // veterinario
  '84 PET CAMP COMERCIO D UBERABA BR':          'veterinario',
  'ALFA DOG PET MOVEL UBERABA BR':              'veterinario',
  'ANIMAIS E CIA PARC 01/06 UBERABA BR':        'veterinario',
  'ANIMAIS E CIA PARC 02/06 UBERABA BR':        'veterinario',
  'ANIMAIS E CIA PARC 03/06 UBERABA BR':        'veterinario',
  'ANIMAIS E CIA PARC 04/06 UBERABA BR':        'veterinario',
  'ANIMAIS E CIA PARC 05/06 UBERABA BR':        'veterinario',
  'ANIMAIS E CIA PARC 06/06 UBERABA BR':        'veterinario',
  'COBASI UBERABA UBERABA BR':                  'veterinario',
  'HOSPITAL VETE PARC 01/04 UBERABA BR':        'veterinario',
  'HOSPITAL VETE PARC 02/03 UBERABA BR':        'veterinario',
  'HOSPITAL VETE PARC 02/04 UBERABA BR':        'veterinario',
  'HOSPITAL VETE PARC 03/03 UBERABA BR':        'veterinario',
  'HOSPITAL VETE PARC 03/04 UBERABA BR':        'veterinario',
  'MORADA DO PET UBERABA BR':                   'veterinario',
  'NovaNutre UBERABA BR':                       'veterinario',
  'RENUTRE UBERABA BR':                         'veterinario',
  'RW PETSHOP UBERABA BR':                      'veterinario',
  'SPOCK C VETER PARC 03/03 UBERABA BR':        'veterinario',
}

// Regras de keyword aplicadas em ordem — a primeira que bater vence.
// Mais específico primeiro; genérico por último.
const REGRAS: Array<{ keywords: string[]; categoria: Categoria }> = [
  // Veterinário
  { keywords: ['NOVANUTRE', 'RENUTRE', 'NUTRIPET', 'HOSPITAL VETE', 'COBASI', 'PETSHOP', 'PET SHOP', 'PET CAMP', 'ALFA DOG', 'ANIMAIS E CIA', 'MORADA DO PET', 'SPOCK C VETER', 'CLINICA VETER', 'MEDICO VETER'], categoria: 'veterinario' },
  // Pedágio
  { keywords: ['CONCEBRA', 'ECOVIAS', 'EPR TRIANGULO', 'ENTREVIAS', 'AUTOPISTA', 'TRIUNFO CONCEPA', 'SEM PARAR', 'VELOE', 'CONCESSIONAR'], categoria: 'pedagio' },
  // Tejuco / Gado
  { keywords: ['AGROCAMPO', 'ESTEIO RURAL', 'NUTRIPASTO', 'AGROPECUARIA', 'AGRO PECUARIA', 'COOPERATIVA AGRO', 'LOJA AGRO', 'INSUMOS AGRO'], categoria: 'tejuco_gado' },
  // Peça de Máquina agrícola
  { keywords: ['MAQNELSON', 'PECAS AGRICOLA', 'MAQUINAS AGRI', 'JOHN DEERE', 'CNH INDUSTRIAL'], categoria: 'peca_maquina' },
  // Farmácia
  { keywords: ['DROGASIL', 'DROGARIA', 'FARMACIA', 'FARMACIAS', 'PAGUE MENOS', 'UNIMED SAUDE', 'ULTRAFARMA', 'PACHECO', 'PANVEL'], categoria: 'farmacia' },
  // Mercado
  { keywords: ['HORTIFRUTI', 'SUPERMERCADO', 'SUPERMERC', 'BAHAMAS', 'EMPORIO DA CARNE', 'BUTIQUE DO BOI', 'MATURADHA', 'PRATICO.COM', 'SUP LS GUARATO', 'SACOLAO', 'CASA DE CARNE', 'ACOUGUE', 'ATACADAO', 'ASSAI', 'EXTRA HIPER', 'CARREFOUR', 'WALMART', 'GRUPO PEG', 'GRUPO PAG'], categoria: 'mercado' },
  // Predial
  { keywords: ['TINTAS', 'ELETROWATS', 'COLCHOES', 'ORTOSONO', 'ZAMPIERI ROCHA', 'PUXE E FECHE', 'SHOPPING DAS PEDRAS', 'MATERIAL DE CONSTRU', 'FERRAGEM CONST', 'LEROY MERLIN', 'TELHAS'], categoria: 'predial' },
  // Serviço (digital/assinatura — antes de "serviço" genérico)
  { keywords: ['STARLINK', 'CANVA', 'SCRAPER API', 'ANTHROPIC', 'NETFLIX', 'SPOTIFY', 'AMAZON PRIME', 'GOOGLE STORAGE', 'APPLE.COM', 'MICROSOFT'], categoria: 'servico' },
  // Manutenção veicular/máquinas — mais específico que "POSTO"
  { keywords: ['BORRACHARIA', 'TAPECARIA', 'HIDRAULICA', 'PARAFUSO', 'PNEUS', 'MOLAS', 'RADIADOR', 'FILTROS', 'FILTROPEL', 'AUTO PECAS', 'AUTOPECAS', 'AUTO ELETRICA', 'MAQAGRICOLA', 'MECATRIL', 'PRODOESTE', 'DIESELTUR', 'IMPERTEC', 'TREVISAN', 'REI DO OLEO', 'TS DISTRIBUIDORA', 'TRIANGULO MAQUINAS', 'TOTAL METAL', 'MANZANO', 'BIGUAUTO', 'JABS AUTO', 'LEAL PECAS', 'GIGANPAR', 'JUNITORK', 'SOS BORRACHAS', 'NG RADIADORES', 'SOTRIL', 'UBERCENTER', 'SUPERMOTOS', 'FERA DA BORRACHA', 'POSTO DE MOLAS', 'SAN MARCO VEICULOS', 'REVOLUCAO MAQUINAS', 'MINAS PECAS'], categoria: 'manutencao' },
  // Combustível
  { keywords: ['AUTO POSTO', 'AUTOPOSTOS', 'POSTO CAXUXA', 'POSTO MILANI', 'POSTO ANHANGUERA', 'POSTO ANTARES', 'POSTO SAO DOM', 'POSTO LUNASA', 'POSTO ITAMARATY', 'POSTO DO JAPAO', 'POSTO XAPETUBA', 'W-1 COMERCIO DE COMBU', 'CINQUENTAO COMERCIO', 'HIPOCAMPUS', 'SEGOVIA', 'REDE SAN MARINO', 'DECIO UBERLANDIA'], categoria: 'combustivel' },
  // Alimentação
  { keywords: ['RESTAURANTE', 'CHURRASCO', 'CHURRASC', 'PADARIA', 'PANIFICADORA', 'MCDONALDS', 'LANCHONETE', 'LANCHE', 'FRANGO ASSADO', 'RODOSNACK', 'PEIXE PRIME', 'PAMONHARIA', 'ROTA SUL', 'RECANTO DAS', 'XAPETUBA', 'SCALA', 'TOCA DO LOBO', 'SUCESSO REDE', 'SACOLAO IDEAL', 'PIZZARIA', 'HAMBURGUER', 'BURGER', 'SUSHI', 'JAPONESA'], categoria: 'alimentacao' },
]

export function classificar(descricao: string): Categoria {
  // 1. Match exato
  const exato = MAPA_EXATO[descricao]
  if (exato) return exato

  const upper = descricao.toUpperCase()

  // 2. Keywords em ordem de prioridade
  for (const regra of REGRAS) {
    if (regra.keywords.some(k => upper.includes(k.toUpperCase()))) {
      return regra.categoria
    }
  }

  return 'outros'
}
