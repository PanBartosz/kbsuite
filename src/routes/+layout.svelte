<script lang="ts">
 import '../app.css';
 	import favicon from '$lib/assets/favicon.svg';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import ToastStack from '$lib/components/ToastStack.svelte';
	import { openSettingsModal } from '$lib/stores/settings';
	import WorkoutSummaryModal from '$lib/stats/WorkoutSummaryModal.svelte';
	import { loadPendingCount, shares } from '$lib/stores/shares';
	import { pushToast } from '$lib/stores/toasts';
	import {
		clearSummaryDraft,
		closeSummaryModal,
		openSummaryModal,
		setSummaryEntries,
		summaryEntries,
		summaryMetadata,
		summaryModalOpen
	} from '$lib/stats/summaryStore';
	import { onMount } from 'svelte';

	let { children } = $props();
	let menuOpen = $state(false);
	let pendingShareCount = $state(0);

	shares.subscribe((value) => {
		pendingShareCount = value.count ?? 0;
	});

	const openSettings = () => {
		openSettingsModal();
		menuOpen = false;
	};
	const openSummary = () => {
		openSummaryModal();
		menuOpen = false;
	};
	const toggleMenu = () => (menuOpen = !menuOpen);
	const closeMenu = () => (menuOpen = false);

	const handleSummaryClose = (event: CustomEvent<{ entries: any[] }>) => {
		const nextEntries = event?.detail?.entries;
		if (Array.isArray(nextEntries)) {
			setSummaryEntries(nextEntries);
		}
		closeSummaryModal();
	};

	onMount(() => {
		// ensure session cookie exists
		fetch('/api/session').catch(() => {});
		loadPendingCount();

		if ('serviceWorker' in navigator) {
			navigator.serviceWorker
				.register('/service-worker.js', { type: 'module' })
				.catch((err) => {
					console.warn('Service worker registration failed', err);
				});
		}
	});

	const saveCompleted = async (entries: any[]): Promise<string | null> => {
		const meta = $summaryMetadata ?? {};
		if (!entries?.length) return null;
		try {
			const res = await fetch('/api/completed-workouts', {
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
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data?.error ?? 'Failed to save workout');
			}
			const id = data?.item?.id ? String(data.item.id) : '';
			pushToast('Workout saved.', 'success', 3200, {
				label: 'Open history',
				onClick: () => {
					if (id) {
						window.location.href = `/history#cw-${encodeURIComponent(id)}`;
						return;
					}
					window.location.href = '/history';
				}
			});
			return id || null;
		} catch (err) {
			console.warn('Failed to save completed workout', err);
			pushToast((err as any)?.message ?? 'Failed to save workout', 'error');
			return null;
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
	<button class="menu-toggle" type="button" onclick={toggleMenu}>
		<span class="sr-only">Toggle navigation</span>
		<div class="menu-icon" aria-hidden="true">
			<span></span>
			<span></span>
			<span></span>
		</div>
	</button>
	<nav class:open={menuOpen}>
		<a href="/" onclick={closeMenu}>Home</a>
		<a href="/plan" onclick={closeMenu}>
			Planner
			{#if pendingShareCount > 0}
				<span class="pill">{pendingShareCount}</span>
			{/if}
		</a>
		<a href="/timer" onclick={closeMenu}>Timer</a>
		<a href="/counter" onclick={closeMenu}>Rep Counter</a>
		<a href="/big-picture" onclick={closeMenu}>Big Picture</a>
		<a href="/workouts" onclick={closeMenu}>Workouts</a>
		<a href="/history" onclick={closeMenu}>History</a>
		<a href="/auth" onclick={closeMenu}>Account</a>
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
		on:close={handleSummaryClose}
		on:save={(event) => {
			const nextEntries = event.detail?.entries ?? [];
			setSummaryEntries(nextEntries);
			closeSummaryModal();
			saveCompleted(nextEntries).then((id) => {
				if (id) clearSummaryDraft();
			});
		}}
	/>
	<ToastStack />
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
		flex-wrap: wrap;
	}

	nav a {
		color: var(--color-text-primary);
		padding: 0.4rem 0.65rem;
		border-radius: 10px;
		border: 1px solid transparent;
		transition: border-color 120ms ease, background 120ms ease;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
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
	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		border-radius: 999px;
		background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
		color: var(--color-text-inverse);
		font-size: 0.8rem;
		padding: 0 0.4rem;
	}

	@media (max-width: 720px) {
		.topbar {
			flex-direction: column;
			align-items: stretch;
			gap: 0.5rem;
		}

		.menu-toggle {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: 0.5rem;
			border-radius: 10px;
			border: 1px solid var(--color-border);
			background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
			color: var(--color-text-primary);
		}

		.menu-icon {
			display: flex;
			flex-direction: column;
			gap: 5px;
		}

		.menu-icon span {
			display: block;
			width: 20px;
			height: 2px;
			background: currentColor;
		}

		nav {
			width: 100%;
			flex-direction: column;
			align-items: flex-start;
			gap: 0.35rem;
			padding: 0.5rem 0;
			border-top: 1px solid var(--color-border);
			display: none;
		}

		nav.open {
			display: flex;
		}

		nav a,
		.settings-btn {
			padding: 0.45rem 0.65rem;
			font-size: 0.95rem;
			white-space: nowrap;
			width: 100%;
			text-align: left;
		}
	}

	@media (min-width: 721px) {
		.menu-toggle {
			display: none;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}
</style>
