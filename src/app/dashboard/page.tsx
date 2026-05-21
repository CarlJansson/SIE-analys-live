'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { decodeCP437, parseSIE } from '@/lib/parser'
import { calcWarnings, generateForecast, BRANSCH_NORMS } from '@/lib/calculations'
import type { SIEData, AppConfig, OnboardingAnswers, Warning, ForecastMonth } from '@/lib/types'

// ── Format helpers ─────────────────────────────────────────────────────────
const fmtM  = (n: number) => { const m = Math.round(n/1e5)/10; return m >= 1000 ? (m/1000).toFixed(1)+' Mdr' : m.toFixed(1)+' Mkr' }
const fmtKr = (n: number) => new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' kr'
const fmtP  = (n: number) => n.toFixed(1) + '%'

// ── Default config ─────────────────────────────────────────────────────────
const DEFAULT_CONFIG: AppConfig = {
  revenueFrom: 3000,
  revenueTo: 3799,
  excludeAccounts: [],
  model: 'K2',
}

// ── Onboarding questions ───────────────────────────────────────────────────
const QUESTIONS = [
  { id: 'bransch', title: 'Vilken bransch?', subtitle: 'Påverkar normvärden för marginal och avskrivningar',
    options: [
      { value: 'konsult',      label: 'Konsult / tjänster',   icon: '◈' },
      { value: 'handel',       label: 'Handel',               icon: '⊞' },
      { value: 'fastighet',    label: 'Fastighet / bygg',     icon: '▦' },
      { value: 'tillverkning', label: 'Tillverkning',         icon: '⚙' },
      { value: 'it',           label: 'IT / tech',            icon: '◇' },
      { value: 'restaurang',   label: 'Restaurang',           icon: '◎' },
      { value: 'halsa',        label: 'Hälsa / vård',         icon: '◉' },
      { value: 'ovrigt',       label: 'Annat',                icon: '·' },
    ]},
  { id: 'storlek', title: 'Hur stort är bolaget?', subtitle: 'Hjälper sätta rätt benchmarks',
    options: [
      { value: 'micro',  label: '1–5 anst.',    icon: '◦' },
      { value: 'small',  label: '6–20 anst.',   icon: '◦◦' },
      { value: 'medium', label: '21–100 anst.', icon: '◦◦◦' },
      { value: 'large',  label: '100+ anst.',   icon: '◦◦◦◦' },
    ]},
  { id: 'roll', title: 'Vad är din roll?', subtitle: 'Anpassar djupet på insikterna',
    options: [
      { value: 'agare',       label: 'Företagsägare',       icon: '◈' },
      { value: 'ekonomi',     label: 'Ekonom / CFO',        icon: '◇' },
      { value: 'redovisning', label: 'Redovisningskonsult', icon: '▦' },
      { value: 'revisor',     label: 'Revisor',             icon: '◉' },
    ]},
  { id: 'koncern', title: 'Koncern- eller holdingbolag?', subtitle: 'Justerar tolkning av koncerninterna fordringar',
    options: [
      { value: 'nej',    label: 'Nej — enskilt bolag',   icon: '◦' },
      { value: 'dotter', label: 'Dotterbolag i koncern', icon: '◦◦' },
      { value: 'moder',  label: 'Moderbolag / holding',  icon: '◦◦◦' },
    ]},
]

// ── CSS variables ──────────────────────────────────────────────────────────
const CSS = `
:root {
  --bg:#0d0d0f;--bg2:#141416;--bg3:#1a1a1d;--bg4:#1f1f23;
  --border:#2a2a2f;--border2:#35353c;
  --text:#e8e8ed;--text2:#9898a6;--text3:#5c5c6b;
  --accent:#5b8def;--green:#3ecf8e;--red:#f06464;--amber:#f5a623;--purple:#a78bfa;--teal:#2dd4bf;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',-apple-system,sans-serif;min-height:100vh}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
`

