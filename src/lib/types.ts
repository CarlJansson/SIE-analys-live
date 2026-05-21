export interface MonthlyData {
  month: string
  revenue: number
  expenses: number
  profit: number
  personnel: number
  material: number
  external: number
  other: number
  financial: number
  vat_out: number
  vat_in: number
  cash_in: number
  cash_out: number
}

export interface Summary {
  totalRevenue: number
  totalExpenses: number
  profit: number
  operatingMargin: number
  personnel: number
  material: number
  external: number
  other: number
  financial: number
  vat_out: number
  vat_in: number
  cash_in: number
  cash_out: number
  personnelRatio: number
  cashUB: number
  cashIB: number
  cashChange: number
  receivablesUB: number
  currentAssetsUB: number
  currentLiabUB: number
  liquidity: number
  vatNet: number
  vatOut: number
  vatIn: number
}

export interface SIEData {
  companyName: string
  start: string
  end: string
  months: MonthlyData[]
  accounts: Record<string, { name: string; num: string; total?: number }>
  ib: Record<string, number>
  ub: Record<string, number>
  res: Record<string, number>
  summary: Summary
}

export interface ForecastMonth {
  month: string
  projRev: number
  projCost: number
  net: number
  acc: number
  risk: 'low' | 'medium' | 'high'
}

export interface Warning {
  level: 'red' | 'amber' | 'info'
  icon: string
  title: string
  desc: string
}

export interface OnboardingAnswers {
  bransch: string
  storlek: string
  roll: string
  koncern: string
}

export interface BranschNorms {
  marginWarn: number
  marginOk: number
  dsoWarn: number
  dsoAlert: number
  personalWarn: number
  avskrivningWarn: number
  label: string
}

export interface AppConfig {
  revenueFrom: number
  revenueTo: number
  excludeAccounts: number[]
  model: 'K2' | 'K3'
  bransch?: string
  roll?: string
  koncern?: string
  storlek?: string
  branschNorms?: BranschNorms
}
