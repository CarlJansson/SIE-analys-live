import type { SIEData, MonthlyData, Summary } from './types'

// CP437 → svenska tecken
const CP437: Record<number, string> = {
  0x84:'ä', 0x86:'å', 0x94:'ö', 0x8E:'Ä', 0x8F:'Å', 0x99:'Ö',
  0x81:'ü', 0x82:'é', 0x91:'æ', 0x92:'Æ',
}

export function decodeCP437(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const hasCP437 = Array.from(bytes).some(b => b in CP437)
  if (hasCP437) {
    return Array.from(bytes).map(b => CP437[b] ?? (b < 128 ? String.fromCharCode(b) : String.fromCharCode(b))).join('')
  }
  return new TextDecoder('iso-8859-1').decode(buffer)
}

function tokenize(line: string): string[] {
  const parts: string[] = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; cur += ch }
    else if (ch === ' ' && !inQ) { if (cur) parts.push(cur); cur = '' }
    else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

function clean(s: string) { return (s || '').replace(/^"|"$/g, '') }

export function parseSIE(content: string): SIEData {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  
  let companyName = 'Ditt företag', start = '', end = ''
  const monthly: Record<string, MonthlyData> = {}
  const accounts: SIEData['accounts'] = {}
  const ib: Record<string, number> = {}
  const ub: Record<string, number> = {}
  const res: Record<string, number> = {}
  let verDate = ''

  for (const line of lines) {
    const parts = tokenize(line)
    if (!parts.length) continue
    const tag = parts[0]

    if (tag === '#FNAMN') companyName = clean(parts[1])
    if (tag === '#RAR' && parts[1] === '0') { start = parts[2] || ''; end = parts[3] || '' }
    if (tag === '#KONTO' && parts[1]) {
      accounts[parts[1]] = { name: clean(parts[2] || ''), num: parts[1], total: 0 }
    }
    if (tag === '#IB' && parts[1] === '0' && parts[2]) {
      ib[parts[2]] = parseFloat((parts[3] || '0').replace(',', '.'))
    }
    if (tag === '#UB' && parts[1] === '0' && parts[2]) {
      ub[parts[2]] = parseFloat((parts[3] || '0').replace(',', '.'))
    }
    if (tag === '#RES' && parts[1] === '0' && parts[2]) {
      res[parts[2]] = parseFloat((parts[3] || '0').replace(',', '.'))
    }
    if (tag === '#VER') {
      for (let i = 2; i < parts.length; i++) {
        if (/^\d{8}$/.test(parts[i])) { verDate = parts[i]; break }
      }
    }
    if (tag === '#TRANS' && verDate) {
      const ym = verDate.substring(0, 6)
      const acc = parseInt(parts[1] || '0')
      
      // Hitta belopp — hoppa över { }
      let amtRaw = 0
      for (let i = 2; i < parts.length; i++) {
        const v = parts[i]
        if (v === '{' || v === '}' || v.startsWith('{') || v.endsWith('}')) continue
        const p = parseFloat(v.replace(',', '.'))
        if (!isNaN(p)) { amtRaw = p; break }
      }
      const amtAbs = Math.abs(amtRaw)

      if (!monthly[ym]) {
        monthly[ym] = {
          month: `${ym.substring(0,4)}-${ym.substring(4,6)}`,
          revenue: 0, expenses: 0, profit: 0,
          personnel: 0, material: 0, external: 0, other: 0, financial: 0,
          vat_out: 0, vat_in: 0, cash_in: 0, cash_out: 0,
        }
      }
      const m = monthly[ym]

      // KORREKT: intäkter är kredit (negativa i SIE) → negera för positivt värde
      if (acc >= 3000 && acc < 3800) {
        const rv = -amtRaw
        if (rv > 0) m.revenue += rv
      }
      // Kostnader: exkludera 8999 (årets resultat — är en summering, inte kostnad)
      if (acc >= 4000 && acc < 8999) m.expenses += amtAbs
      if (acc >= 7000 && acc < 8000) m.personnel += amtAbs
      if (acc >= 4000 && acc < 5000) m.material += amtAbs
      if (acc >= 5000 && acc < 6000) m.external += amtAbs
      if (acc >= 6000 && acc < 7000) m.other += amtAbs
      if (acc >= 8000 && acc < 8999) m.financial += amtAbs
      if (acc === 2610 || acc === 2611) m.vat_out += amtAbs
      if (acc === 2641) m.vat_in += amtAbs
      // Kassaflöde — alla bankkonton 1910-1990
      if (acc >= 1910 && acc <= 1990) {
        if (amtRaw > 0) m.cash_in += amtRaw
        else m.cash_out += Math.abs(amtRaw)
      }

      // Kontostatistik
      if (!accounts[String(acc)]) accounts[String(acc)] = { name: 'Okänt', num: String(acc), total: 0 }
      accounts[String(acc)].total = (accounts[String(acc)].total || 0) + amtAbs
    }
  }

  const months = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month))
  months.forEach(m => { m.profit = m.revenue - m.expenses })

  // Beräkna summary
  const s = months.reduce((acc, m) => ({
    totalRevenue: acc.totalRevenue + m.revenue,
    totalExpenses: acc.totalExpenses + m.expenses,
    personnel: acc.personnel + m.personnel,
    material: acc.material + m.material,
    external: acc.external + m.external,
    other: acc.other + m.other,
    financial: acc.financial + m.financial,
    vat_out: acc.vat_out + m.vat_out,
    vat_in: acc.vat_in + m.vat_in,
    cash_in: acc.cash_in + m.cash_in,
    cash_out: acc.cash_out + m.cash_out,
  }), { totalRevenue:0, totalExpenses:0, personnel:0, material:0, external:0, other:0, financial:0, vat_out:0, vat_in:0, cash_in:0, cash_out:0 })

  const profit = s.totalRevenue - s.totalExpenses

  // Kassa — alla bankkonton 1910-1990
  const cashUB = Object.entries(ub).filter(([k]) => { const n = parseInt(k); return n >= 1910 && n <= 1990 }).reduce((a, [,v]) => a + (v > 0 ? v : 0), 0)
  const cashIB = Object.entries(ib).filter(([k]) => { const n = parseInt(k); return n >= 1910 && n <= 1990 }).reduce((a, [,v]) => a + (v > 0 ? v : 0), 0)

  // Kundfordringar netto (efter nedskrivning 1519)
  const receivablesUB = (ub['1510'] || 0) + (ub['1519'] || 0)

  // Omsättningstillgångar (1300-1999, exkl anläggningstillgångar)
  const currentAssetsUB = Object.entries(ub).filter(([k, v]) => { const n = parseInt(k); return n >= 1300 && n <= 1999 && v > 0 }).reduce((a, [,v]) => a + v, 0)

  // Kortfristiga skulder
  const currentLiabUB = Object.entries(ub).filter(([k, v]) => k.startsWith('2') && v < 0).reduce((a, [,v]) => a + Math.abs(v), 0)

  // Moms — 2650 primärt
  const vatOut = Math.abs(ub['2650'] || 0) + Math.abs(ub['2610'] || 0) + Math.abs(ub['2611'] || 0)
  const vatIn  = (ub['2641'] || 0) + (ub['2645'] || 0) + Math.abs(ub['2651'] || 0)
  const vatNet = vatOut - vatIn

  const summary: Summary = {
    ...s, profit,
    operatingMargin: s.totalRevenue > 0 ? (profit / s.totalRevenue) * 100 : 0,
    personnelRatio:  s.totalRevenue > 0 ? (s.personnel / s.totalRevenue) * 100 : 0,
    cashUB, cashIB, cashChange: cashUB - cashIB,
    receivablesUB, currentAssetsUB, currentLiabUB,
    liquidity: currentLiabUB > 0 ? currentAssetsUB / currentLiabUB : 0,
    vatNet, vatOut, vatIn,
  }

  return { companyName, start, end, months, accounts, ib, ub, res, summary }
}
