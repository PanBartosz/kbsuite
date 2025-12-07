export type ExerciseCategory = 'Hinge' | 'Push' | 'Pull' | 'Squat' | 'Carry' | 'Core' | 'Other'

const SKIP_PATTERNS = [
  /warm[-\s]?up/i,
  /cool[-\s]?down/i,
  /\btransition\b/i,
  /\bprep\b/i,
  /\bstanding\b/i,
  /\brest\b/i,
  /\bnext round\b/i
]

const combos: { match: RegExp; cats: ExerciseCategory[] }[] = [
  // Classic kettlebell sport long cycle (clean + jerk)
  { match: /long\s*cycle|clean\s+and\s+jerk/i, cats: ['Hinge', 'Pull', 'Push', 'Squat'] },
  // Snatch/half snatch: count as hinge only
  { match: /half\s*snatch|snatch/i, cats: ['Hinge'] },
  // Jerks: dip/drive + receive (push + squat)
  { match: /jerk/i, cats: ['Push', 'Squat'] },
  // Bumps: treat as squat-dominant (no push)
  { match: /bump/i, cats: ['Squat'] }
]

const keywords: Record<ExerciseCategory, RegExp[]> = {
  Hinge: [/swing/i, /\bhinge\b/i, /\bdead\b/i],
  Push: [/press/i, /push\s*press/i, /strict/i, /dip\b/i],
  Pull: [/row\b/i, /pull\b/i, /chin/i, /clean/i, /upright/i],
  Squat: [/squat/i, /lunge/i, /split\s*squat/i, /step\s*up/i, /pistol/i],
  Carry: [/carry/i, /walk\b/i, /farmer/i, /suitcase/i, /rack\s*walk/i, /march/i],
  Core: [/ab\b/i, /\bcore\b/i, /roller/i, /plank/i, /hollow/i, /get[-\s]?up|tgu/i, /windmill/i, /sit\s*up/i],
  Other: []
}

const normalize = (value?: string | null) => {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[·/]/g, ' ')
    .replace(/\b\d+:\d+\b/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const categorizeExercise = (label?: string | null, roundLabel?: string | null): Set<ExerciseCategory> => {
  const norm = normalize([label, roundLabel].filter(Boolean).join(' '))
  if (!norm) return new Set<ExerciseCategory>(['Other'])
  if (SKIP_PATTERNS.some((pat) => pat.test(norm))) return new Set<ExerciseCategory>()

  const cats = new Set<ExerciseCategory>()

  combos.forEach(({ match, cats: list }) => {
    if (match.test(norm)) {
      list.forEach((c) => cats.add(c))
    }
  })

  Object.entries(keywords).forEach(([cat, regs]) => {
    if (regs.some((r) => r.test(norm))) {
      cats.add(cat as ExerciseCategory)
    }
  })

  if (!cats.size) cats.add('Other')
  return cats
}
