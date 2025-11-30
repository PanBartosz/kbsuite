<script lang="ts">
 import '../app.css';
 	import favicon from '$lib/assets/favicon.svg';
 	import SettingsModal from '$lib/components/SettingsModal.svelte';
 	import { openSettingsModal } from '$lib/stores/settings';
	import WorkoutSummaryModal from '$lib/stats/WorkoutSummaryModal.svelte';
	import {
		closeSummaryModal,
		openSummaryModal,
		setSummaryEntries,
		summaryEntries,
		summaryMetadata,
		summaryModalOpen
	} from '$lib/stats/summaryStore';
	import { onMount } from 'svelte';

 	let { children } = $props();

 	const openSettings = () => openSettingsModal();
	const openSummary = () => openSummaryModal();

	onMount(() => {
		// ensure session cookie exists
		fetch('/api/session').catch(() => {});
	});

	const saveCompleted = async (entries: any[]) => {
		const meta = $summaryMetadata ?? {};
		if (!entries?.length) return;
		try {
			await fetch('/api/completed-workouts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					workoutId: meta.workoutId ?? null,
					title: meta.title ?? 'Workout',
					startedAt: meta.startedAt ?? null,
					finishedAt: meta.finishedAt ?? Date.now(),
					durationSeconds: meta.durationSeconds ?? null,
					entries
				})
			});
		} catch (err) {
			console.warn('Failed to save completed workout', err);
		}
	};
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link
		rel="stylesheet"
		href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css"
	/>
</svelte:head>

<div class="app-shell">
	<header class="topbar">
		<div class="brand">
			<span class="dot"></span>
			<div>
				<p class="eyebrow">KB Suite</p>
			</div>
		</div>
		<nav>
			<a href="/">Home</a>
			<a href="/plan">Planner</a>
			<a href="/timer">Timer</a>
			<a href="/counter">Rep Counter</a>
			<a href="/big-picture">Big Picture</a>
			<a href="/workouts">Workouts</a>
			<a href="/history">History</a>
			<a href="/auth">Account</a>
			<button class="settings-btn" type="button" onclick={openSummary}>
				Summary
			</button>
			<button class="settings-btn" type="button" onclick={openSettings}>
				Settings
			</button>
		</nav>
	</header>

	<main class="page">{@render children()}</main>
	<SettingsModal />
	<WorkoutSummaryModal
		open={$summaryModalOpen}
		entries={$summaryEntries}
		on:close={closeSummaryModal}
		on:save={(event) => {
			const nextEntries = event.detail?.entries ?? [];
			setSummaryEntries(nextEntries);
			saveCompleted(nextEntries);
			closeSummaryModal();
		}}
	/>
</div>

<style>
	.app-shell {
		min-height: 100vh;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		position: sticky;
		top: 0;
		z-index: 100;
		background: color-mix(in srgb, var(--color-surface-1) 85%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--color-border);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.65rem;
		color: var(--color-text-primary);
	}

	.brand .dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: linear-gradient(135deg, #0ea5e9, #22c55e);
		box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-accent) 25%, transparent);
	}

	nav {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		font-weight: 600;
	}

	nav a {
		color: var(--color-text-primary);
		padding: 0.4rem 0.65rem;
		border-radius: 10px;
		border: 1px solid transparent;
		transition: border-color 120ms ease, background 120ms ease;
	}

	nav a:hover {
		border-color: var(--color-border-hover);
		background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
	}

	.settings-btn {
		background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
		color: var(--color-text-inverse);
		border: none;
		padding: 0.4rem 0.8rem;
		border-radius: 10px;
		cursor: pointer;
		font-weight: 700;
	}
	.settings-btn:hover {
		transform: translateY(-1px);
	}

	@media (max-width: 720px) {
		.topbar {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.35rem;
		}

		nav {
			flex-wrap: wrap;
		}
	}
</style>
