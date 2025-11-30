<section class="panel">
	<h1>KB Suite</h1>
	<div class="cards">
		<a class="card" href="/timer">
			<h3>Timer</h3>
		</a>
		<a class="card" href="/counter">
			<h3>Rep Counter</h3>
		</a>
		<a class="card" href="/big-picture">
			<h3>Big Picture</h3>
		</a>
		<a class="card" href="/workouts">
			<h3>Workouts</h3>
		</a>
		<a class="card" href="/history">
			<h3>History</h3>
		</a>
		<a class="card" href="/auth">
			<h3>Account</h3>
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
		text-decoration: none;
	}

	.card:hover {
		transform: translateY(-2px);
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-surface-1) 85%, transparent);
	}

	h3 {
		margin: 0;
	}
	p {
		margin: 0;
	}
</style>
