'use client'
import { useCallback, useState } from 'react'

interface MonthlyData { month: string; revenue: number; expenses: number; profit: number; personnel: number }
interface Summary { totalRevenue: number; totalExpenses: number; profit: number; operatingMargin: number; personnel: number; personnelRatio: number }

function parseSIE(content: string) {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  let companyName = 'Ditt företag', start = '', end = ''
  const monthly: Record<string, MonthlyData> = {}
  let currentVerDate = ''

  for (const line of lines) {
    const parts: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; cur += ch }
      else if (ch === ' ' && !inQ) { if (cur) parts.push(cur); cur = '' }
      else cur += ch
    }
    if (cur) parts.push(cur)
    const clean = (s: string) => (s || '').replace(/^"|"$/g, '')
    const tag = parts[0]
    if (tag === '#FNAMN') companyName = clean(parts[1])
    if (tag === '#RAR' && parts[1] === '0') { start = parts[2] || ''; end = parts[3] || '' }
    if (tag === '#VER') currentVerDate = parts[3] || ''
    if (tag === '#TRANS' && currentVerDate) {
      const ym = currentVerDate.substring(0, 6)
      const acc = parseInt(parts[1] || '0')
      const amt = parseFloat((parts[3] || '0').replace(',', '.')) || 0
      if (!monthly[ym]) monthly[ym] = { month: `${ym.substring(0,4)}-${ym.substring(4,6)}`, revenue:0, expenses:0, profit:0, personnel:0 }
      const m = monthly[ym]
      if (acc >= 3000 && acc < 4000) m.revenue += Math.abs(amt)
      if (acc >= 4000 && acc < 9000) m.expenses += Math.abs(amt)
      if (acc >= 7000 && acc < 8000) m.personnel += Math.abs(amt)
    }
  }
  const months = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month))
  months.forEach(m => m.profit = m.revenue - m.expenses)
  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0)
  const totalExpenses = months.reduce((s, m) => s + m.expenses, 0)
  const personnel = months.reduce((s, m) => s + m.personnel, 0)
  const profit = totalRevenue - totalExpenses
  return { companyName, start, end, months, summary: { totalRevenue, totalExpenses, profit, operatingMargin: totalRevenue > 0 ? (profit/totalRevenue)*100 : 0, personnel, personnelRatio: totalRevenue > 0 ? (personnel/totalRevenue)*100 : 0 } }
}

const fmt = (n: number) => new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n) + ' kr'
const card = { background:'#141416', border:'1px solid #2a2a2f', borderRadius:12 } as const

