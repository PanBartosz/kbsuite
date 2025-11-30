<script>
  import TimerApp from '$lib/timer/TimerApp.svelte'
  import { page } from '$app/stores'

  const workoutId = $derived($page.url.searchParams.get('workout') ?? '')
  const plannedId = $derived($page.url.searchParams.get('planned') ?? '')
</script>

<TimerApp initialWorkoutId={workoutId} initialPlannedId={plannedId} />
