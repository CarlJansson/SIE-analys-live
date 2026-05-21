import type { SIEData, ForecastMonth, Warning, AppConfig, BranschNorms } from './types'

export const BRANSCH_NORMS: Record<string, BranschNorms> = {
  konsult:      { marginWarn: 8,  marginOk: 12, dsoWarn: 60,  dsoAlert: 90,  personalWarn: 65, avskrivningWarn: 10, label: 'Konsult / tjänster' },
  handel:       { marginWarn: 3,  marginOk: 6,  dsoWarn: 45,  dsoAlert: 60,  personalWarn: 25, avskrivningWarn: 5,  label: 'Handel' },
  fastighet:    { marginWarn: 15, marginOk: 25, dsoWarn: 90,  dsoAlert: 180, personalWarn: 20, avskrivningWarn: 60, label: 'Fastighet / bygg' },
  tillverkning: { marginWarn: 5,  marginOk: 10, dsoWarn: 60,  dsoAlert: 90,  personalWarn: 40, avskrivningWarn: 15, label: 'Tillverkning' },
  restaurang:   { marginWarn: 4,  marginOk: 8,  dsoWarn: 30,  dsoAlert: 45,  personalWarn: 50, avskrivningWarn: 5,  label: 'Restaurang' },
  it:           { marginWarn: 10, marginOk: 15, dsoWarn: 45,  dsoAlert: 75,  personalWarn: 55, avskrivningWarn: 8,  label: 'IT / tech' },
  halsa:        { marginWarn: 5,  marginOk: 10, dsoWarn: 60,  dsoAlert: 90,  personalWarn: 60, avskrivningWarn: 8,  label: 'Hälsa / vård' },
  ovrigt:       { marginWarn: 5,  marginOk: 10, dsoWarn: 60,  dsoAlert: 90,  personalWarn: 40, avskrivningWarn: 15, label: 'Övrig bransch' },
}

export function calcWarnings(data: SIEData, config: AppConfig): Warning[] {
  const { summary: s, months } = data
  const norms = config.branschNorms ?? BRANSCH_NORMS['ovrigt']
  const isHolding = config.koncern === 'moder'
  const isExpert  = config.roll === 'revisor' || config.roll === 'redovisning'
  const warnings: Warning[] = []

  // DSO
  const dso = s.totalRevenue > 0 ? (s.receivablesUB / s.totalRevenue) * 365 : 0
  if (isHolding && dso > 200) {
    warnings.push({ level: 'info', icon: '✦', title: 'Koncerninterna fordringar', desc: `DSO ${Math.round(dso)} dagar är förväntat för moderbolag/holding. Kundfordringar inkluderar troligen koncerninterna mellanhavanden.` })
  } else if (!isHolding && dso > norms.dsoAlert) {
    warnings.push({ level: 'red', icon: '⚠', title: `Kritisk betalningstid — ${Math.round(dso)} dagar`, desc: `Normalt för ${norms.label}: ${norms.dsoWarn}–${norms.dsoAlert} dagar. Granska om fakturor är gamla eller om pågående arbeten inte fakturerats.` })
  } else if (!isHolding && dso > norms.dsoWarn) {
    warnings.push({ level: 'amber', icon: '→', title: `Betalningstid ${Math.round(dso)} dagar`, desc: `Kundfordringar relativt omsättning är något hög för ${norms.label}. Normalt: ${norms.dsoWarn} dagar.` })
  }

  // Marginal
  if (s.operatingMargin < norms.marginWarn && s.totalRevenue > 0) {
    warnings.push({ level: 'red', icon: '⚠', title: `Låg marginal — ${s.operatingMargin.toFixed(1)}%`, desc: `Normalt för ${norms.label}: >${norms.marginOk}%. Analysera kostnadsdrivare och prissättning.` })
  }

  // Avskrivningar
  const deprRatio = s.totalRevenue > 0 ? (s.financial / s.totalRevenue) * 100 : 0
  if (deprRatio > norms.avskrivningWarn) {
    const msg = config.bransch === 'fastighet'
      ? `Höga avskrivningar är normalt för fastighetsrörelse. Kontrollera att K2-schablonerna tillämpas korrekt.`
      : `Avskrivningar ${deprRatio.toFixed(1)}% av omsättning är högt för ${norms.label}. Granska avskrivningsplanen.`
    warnings.push({ level: deprRatio > norms.avskrivningWarn * 2 ? 'red' : 'amber', icon: '→', title: `Avskrivningar ${deprRatio.toFixed(1)}%`, desc: msg })
  }

  // Personal
  if (s.personnelRatio > norms.personalWarn && s.personnelRatio > 0) {
    warnings.push({ level: 'amber', icon: '→', title: `Personalkostnader ${s.personnelRatio.toFixed(1)}%`, desc: `Normalt för ${norms.label}: <${norms.personalWarn}%.` })
  }

  // Negativt kassaflöde trots positivt resultat
  if (s.profit > 0 && s.cashChange < 0) {
    warnings.push({ level: 'amber', icon: '→', title: 'Resultat positivt men kassa sjunker', desc: `Rörelseresultatet är positivt men kassan minskade. Rörelsekapitalbindning ökar.` })
  }

  // Moms expert
  if (isExpert) {
    const avgMoms = months.reduce((a, m) => a + m.vat_out, 0) / Math.max(months.length, 1)
    const avvik = months.filter(m => avgMoms > 0 && Math.abs(m.vat_out - avgMoms) / avgMoms > 0.3)
    if (avvik.length > 0) {
      warnings.push({ level: 'info', icon: '✦', title: `Momsavvikelse i ${avvik.length} månader`, desc: `Moms avviker >30% från snittet i ${avvik.map(m => m.month).join(', ')}.` })
    }
  }

  return warnings
}

export function generateForecast(data: SIEData): ForecastMonth[] {
  const { months } = data
  if (months.length < 2) return []
  const recent  = months.slice(-6)
  const avgRev  = recent.reduce((s, m) => s + m.revenue, 0)  / recent.length
  const avgCost = recent.reduce((s, m) => s + m.expenses, 0) / recent.length
  const last    = months[months.length - 1]
  let accLiq    = last.profit

  return [1, 2, 3].map(i => {
    const [y, mo] = last.month.split('-').map(Number)
    const d = new Date(y, mo - 1 + i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const projRev  = Math.round(avgRev  * (0.88 + Math.random() * 0.24))
    const projCost = Math.round(avgCost * 1.02)
    const net = projRev - projCost
    accLiq += net
    return { month, projRev, projCost, net, acc: Math.round(accLiq), risk: net < 0 || accLiq < 50000 ? 'high' : net < 50000 ? 'medium' : 'low' } as ForecastMonth
  })
}