export default function Dashboard() {
  const [data,     setData]    = useState<SIEData | null>(null)
  const [config,   setConfig]  = useState<AppConfig>(DEFAULT_CONFIG)
  const [step,     setStep]    = useState<'upload' | 'onboarding' | 'dashboard'>('upload')
  const [obStep,   setObStep]  = useState(0)
  const [answers,  setAnswers] = useState<Partial<OnboardingAnswers>>({})
  const [pending,  setPending] = useState<SIEData | null>(null)
  const [page,     setPage]    = useState('dashboard')
  const [error,    setError]   = useState('')
  const [loading,  setLoading] = useState(false)
  const chartsRef = useRef<Record<string, any>>({})

  // Destroy charts on page change
  useEffect(() => {
    return () => { Object.values(chartsRef.current).forEach((c: any) => { try { c.destroy() } catch {} }) }
  }, [page])

  // ── File reading ───────────────────────────────────────────────────────
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true); setError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = decodeCP437(ev.target!.result as ArrayBuffer)
        const parsed = parseSIE(text)
        if (parsed.months.length === 0) {
          setError('Inga transaktioner hittades. Kontrollera att det är en SIE4-fil.')
          setLoading(false)
          return
        }
        setPending(parsed)
        setStep('onboarding')
        setObStep(0)
        setAnswers({})
      } catch (err: any) {
        setError('Fel vid inläsning: ' + err.message)
      }
      setLoading(false)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }, [])

  // ── Onboarding ─────────────────────────────────────────────────────────
  const selectAnswer = (qId: string, value: string) => {
    const newAnswers = { ...answers, [qId]: value }
    setAnswers(newAnswers)
    setTimeout(() => {
      if (obStep < QUESTIONS.length - 1) {
        setObStep(s => s + 1)
      } else {
        finishOnboarding(newAnswers as OnboardingAnswers)
      }
    }, 300)
  }

  const finishOnboarding = (ans: OnboardingAnswers) => {
    const norms = BRANSCH_NORMS[ans.bransch] ?? BRANSCH_NORMS['ovrigt']
    const newConfig: AppConfig = { ...DEFAULT_CONFIG, bransch: ans.bransch, roll: ans.roll, koncern: ans.koncern, storlek: ans.storlek, branschNorms: norms }
    setConfig(newConfig)
    setData(pending)
    setStep('dashboard')
    setPage('dashboard')
  }

  const skipOnboarding = () => {
    finishOnboarding({ bransch: 'ovrigt', storlek: 'small', roll: 'agare', koncern: 'nej' })
  }

  const reset = () => {
    setData(null); setStep('upload'); setPage('dashboard'); setError('')
    Object.values(chartsRef.current).forEach((c: any) => { try { c.destroy() } catch {} })
    chartsRef.current = {}
  }

  // ── Chart init ─────────────────────────────────────────────────────────
  const initChart = useCallback((id: string, config: any) => {
    if (typeof window === 'undefined') return
    const canvas = document.getElementById(id) as HTMLCanvasElement
    if (!canvas) return
    if (chartsRef.current[id]) { try { chartsRef.current[id].destroy() } catch {} }
    import('chart.js').then(({ Chart, registerables }) => {
      Chart.register(...registerables)
      chartsRef.current[id] = new Chart(canvas, config)
    })
  }, [])

  useEffect(() => {
    if (!data || step !== 'dashboard') return
    const gc = 'rgba(255,255,255,0.05)', tc = '#9898a6'
    const tip = { backgroundColor:'#1a1a1d', titleColor:'#e8e8ed', bodyColor:'#9898a6', borderColor:'#2a2a2f', borderWidth:1 }
    const labels = data.months.map(m => m.month.substring(5))

    if (page === 'dashboard') {
      setTimeout(() => {
        initChart('c-rev', { type:'bar', data:{ labels, datasets:[{ data:data.months.map(m=>Math.round(m.revenue/1000)), backgroundColor:data.months.map(m=>m.profit>=0?'rgba(91,141,239,.7)':'rgba(240,100,100,.7)'), borderRadius:4, borderSkipped:false }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{...tip, callbacks:{label:(c:any)=>`${c.parsed.y} kkr`}} }, scales:{ x:{grid:{color:gc},ticks:{color:tc,font:{size:10}},border:{display:false}}, y:{grid:{color:gc},ticks:{color:tc,font:{size:10},callback:(v:any)=>v+'k'},border:{display:false}} } } })
        const cats=['Personal','Material','Externa tj.','Övrigt','Finans']
        const catVals=[data.summary.personnel,data.summary.material,data.summary.external,data.summary.other,data.summary.financial].map(v=>Math.round(v/1000))
        const catColors=['#5b8def','#f06464','#a78bfa','#f5a623','#2dd4bf']
        initChart('c-cost', { type:'doughnut', data:{ labels:cats, datasets:[{ data:catVals, backgroundColor:catColors, borderWidth:2, borderColor:'#141416' }] }, options:{ responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{labels:{color:tc,font:{size:10},boxWidth:8}}, tooltip:{...tip} } } })
        initChart('c-result', { type:'line', data:{ labels, datasets:[{ label:'Intäkter', data:data.months.map(m=>Math.round(m.revenue/1000)), borderColor:'#5b8def', backgroundColor:'rgba(91,141,239,.08)', borderWidth:2, pointRadius:3, fill:true, tension:.3 }, { label:'Kostnader', data:data.months.map(m=>Math.round(m.expenses/1000)), borderColor:'#f06464', backgroundColor:'rgba(240,100,100,.05)', borderWidth:2, pointRadius:3, fill:true, tension:.3 }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{labels:{color:tc,font:{size:11},boxWidth:10}}, tooltip:{...tip} }, scales:{ x:{grid:{color:gc},ticks:{color:tc,font:{size:10}},border:{display:false}}, y:{grid:{color:gc},ticks:{color:tc,font:{size:10},callback:(v:any)=>v+'k'},border:{display:false}} } } })
      }, 100)
    }
  }, [data, page, step, initChart])

  const s    = data?.summary
  const fc   = data ? generateForecast(data) : []
  const warn = data ? calcWarnings(data, config) : []

  // ── Render ─────────────────────────────────────────────────────────────
  const nav = [
    { id:'dashboard', label:'◈ Dashboard' },
    { id:'resultat',  label:'◇ Resultat' },
    { id:'balans',    label:'▣ Balansräkning' },
    { id:'likviditet',label:'◎ Likviditetsprognos' },
    { id:'konton',    label:'≡ Kontodrilldown' },
  ]

  return (
    <>
      <style>{CSS}</style>

      {/* ── Onboarding overlay ── */}
      {step === 'onboarding' && (
        <div style={{ position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(13,13,15,.94)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,backdropFilter:'blur(4px)' }}>
          <div style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:16,padding:'36px 40px',maxWidth:520,width:'100%',margin:20 }}>
            {/* Progress */}
            <div style={{ display:'flex',gap:6,marginBottom:28 }}>
              {QUESTIONS.map((_, i) => (
                <div key={i} style={{ flex:1,height:3,borderRadius:2,background:i<=obStep?'#5b8def':'#2a2a2f',transition:'.3s' }} />
              ))}
            </div>
            <div style={{ fontSize:11.5,color:'#5c5c6b',fontFamily:'monospace',marginBottom:10 }}>{obStep+1} / {QUESTIONS.length}</div>
            <div style={{ fontSize:20,fontWeight:600,letterSpacing:'-.4px',color:'#e8e8ed',marginBottom:6 }}>{QUESTIONS[obStep].title}</div>
            <div style={{ fontSize:13,color:'#9898a6',marginBottom:24,lineHeight:1.5 }}>{QUESTIONS[obStep].subtitle}</div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:28 }}>
              {QUESTIONS[obStep].options.map(opt => (
                <div key={opt.value} onClick={() => selectAnswer(QUESTIONS[obStep].id, opt.value)}
                  style={{ padding:'12px 14px',borderRadius:10,cursor:'pointer',border:`1px solid ${(answers as any)[QUESTIONS[obStep].id]===opt.value?'rgba(91,141,239,.35)':'#2a2a2f'}`,background:(answers as any)[QUESTIONS[obStep].id]===opt.value?'rgba(91,141,239,.1)':'#1a1a1d',display:'flex',alignItems:'center',gap:10,transition:'.12s',userSelect:'none' }}>
                  <span style={{ fontSize:16,color:'#5c5c6b' }}>{opt.icon}</span>
                  <span style={{ fontSize:13,color:(answers as any)[QUESTIONS[obStep].id]===opt.value?'#e8e8ed':'#9898a6' }}>{opt.label}</span>
                </div>
              ))}
            </div>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
              {obStep > 0
                ? <button onClick={() => setObStep(s => s-1)} style={{ padding:'8px 16px',background:'transparent',border:'1px solid #2a2a2f',borderRadius:8,color:'#9898a6',fontSize:13,cursor:'pointer',fontFamily:'inherit' }}>← Tillbaka</button>
                : <div />
              }
              <button onClick={skipOnboarding} style={{ padding:'8px 16px',background:'transparent',border:'none',color:'#5c5c6b',fontSize:12.5,cursor:'pointer',fontFamily:'inherit' }}>Hoppa över</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display:'flex',minHeight:'100vh' }}>
        {/* ── Sidebar ── */}
        <aside style={{ width:220,minWidth:220,background:'#141416',borderRight:'1px solid #2a2a2f',display:'flex',flexDirection:'column' }}>
          <div style={{ padding:18,borderBottom:'1px solid #2a2a2f',display:'flex',alignItems:'center',gap:10 }}>
            <div style={{ width:30,height:30,background:'#5b8def',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'#fff',fontSize:15 }}>Ā</div>
            <div>
              <div style={{ fontWeight:600,fontSize:14 }}>SIE Analys</div>
              <div style={{ fontSize:10,color:'#5c5c6b',fontFamily:'monospace' }}>v2.0</div>
            </div>
          </div>

          <nav style={{ padding:'10px 8px',flex:1 }}>
            {nav.map(n => (
              <div key={n.id} onClick={() => data && setPage(n.id)}
                style={{ padding:'8px 10px',borderRadius:7,fontSize:13,color:page===n.id&&data?'#5b8def':'#9898a6',background:page===n.id&&data?'rgba(91,141,239,.12)':'transparent',border:page===n.id&&data?'1px solid rgba(91,141,239,.18)':'1px solid transparent',cursor:'pointer',marginBottom:2,transition:'.12s',userSelect:'none' }}>
                {n.label}
              </div>
            ))}
          </nav>

          <div style={{ padding:12,borderTop:'1px solid #2a2a2f',display:'flex',flexDirection:'column',gap:6 }}>
            <label style={{ display:'block',width:'100%',padding:9,background:'#5b8def',borderRadius:7,color:'#fff',fontSize:13,fontWeight:500,cursor:'pointer',textAlign:'center' }}>
              ↑ Ladda upp SIE
              <input type="file" accept=".si,.se,.SIE,.sie" onChange={handleFile} style={{ display:'none' }} />
            </label>
            {data && <button onClick={reset} style={{ width:'100%',padding:7,background:'transparent',border:'1px solid #35353c',borderRadius:7,color:'#9898a6',fontSize:12,cursor:'pointer',fontFamily:'inherit' }}>↺ Ny fil</button>}
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ flex:1,overflow:'auto',padding:24 }}>

          {/* Upload state */}
          {step === 'upload' && (
            <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'70vh' }}>
              <div style={{ width:'100%',maxWidth:480 }}>
                {error && <div style={{ background:'rgba(240,100,100,.1)',border:'1px solid rgba(240,100,100,.3)',borderRadius:8,padding:'10px 16px',fontSize:13,color:'#f06464',marginBottom:14 }}>{error}</div>}
                {loading && <div style={{ textAlign:'center',color:'#9898a6',marginBottom:14 }}>Läser fil...</div>}
                <label style={{ border:'2px dashed #35353c',borderRadius:16,padding:'56px 72px',display:'flex',flexDirection:'column',alignItems:'center',gap:14,cursor:'pointer',textAlign:'center',transition:'.2s' }}>
                  <div style={{ fontSize:44,opacity:.3 }}>⬆</div>
                  <div style={{ fontSize:17,fontWeight:500 }}>Ladda upp din SIE4-fil</div>
                  <div style={{ fontSize:13,color:'#9898a6',maxWidth:300,lineHeight:1.7 }}>Exportera från Fortnox, Visma eller Bokio. Analyseras lokalt — lämnar aldrig din dator.</div>
                  <div style={{ fontSize:11,color:'#5c5c6b',fontFamily:'monospace' }}>.SI · .SE · SIE4-format</div>
                  <input type="file" accept=".si,.se,.SIE,.sie" onChange={handleFile} style={{ display:'none' }} />
                </label>
                <div style={{ textAlign:'center',marginTop:14,fontSize:12,color:'#5c5c6b' }}>Fortnox: Arkiv → SIE4 &nbsp;|&nbsp; Visma: Redovisning → SIE4 &nbsp;|&nbsp; Bokio: Inställningar → Export</div>
              </div>
            </div>
          )}

          {/* Dashboard */}
          {step === 'dashboard' && data && s && (
            <>
              <div style={{ marginBottom:20 }}>
                <h1 style={{ fontSize:21,fontWeight:600,letterSpacing:'-.4px',margin:0 }}>{data.companyName}</h1>
                <div style={{ fontSize:12,color:'#9898a6',marginTop:3,fontFamily:'monospace' }}>{data.start} → {data.end} · {data.months.length} månader</div>
              </div>

              {/* Warnings */}
              {warn.length > 0 && page === 'dashboard' && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:8 }}>
                    <span style={{ fontSize:12.5,fontWeight:500 }}>Varningsflaggor</span>
                    {warn.filter(w=>w.level==='red').length>0 && <span style={{ background:'rgba(240,100,100,.12)',color:'#f06464',fontSize:11,padding:'1px 7px',borderRadius:4 }}>{warn.filter(w=>w.level==='red').length} kritiska</span>}
                    {warn.filter(w=>w.level==='amber').length>0 && <span style={{ background:'rgba(245,166,35,.12)',color:'#f5a623',fontSize:11,padding:'1px 7px',borderRadius:4 }}>{warn.filter(w=>w.level==='amber').length} att bevaka</span>}
                  </div>
                  {warn.map((w, i) => {
                    const col = w.level==='red'?'var(--red)':w.level==='amber'?'var(--amber)':'var(--accent)'
                    const bg  = w.level==='red'?'rgba(240,100,100,.08)':w.level==='amber'?'rgba(245,166,35,.08)':'rgba(91,141,239,.08)'
                    const bdr = w.level==='red'?'rgba(240,100,100,.25)':w.level==='amber'?'rgba(245,166,35,.25)':'rgba(91,141,239,.25)'
                    return (
                      <div key={i} style={{ background:bg,border:`1px solid ${bdr}`,borderRadius:9,padding:'11px 14px',display:'flex',gap:10,marginBottom:6 }}>
                        <span style={{ color:col,fontSize:15,flexShrink:0 }}>{w.icon}</span>
                        <div>
                          <div style={{ fontSize:12.5,fontWeight:500,color:col,marginBottom:2 }}>{w.title}</div>
                          <div style={{ fontSize:12,color:'#9898a6',lineHeight:1.6 }}>{w.desc}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* KPI Grid */}
              {page === 'dashboard' && (
                <>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:10 }}>
                    {[
                      { label:'Omsättning',       value:fmtM(s.totalRevenue),           sub:`${data.months.length} månader`, accent:'#5b8def' },
                      { label:'Rörelseresultat',   value:fmtM(s.profit),                 sub:fmtP(s.operatingMargin)+' marginal', accent:s.profit>=0?'#3ecf8e':'#f06464' },
                      { label:'Kassa (UB)',         value:fmtM(s.cashUB),                sub:`Förändring: ${s.cashChange>=0?'+':''}${fmtM(s.cashChange)}`, accent:'#2dd4bf' },
                    ].map(k => (
                      <div key={k.label} style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,padding:'14px 16px',position:'relative',overflow:'hidden' }}>
                        <div style={{ position:'absolute',top:0,left:0,right:0,height:2,background:k.accent }} />
                        <div style={{ fontSize:11,color:'#9898a6',textTransform:'uppercase',letterSpacing:'.6px',marginBottom:6 }}>{k.label}</div>
                        <div style={{ fontSize:20,fontWeight:600 }}>{k.value}</div>
                        <div style={{ fontSize:11,color:'#9898a6',marginTop:4 }}>{k.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14 }}>
                    {[
                      { label:'Likviditetskvot',    value:s.liquidity.toFixed(2),         sub:'Omsättn. / kortfr.skulder', accent:'#f5a623' },
                      { label:'Personalkostnader',  value:fmtP(s.personnelRatio),         sub:fmtM(s.personnel), accent:'#f06464' },
                      { label:'Kundfordringar (UB)', value:fmtM(s.receivablesUB),         sub:'Netto efter nedskrivning', accent:'#a78bfa' },
                      { label:'Momsskuld (netto)',  value:fmtM(s.vatNet),                 sub:'Utg. minus ing. moms', accent:'#f5a623' },
                    ].map(k => (
                      <div key={k.label} style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,padding:'14px 16px',position:'relative',overflow:'hidden' }}>
                        <div style={{ position:'absolute',top:0,left:0,right:0,height:2,background:k.accent }} />
                        <div style={{ fontSize:10.5,color:'#9898a6',textTransform:'uppercase',letterSpacing:'.6px',marginBottom:5 }}>{k.label}</div>
                        <div style={{ fontSize:18,fontWeight:600 }}>{k.value}</div>
                        <div style={{ fontSize:11,color:'#9898a6',marginTop:3 }}>{k.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:'grid',gridTemplateColumns:'1.6fr 1fr',gap:12,marginBottom:12 }}>
                    <div style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,padding:18 }}>
                      <div style={{ fontSize:13,fontWeight:500,marginBottom:3 }}>Omsättning per månad</div>
                      <div style={{ fontSize:11.5,color:'#9898a6',marginBottom:12 }}>Intäkter · kkr</div>
                      <div style={{ position:'relative',height:190 }}><canvas id="c-rev" /></div>
                    </div>
                    <div style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,padding:18 }}>
                      <div style={{ fontSize:13,fontWeight:500,marginBottom:3 }}>Kostnadsfördelning</div>
                      <div style={{ fontSize:11.5,color:'#9898a6',marginBottom:12 }}>Kontoklass 4–7</div>
                      <div style={{ position:'relative',height:190 }}><canvas id="c-cost" /></div>
                    </div>
                  </div>
                  <div style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,padding:18 }}>
                    <div style={{ fontSize:13,fontWeight:500,marginBottom:3 }}>Resultatutveckling</div>
                    <div style={{ fontSize:11.5,color:'#9898a6',marginBottom:12 }}>Intäkter vs kostnader · kkr</div>
                    <div style={{ position:'relative',height:190 }}><canvas id="c-result" /></div>
                  </div>
                </>
              )}

              {/* Resultat */}
              {page === 'resultat' && (
                <>
                  <h2 style={{ fontSize:20,fontWeight:600,marginBottom:3 }}>Resultatanalys</h2>
                  <p style={{ fontSize:12.5,color:'#9898a6',marginBottom:18 }}>Månadsvis detaljering</p>
                  <div style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,overflow:'hidden' }}>
                    <table style={{ width:'100%',borderCollapse:'collapse',fontSize:12.5 }}>
                      <thead>
                        <tr>{['Månad','Intäkter','Kostnader','Resultat','Marginal'].map(h=>(
                          <th key={h} style={{ padding:'9px 14px',fontSize:11,fontWeight:500,textTransform:'uppercase',letterSpacing:'.5px',color:'#5c5c6b',textAlign:'left',borderBottom:'1px solid #2a2a2f' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {data.months.map(m => {
                          const pct = m.revenue>0?(m.profit/m.revenue*100):0
                          return (
                            <tr key={m.month} style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                              <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:11.5,color:'#9898a6' }}>{m.month}</td>
                              <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:12,color:'#3ecf8e',textAlign:'right' }}>{fmtKr(m.revenue)}</td>
                              <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:12,color:'#f06464',textAlign:'right' }}>{fmtKr(m.expenses)}</td>
                              <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:12,color:m.profit>=0?'#3ecf8e':'#f06464',textAlign:'right' }}>{fmtKr(m.profit)}</td>
                              <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:12,color:pct>=10?'#3ecf8e':pct>=0?'#9898a6':'#f06464',textAlign:'right' }}>{fmtP(pct)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Balans */}
              {page === 'balans' && (
                <>
                  <h2 style={{ fontSize:20,fontWeight:600,marginBottom:3 }}>Balansräkning</h2>
                  <p style={{ fontSize:12.5,color:'#9898a6',marginBottom:18 }}>Tillgångar och skulder från #IB och #UB</p>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16 }}>
                    {[
                      { label:'Kassa (UB)',           value:fmtM(s.cashUB),          sub:`IB: ${fmtM(s.cashIB)}`,           accent:'#3ecf8e' },
                      { label:'Kundfordringar (UB)',  value:fmtM(s.receivablesUB),   sub:'Netto efter nedskrivning',        accent:'#5b8def' },
                      { label:'Omsättningstillg.',    value:fmtM(s.currentAssetsUB), sub:'1300–1999 positiva UB',           accent:'#2dd4bf' },
                      { label:'Kortfr. skulder',      value:fmtM(s.currentLiabUB),   sub:'2xxx negativa UB',                accent:'#f06464' },
                      { label:'Likviditetskvot',      value:s.liquidity.toFixed(2),  sub:'>1,5 = stabilt',                 accent:'#f5a623' },
                      { label:'Kassaförändring',      value:`${s.cashChange>=0?'+':''}${fmtM(s.cashChange)}`, sub:'Under perioden', accent:s.cashChange>=0?'#3ecf8e':'#f06464' },
                    ].map(k => (
                      <div key={k.label} style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,padding:'14px 16px',position:'relative',overflow:'hidden' }}>
                        <div style={{ position:'absolute',top:0,left:0,right:0,height:2,background:k.accent }} />
                        <div style={{ fontSize:10.5,color:'#9898a6',textTransform:'uppercase',letterSpacing:'.6px',marginBottom:5 }}>{k.label}</div>
                        <div style={{ fontSize:18,fontWeight:600 }}>{k.value}</div>
                        <div style={{ fontSize:11,color:'#9898a6',marginTop:3 }}>{k.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,overflow:'hidden' }}>
                    <div style={{ padding:'14px 18px',borderBottom:'1px solid #2a2a2f',fontSize:13,fontWeight:500 }}>Nyckelkonton</div>
                    <table style={{ width:'100%',borderCollapse:'collapse',fontSize:12.5 }}>
                      <thead><tr>{['Konto','Namn','IB','UB','Förändring'].map(h=>(
                        <th key={h} style={{ padding:'8px 14px',fontSize:10.5,fontWeight:500,textTransform:'uppercase',letterSpacing:'.5px',color:'#5c5c6b',textAlign:'left',borderBottom:'1px solid #2a2a2f' }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {['1510','1519','1620','1930','1940','2440','2510','2650','2099'].map(k => {
                          const ubV = data.ub[k]||0, ibV = data.ib[k]||0
                          if (Math.abs(ubV)+Math.abs(ibV) < 1000) return null
                          return (
                            <tr key={k} style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                              <td style={{ padding:'8px 14px',fontFamily:'monospace',fontSize:11.5,color:'#5c5c6b' }}>{k}</td>
                              <td style={{ padding:'8px 14px',fontSize:12,color:'#9898a6' }}>{data.accounts[k]?.name||'–'}</td>
                              <td style={{ padding:'8px 14px',fontFamily:'monospace',fontSize:12,textAlign:'right',color:'#9898a6' }}>{fmtM(ibV)}</td>
                              <td style={{ padding:'8px 14px',fontFamily:'monospace',fontSize:12,textAlign:'right',color:ubV>=0?'#3ecf8e':'#f06464' }}>{fmtM(ubV)}</td>
                              <td style={{ padding:'8px 14px',fontFamily:'monospace',fontSize:12,textAlign:'right',color:(ubV-ibV)>=0?'#3ecf8e':'#f06464' }}>{ubV-ibV>=0?'+':''}{fmtM(ubV-ibV)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Likviditet */}
              {page === 'likviditet' && (
                <>
                  <h2 style={{ fontSize:20,fontWeight:600,marginBottom:3 }}>Likviditetsprognos</h2>
                  <p style={{ fontSize:12.5,color:'#9898a6',marginBottom:18 }}>Prognostiserat kassaflöde · 3 månader framåt</p>
                  {fc.some(f=>f.risk==='high') && (
                    <div style={{ background:'rgba(240,100,100,.08)',border:'1px solid rgba(240,100,100,.2)',borderRadius:10,padding:'13px 16px',display:'flex',gap:12,marginBottom:16 }}>
                      <span style={{ fontSize:16 }}>⚠</span>
                      <div>
                        <div style={{ color:'#f06464',fontWeight:500,marginBottom:2,fontSize:13 }}>Likviditetsvarning</div>
                        <div style={{ fontSize:12.5,color:'#9898a6' }}>Baserat på historiska mönster riskerar kassaflödet att gå negativt. Säkerställ kreditlimit.</div>
                      </div>
                    </div>
                  )}
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16 }}>
                    {fc.map(f => {
                      const col = f.risk==='high'?'#f06464':f.risk==='medium'?'#f5a623':'#3ecf8e'
                      return (
                        <div key={f.month} style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,padding:14 }}>
                          <div style={{ fontSize:11,color:'#9898a6',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8 }}>{f.month}</div>
                          <div style={{ fontSize:20,fontWeight:600,color:col }}>{f.net>=0?'+':''}{fmtKr(f.net)}</div>
                          <div style={{ fontSize:11,color:'#9898a6',marginTop:2 }}>Netto kassaflöde</div>
                          <div style={{ height:4,background:'#1f1f23',borderRadius:2,overflow:'hidden',marginTop:8 }}>
                            <div style={{ height:'100%',background:col,width:`${f.risk==='high'?90:f.risk==='medium'?50:20}%`,borderRadius:2 }} />
                          </div>
                          <div style={{ fontSize:11,color:col,marginTop:4 }}>{f.risk==='high'?'Hög risk':f.risk==='medium'?'Medelhög risk':'Låg risk'}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,overflow:'hidden' }}>
                    <div style={{ padding:'14px 18px',borderBottom:'1px solid #2a2a2f',fontSize:13,fontWeight:500 }}>Prognostabell</div>
                    <table style={{ width:'100%',borderCollapse:'collapse',fontSize:12.5 }}>
                      <thead><tr>{['Period','Proj. intäkter','Proj. kostnader','Netto','Risk'].map(h=>(
                        <th key={h} style={{ padding:'8px 14px',fontSize:10.5,fontWeight:500,textTransform:'uppercase',letterSpacing:'.5px',color:'#5c5c6b',textAlign:'left',borderBottom:'1px solid #2a2a2f' }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {fc.map(f=>(
                          <tr key={f.month} style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                            <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:11.5,color:'#9898a6' }}>{f.month}</td>
                            <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:12,color:'#9898a6',textAlign:'right' }}>{fmtKr(f.projRev)}</td>
                            <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:12,color:'#9898a6',textAlign:'right' }}>{fmtKr(f.projCost)}</td>
                            <td style={{ padding:'9px 14px',fontFamily:'monospace',fontSize:12,color:f.net>=0?'#3ecf8e':'#f06464',textAlign:'right' }}>{f.net>=0?'+':''}{fmtKr(f.net)}</td>
                            <td style={{ padding:'9px 14px' }}><span style={{ padding:'2px 7px',borderRadius:4,fontSize:10,fontWeight:500,background:f.risk==='high'?'rgba(240,100,100,.12)':f.risk==='medium'?'rgba(245,166,35,.12)':'rgba(62,207,142,.12)',color:f.risk==='high'?'#f06464':f.risk==='medium'?'#f5a623':'#3ecf8e' }}>{f.risk==='high'?'⚠ Hög':f.risk==='medium'?'→ Medel':'✓ Låg'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Konton */}
              {page === 'konton' && (
                <>
                  <h2 style={{ fontSize:20,fontWeight:600,marginBottom:3 }}>Kontodrilldown</h2>
                  <p style={{ fontSize:12.5,color:'#9898a6',marginBottom:18 }}>Alla konton sorterade efter volym</p>
                  <div style={{ background:'#141416',border:'1px solid #2a2a2f',borderRadius:11,overflow:'hidden' }}>
                    {Object.values(data.accounts)
                      .filter(a => (a.total||0) > 0)
                      .sort((a,b) => (b.total||0)-(a.total||0))
                      .slice(0,30)
                      .map(a => {
                        const max = Math.max(...Object.values(data.accounts).map(x=>x.total||0), 1)
                        const pct = Math.round((a.total||0)/max*100)
                        const color = a.num.startsWith('3')?'#3ecf8e':a.num.startsWith('7')?'#f06464':a.num.startsWith('5')?'#a78bfa':'#5b8def'
                        return (
                          <div key={a.num} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                            <div style={{ width:50,fontFamily:'monospace',fontSize:11,color:'#5c5c6b',flexShrink:0 }}>{a.num}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:12.5,marginBottom:5 }}>{a.name}</div>
                              <div style={{ height:4,background:'#1f1f23',borderRadius:2,overflow:'hidden' }}>
                                <div style={{ height:'100%',width:`${pct}%`,background:color,borderRadius:2 }} />
                              </div>
                            </div>
                            <div style={{ textAlign:'right',marginLeft:12,flexShrink:0 }}>
                              <div style={{ fontSize:13,fontWeight:500,fontFamily:'monospace',color }}>{fmtM(a.total||0)}</div>
                              <div style={{ fontSize:10.5,color:'#5c5c6b' }}>{fmtP((a.total||0)/Math.max(s.totalRevenue,1)*100)} av oms.</div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </>
  )
}
