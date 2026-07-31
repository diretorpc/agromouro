// Com que valor nasce a próxima ocorrência de uma conta recorrente.
// Sempre uma ESTIMATIVA — quem grava marca valor_estimado = true.
//
// Cuidado: usar ?? e não ||. Com ||, um valor pago de R$ 0,00 seria
// descartado como se fosse ausência de valor.
export function estimativaDaOcorrencia(
  ultimoValorPago: number | null,
  valorReferencia: number | null,
): number | null {
  return ultimoValorPago ?? valorReferencia ?? null
}
