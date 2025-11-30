<section class="panel">
	<div class="panel-head">
		<div>
			<p class="eyebrow">KB Suite</p>
			<h1>Pick a mode</h1>
			<p class="hint">Timer for intervals, Rep Counter for camera-based reps, or Big Picture to run both together.</p>
		</div>
	</div>
	<div class="cards">
		<a class="card" href="/timer">
			<h3>Timer</h3>
			<p>YAML-first interval builder with metronome, announcements, and saved workouts.</p>
			<span>Open timer →</span>
		</a>
		<a class="card" href="/counter">
			<h3>Rep Counter</h3>
			<p>Pose-detection camera overlay that counts swings and lockouts with gesture controls.</p>
			<span>Open counter →</span>
		</a>
		<a class="card" href="/big-picture">
			<h3>Big Picture</h3>
			<p>Combined timer + rep counter view for large screens and full-session tracking.</p>
			<span>Open big picture →</span>
		</a>
		<a class="card" href="/workouts">
			<h3>Workouts</h3>
			<p>Browse templates and your saved YAML workouts. Start in Timer or Big Picture.</p>
			<span>Go to workouts →</span>
		</a>
		<a class="card" href="/history">
			<h3>History</h3>
			<p>Review completed sessions, edit notes/RPE, and copy plans to start again.</p>
			<span>View history →</span>
		</a>
		<a class="card" href="/auth">
			<h3>Account</h3>
			<p>Manage login and sync settings across devices.</p>
			<span>Open account →</span>
		</a>
	</div>
</section>

<style>
	h1 {
		margin: 0;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1rem;
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-surface-2) 85%, transparent);
		color: var(--color-text-primary);
		transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
	}

	.card:hover {
		transform: translateY(-2px);
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-surface-1) 85%, transparent);
	}

	.card span {
		color: var(--color-accent-soft);
		font-weight: 700;
	}
	h3 {
		margin: 0;
	}
	p {
		margin: 0;
	}
</style>