export default function Dashboard() {
  const [data, setData] = useState<{ companyName: string; start: string; end: string; months: MonthlyData[]; summary: Summary } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true); setError('')
    const reader = new FileReader()
    reader.onload = ev => {
      try { setData(parseSIE(ev.target?.result as string)) }
      catch { setError('Kunde inte läsa filen. Kontrollera att det är en SIE4-fil.') }
      setLoading(false)
    }
    reader.readAsText(file, 'latin1')
  }, [])

  const maxRev = data ? Math.max(...data.months.map(m => m.revenue), 1) : 1

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'#0d0d0f' }}>
      <aside style={{ width:220, background:'#141416', borderRight:'1px solid #2a2a2f', display:'flex', flexDirection:'column', flexShrink:0 }}>
        <div style={{ padding:18, borderBottom:'1px solid #2a2a2f', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, background:'#5b8def', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:'#fff' }}>Ā</div>
          <div style={{ fontWeight:600, fontSize:14 }}>SIE Analys</div>
        </div>
        <nav style={{ padding:'10px 8px', flex:1 }}>
          <div style={{ padding:'8px 10px', borderRadius:7, fontSize:13, color:'#5b8def', background:'rgba(91,141,239,.1)' }}>◈ Dashboard</div>
        </nav>
        <div style={{ padding:12, borderTop:'1px solid #2a2a2f' }}>
          <label style={{ display:'block', width:'100%', padding:9, background:'#5b8def', borderRadius:7, color:'#fff', fontSize:13, fontWeight:500, cursor:'pointer', textAlign:'center' }}>
            ↑ Ladda upp SIE
            <input type="file" accept=".si,.se,.SIE,.sie" onChange={handleFile} style={{ display:'none' }} />
          </label>
        </div>
      </aside>

      <main style={{ flex:1, padding:24, overflowY:'auto' }}>
        {!data && !loading && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'70vh' }}>
            <div style={{ width:'100%', maxWidth:480 }}>
              {error && <div style={{ background:'rgba(240,100,100,.1)', border:'1px solid rgba(240,100,100,.3)', borderRadius:8, padding:'10px 16px', fontSize:13, color:'#f06464', marginBottom:14 }}>{error}</div>}
              <label style={{ border:'2px dashed #35353c', borderRadius:16, padding:'56px 72px', display:'flex', flexDirection:'column', alignItems:'center', gap:14, cursor:'pointer', textAlign:'center' }}>
                <div style={{ fontSize:44, opacity:.3 }}>⬆</div>
                <div style={{ fontSize:17, fontWeight:500 }}>Ladda upp din SIE4-fil</div>
                <div style={{ fontSize:13, color:'#9898a6', lineHeight:1.7 }}>Exportera från Fortnox, Visma eller Bokio. Filen analyseras lokalt — lämnar aldrig din dator.</div>
                <div style={{ fontSize:11, color:'#5c5c6b', fontFamily:'monospace' }}>.SI · .SE · SIE4-format</div>
                <input type="file" accept=".si,.se,.SIE,.sie" onChange={handleFile} style={{ display:'none' }} />
              </label>
            </div>
          </div>
        )}

        {loading && <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh', color:'#9898a6' }}>Analyserar filen...</div>}

        {data && !loading && (
          <>
            <div style={{ marginBottom:20 }}>
              <h1 style={{ fontSize:21, fontWeight:600, letterSpacing:'-.4px', margin:0 }}>{data.companyName}</h1>
              <div style={{ fontSize:12, color:'#9898a6', marginTop:3, fontFamily:'monospace' }}>{data.start} → {data.end} · {data.months.length} månader</div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
              {[
                { label:'Omsättning',        value:fmt(data.summary.totalRevenue),                    accent:'#5b8def' },
                { label:'Rörelseresultat',   value:fmt(data.summary.profit),                          accent: data.summary.profit >= 0 ? '#3ecf8e' : '#f06464' },
                { label:'Rörelsemarginal',   value:`${data.summary.operatingMargin.toFixed(1)}%`,     accent:'#a78bfa' },
                { label:'Kostnader totalt',  value:fmt(data.summary.totalExpenses),                   accent:'#f06464' },
                { label:'Personalkostnader', value:`${data.summary.personnelRatio.toFixed(1)}%`,      accent:'#f5a623' },
                { label:'Snitt per månad',   value:fmt(data.summary.totalRevenue/Math.max(data.months.length,1)), accent:'#2dd4bf' },
              ].map(k => (
                <div key={k.label} style={{ ...card, padding:'14px 16px', position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:k.accent }} />
                  <div style={{ fontSize:11, color:'#9898a6', textTransform:'uppercase', letterSpacing:'.6px', marginBottom:6 }}>{k.label}</div>
                  <div style={{ fontSize:20, fontWeight:600 }}>{k.value}</div>
                </div>
              ))}
            </div>

            <div style={{ ...card, padding:18, marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:500, marginBottom:14 }}>Omsättning per månad</div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:5, height:160 }}>
                {data.months.map(m => (
                  <div key={m.month} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                    <div title={`${m.month}: ${fmt(m.revenue)}`} style={{ width:'100%', background: m.profit >= 0 ? '#5b8def' : '#f06464', borderRadius:'3px 3px 0 0', height:`${Math.max(Math.round((m.revenue/maxRev)*140),2)}px`, opacity:.8, cursor:'pointer', transition:'.2s' }} />
                    <div style={{ fontSize:9, color:'#5c5c6b', fontFamily:'monospace', transform:'rotate(-45deg)', whiteSpace:'nowrap' }}>{m.month.substring(5)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ ...card, overflow:'hidden' }}>
              <div style={{ padding:'14px 18px', borderBottom:'1px solid #2a2a2f', fontSize:13, fontWeight:500 }}>Månadsöversikt</div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                <thead>
                  <tr>{['Månad','Intäkter','Kostnader','Resultat','Marginal'].map(h => <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontSize:11, color:'#5c5c6b', textTransform:'uppercase', letterSpacing:'.5px', borderBottom:'1px solid #2a2a2f' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.months.map(m => {
                    const pct = m.revenue > 0 ? (m.profit/m.revenue*100) : 0
                    return (
                      <tr key={m.month} style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                        <td style={{ padding:'10px 14px', color:'#9898a6', fontFamily:'monospace', fontSize:12 }}>{m.month}</td>
                        <td style={{ padding:'10px 14px', color:'#3ecf8e', fontFamily:'monospace', fontSize:12 }}>{fmt(m.revenue)}</td>
                        <td style={{ padding:'10px 14px', color:'#f06464', fontFamily:'monospace', fontSize:12 }}>{fmt(m.expenses)}</td>
                        <td style={{ padding:'10px 14px', color: m.profit >= 0 ? '#3ecf8e' : '#f06464', fontFamily:'monospace', fontSize:12 }}>{fmt(m.profit)}</td>
                        <td style={{ padding:'10px 14px', color: pct >= 10 ? '#3ecf8e' : pct >= 0 ? '#f5a623' : '#f06464', fontFamily:'monospace', fontSize:12 }}>{pct.toFixed(1)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}