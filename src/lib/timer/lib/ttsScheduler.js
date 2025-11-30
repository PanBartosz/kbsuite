export const buildAnnouncementSchedule = (phases) => {
  if (!Array.isArray(phases)) return []

  return phases.flatMap((phase, index) => {
    if (!phase || !Array.isArray(phase.announcements) || !phase.announcements.length) {
      return []
    }

    const durationSeconds = Number(phase.durationSeconds ?? phase.duration ?? 0) || 0

    return phase.announcements.flatMap((item) => {
      const fromStart = Array.isArray(item.timestamps) ? item.timestamps : []
      const fromEnd = Array.isArray(item.offsetsFromEnd) ? item.offsetsFromEnd : []

      const absoluteEvents = fromStart.map((seconds, announcementIndex) => ({
        phaseIndex: index,
        triggerMs: Math.max(Math.round(seconds * 1000), 0),
        text: item.text,
        once: item.once === true,
        voice: item.voice,
        announcementId: `${phase.id ?? index}-start-${announcementIndex}-${seconds}`
      }))

      const relativeEvents = fromEnd.map((offset, announcementIndex) => {
        const triggerSeconds = Math.max(durationSeconds - offset, 0)
        return {
          phaseIndex: index,
          triggerMs: Math.max(Math.round(triggerSeconds * 1000), 0),
          text: item.text,
          once: item.once === true,
          voice: item.voice,
          announcementId: `${phase.id ?? index}-end-${announcementIndex}-${offset}`
        }
      })

      return [...absoluteEvents, ...relativeEvents]
    })
  })
}

export const selectDueAnnouncements = ({ schedule, phaseIndex, inPhaseElapsedMs, triggeredCache }) => {
  if (!Array.isArray(schedule) || phaseIndex < 0) return []

  return schedule.filter((event) => {
    if (event.phaseIndex !== phaseIndex) return false
    if (triggeredCache.has(event.announcementId)) return false
    return event.triggerMs <= inPhaseElapsedMs
  })
}
