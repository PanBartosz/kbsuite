export type NotesTemplate = {
  id: string
  label: string
  body: string
}

export const defaultNotesTemplates = (): NotesTemplate[] => [
  {
    id: 'kb_comp',
    label: 'KB sport — competition set debrief',
    body: [
      '## Goal',
      '- ',
      '',
      '## Main set (competition)',
      '- Event: ',
      '- Load: ',
      '- Target: ',
      '- Actual: ',
      '- Splits: ',
      '',
      '## Pacing / breathing',
      '- ',
      '',
      '## Technique cues',
      '- ',
      '',
      '## Grip/forearms',
      '- ',
      '',
      '## Recovery / readiness (next 24h)',
      '- Sleep:',
      '- Soreness:',
      '- HR/RPE notes:',
      '',
      '## Next time',
      '- Keep:',
      '- Change:',
      '- '
    ].join('\n')
  },
  {
    id: 'kb_week',
    label: 'KB sport — weekly review',
    body: [
      '## Week focus',
      '- ',
      '',
      '## Key sessions',
      '- ',
      '',
      '## Trends',
      '- [ ] pacing',
      '- [ ] grip',
      '- [ ] overhead lockout',
      '- [ ] breathing / HR drift',
      '',
      '## Recovery',
      '- ',
      '',
      '## Adjustments',
      '- '
    ].join('\n')
  },
  { id: 'blank', label: 'Blank', body: '' }
]

