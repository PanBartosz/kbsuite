const toSeconds = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

const addUniqueSeconds = (set, list, rawValue) => {
  const seconds = Number(rawValue)
  if (!Number.isFinite(seconds)) return
  const normalized = Math.max(seconds, 0)
  if (!set.has(normalized)) {
    set.add(normalized)
    list.push(normalized)
  }
}

export const cleanAnnouncements = (items) => {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null

      let raw = Array.isArray(item.timestamps)
        ? item.timestamps
        : Array.isArray(item.atSeconds)
          ? item.atSeconds
            : Array.isArray(item.at)
              ? item.at
              : [item.atSeconds ?? item.at]

      raw = Array.isArray(raw) ? raw : []

      const uniqueStart = new Set()
      const startTimestamps = []
      const uniqueOffsets = new Set()
      const offsetsFromEnd = []

      raw.forEach((value) => {
        const seconds = Number(value)
        if (!Number.isFinite(seconds)) return
        if (seconds >= 0) {
          addUniqueSeconds(uniqueStart, startTimestamps, seconds)
        } else {
          addUniqueSeconds(uniqueOffsets, offsetsFromEnd, Math.abs(seconds))
        }
      })

      if (Array.isArray(item.timestamps)) {
        item.timestamps.forEach((seconds) => addUniqueSeconds(uniqueStart, startTimestamps, seconds))
      }

      if (Array.isArray(item.offsetsFromEnd)) {
        item.offsetsFromEnd.forEach((seconds) =>
          addUniqueSeconds(uniqueOffsets, offsetsFromEnd, seconds)
        )
      }

      if (!startTimestamps.length && !offsetsFromEnd.length) return null

      const text = typeof item.text === 'string' ? item.text.trim() : ''
      if (!text) return null

      return {
        timestamps: startTimestamps,
        offsetsFromEnd,
        text,
        voice: typeof item.voice === 'string' ? item.voice : null,
        once: item.once === true
      }
    })
    .filter(Boolean)
}

const createPhase = ({
  id,
  type,
  label,
  duration,
  roundIndex,
  setIndex,
  roundId,
  setId,
  repetitionIndex,
  repetitionCount,
  metadata = {},
  announcements = []
}) => ({
  id,
  type,
  label,
  duration,
  durationSeconds: duration,
  roundIndex,
  setIndex,
  roundId,
  setId,
  repetitionIndex,
  repetitionCount,
  metadata,
  announcements,
  isSkippable: duration <= 0
})

const normalizeRepCounterMode = (value) => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'swing' || normalized === 'lockout') return normalized
  if (normalized === 'disabled') return 'disabled'
  return null
}

const normalizeRepCounterScope = (value) => (value === 'all' ? 'all' : 'work')

const normalizeBoolean = (value, defaultValue) =>
  value === true ? true : value === false ? false : defaultValue

