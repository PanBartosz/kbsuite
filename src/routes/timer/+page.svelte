<script>
  import TimerApp from '$lib/timer/TimerApp.svelte'
  import { page } from '$app/stores'

  const workoutId = $derived($page.url.searchParams.get('workout') ?? '')
</script>

<TimerApp initialWorkoutId={workoutId} />