/*
  Build a flattened timeline of workout phases (work, rest, transition, round rest).
  Each phase describes duration, human-friendly label, and reference back to the source round/set.
*/
export const buildTimeline = (plan) => {
  if (!plan || !Array.isArray(plan.rounds)) return []

  const defaultRepCounterMode = normalizeRepCounterMode(plan.defaultRepCounterMode) ?? 'disabled'
  const enableRepCounter = normalizeRepCounterScope(plan.enableRepCounter)
  const enableModeChanging = normalizeBoolean(plan.enableModeChanging, true)

  const phases = []
  let phaseIndex = 0

  const preStartSeconds = toSeconds(plan.preStartSeconds)
  if (preStartSeconds > 0) {
    phases.push(
      createPhase({
        id: `phase-${phaseIndex++}`,
        type: 'prep',
        label: plan.preStartLabel ?? 'Prepare',
        duration: preStartSeconds,
        roundIndex: -1,
        setIndex: -1,
        roundId: null,
        setId: null
      })
    )
  }

  plan.rounds.forEach((round, roundIndex) => {
    const roundId = round.id ?? `round-${roundIndex + 1}`
    const roundLabel = round.label ?? `Round ${roundIndex + 1}`
    const roundRepetitions = Math.max(Math.round(Number(round.repetitions) || 1), 1)

    for (let roundRep = 0; roundRep < roundRepetitions; roundRep += 1) {
      round.sets.forEach((set, setIndex) => {
        const setId = set.id ?? `${roundId}-set-${setIndex + 1}`
        const setLabel = set.label ?? `Set ${setIndex + 1}`
        const workSeconds = toSeconds(set.workSeconds)
        const restSeconds = toSeconds(set.restSeconds)
        const transitionSeconds = toSeconds(set.transitionSeconds)
        const repetitions = Math.max(Math.round(Number(set.repetitions) || 1), 1)
        const targetRpm = Number(set.targetRpm) || null
        const workAnnouncements = cleanAnnouncements(set.announcements)
        const restAnnouncements = cleanAnnouncements(set.restAnnouncements)
        const setMode = normalizeRepCounterMode(set.repCounterMode)
        const resolvedMode = setMode ?? defaultRepCounterMode
        const setModeChangingOverride =
          typeof set.enableModeChanging === 'boolean' ? set.enableModeChanging : null
        const resolvedModeChanging =
          setModeChangingOverride === null ? enableModeChanging : setModeChangingOverride

        const repCounterMeta = {
          repCounterMode: resolvedMode,
          enableModeChanging: resolvedModeChanging
        }

        for (let repIndex = 0; repIndex < repetitions; repIndex += 1) {
          const repLabel =
            repetitions > 1
              ? `${setLabel} · Round ${roundRep + 1} · Rep ${repIndex + 1}/${repetitions}`
              : `${setLabel} · Round ${roundRep + 1}`

          const repCounterEnabledWork =
            resolvedMode !== 'disabled' &&
            (enableRepCounter === 'all' || enableRepCounter === 'work')

          if (workSeconds > 0) {
            phases.push(
              createPhase({
                id: `phase-${phaseIndex++}`,
                type: 'work',
                label: repLabel,
                duration: workSeconds,
                roundIndex,
                setIndex,
                roundId,
                setId,
                repetitionIndex: repIndex,
                repetitionCount: repetitions,
                metadata: {
                  roundLabel,
                  setLabel,
                  targetRpm,
                  ...repCounterMeta,
                  repCounterEnabled: repCounterEnabledWork
                },
                announcements: workAnnouncements
              })
            )
          }

          const hasNextRep = repIndex < repetitions - 1
          const hasNextSet = repIndex === repetitions - 1 && setIndex < round.sets.length - 1
          const hasNextRoundCycle =
            repIndex === repetitions - 1 &&
            setIndex === round.sets.length - 1 &&
            roundRep < roundRepetitions - 1 &&
            round.restAfterSeconds <= 0
          const hasNextRoundTransition =
            repIndex === repetitions - 1 &&
            setIndex === round.sets.length - 1 &&
            roundRep === roundRepetitions - 1 &&
            roundIndex < plan.rounds.length - 1

          if (
            restSeconds > 0 &&
            (hasNextRep || hasNextSet || hasNextRoundCycle || hasNextRoundTransition)
          ) {
            const repCounterEnabledRest =
              resolvedMode !== 'disabled' && enableRepCounter === 'all'
            phases.push(
              createPhase({
                id: `phase-${phaseIndex++}`,
                type: 'rest',
                label: `Rest · ${setLabel}`,
                duration: restSeconds,
                roundIndex,
                setIndex,
                roundId,
                setId,
                repetitionIndex: repIndex,
                repetitionCount: repetitions,
                metadata: {
                  roundLabel,
                  setLabel,
                  ...repCounterMeta,
                  repCounterEnabled: repCounterEnabledRest
                },
                announcements: restAnnouncements
              })
            )
          }
        }

        if (setIndex < round.sets.length - 1 && transitionSeconds > 0) {
          const repCounterEnabledTransition =
            resolvedMode !== 'disabled' && enableRepCounter === 'all'
          phases.push(
            createPhase({
              id: `phase-${phaseIndex++}`,
              type: 'transition',
              label: `Transition · ${setLabel} → ${
                round.sets[setIndex + 1].label ?? `Set ${setIndex + 2}`
              }`,
              duration: transitionSeconds,
              roundIndex,
              setIndex,
              roundId,
              setId,
              metadata: {
                roundLabel,
                fromSetLabel: setLabel,
                toSetLabel: round.sets[setIndex + 1].label ?? `Set ${setIndex + 2}`,
                ...repCounterMeta,
                repCounterEnabled: repCounterEnabledTransition
              }
            })
          )
        }
      })

      const roundRestSeconds = toSeconds(round.restAfterSeconds)
      const isLastRoundRepetition = roundRep === roundRepetitions - 1
      const hasNextRound = roundIndex < plan.rounds.length - 1
      if (!isLastRoundRepetition && roundRestSeconds > 0) {
        phases.push(
          createPhase({
            id: `phase-${phaseIndex++}`,
            type: 'roundRest',
            label: `Round rest · ${roundLabel}`,
            duration: roundRestSeconds,
            roundIndex,
            setIndex: -1,
            roundId,
            setId: null,
            metadata: {
              roundLabel,
              repCounterMode: defaultRepCounterMode,
              repCounterEnabled: false,
              enableModeChanging
            }
          })
        )
      } else if (isLastRoundRepetition && hasNextRound && roundRestSeconds > 0) {
        phases.push(
          createPhase({
            id: `phase-${phaseIndex++}`,
            type: 'roundTransition',
            label: `Transition to ${plan.rounds[roundIndex + 1].label ?? `Round ${roundIndex + 2}`}`,
            duration: roundRestSeconds,
            roundIndex,
            setIndex: -1,
            roundId,
            setId: null,
            metadata: {
              fromRoundLabel: roundLabel,
              toRoundLabel: plan.rounds[roundIndex + 1].label ?? `Round ${roundIndex + 2}`,
              repCounterMode: defaultRepCounterMode,
              repCounterEnabled: false,
              enableModeChanging
            }
          })
        )
      }
    }
  })

  return phases.filter((phase) => phase.duration > 0)
}

export const computeTimelineDuration = (timeline) => {
  if (!Array.isArray(timeline)) return 0
  return timeline.reduce(
    (total, phase) => total + (phase.durationSeconds ?? phase.duration ?? 0),
    0
  )
}
