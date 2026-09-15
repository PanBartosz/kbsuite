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
	import { page } from '$app/state';
	import ActionMenu from '$lib/components/ActionMenu.svelte';

	let { children } = $props();
	let menuOpen = $state(false);
	let pendingShareCount = $derived($shares.count ?? 0);
	let trainActive = $derived(['/timer', '/counter', '/big-picture'].includes(page.url.pathname));

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
		const outside = (event: PointerEvent) => {
			if (!(event.target as HTMLElement).closest('.topbar')) closeMenu();
		};
		document.addEventListener('pointerdown', outside);
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
		return () => document.removeEventListener('pointerdown', outside);
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
						plannedWorkoutId: meta.plannedWorkoutId ?? null,
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

<svelte:window onkeydown={(event) => {
	if (event.key === 'Escape' && menuOpen && !event.defaultPrevented) {
		closeMenu();
		document.querySelector<HTMLButtonElement>('.menu-toggle')?.focus();
	}
}} />

<div class="app-shell">
	<header class="topbar">
	<a class="brand" href="/" onclick={closeMenu} aria-label="KB Suite home">
		<span class="dot" aria-hidden="true"></span>
		<span class="brand-name">KB Suite</span>
	</a>
	<button class="menu-toggle" type="button" onclick={toggleMenu} aria-expanded={menuOpen} aria-controls="main-navigation">
		<span class="sr-only">Toggle navigation</span>
		<span class="menu-icon" aria-hidden="true"><span></span><span></span><span></span></span>
	</button>
	<nav id="main-navigation" aria-label="Main navigation" class:open={menuOpen}>
		<a href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined} onclick={closeMenu}>Home</a>
		<a href="/plan" aria-current={page.url.pathname === '/plan' ? 'page' : undefined} onclick={closeMenu}>
			Planner
			{#if pendingShareCount > 0}<span class="pill">{pendingShareCount}</span>{/if}
		</a>
		<a href="/programs" aria-current={page.url.pathname === '/programs' ? 'page' : undefined} onclick={closeMenu}>Programs</a>
		<a href="/workouts" aria-current={page.url.pathname === '/workouts' ? 'page' : undefined} onclick={closeMenu}>Workouts</a>
		<a href="/history" aria-current={page.url.pathname === '/history' ? 'page' : undefined} onclick={closeMenu}>History</a>
		<div class="train-nav" class:active={trainActive}>
			<ActionMenu label="Train">
				<a href="/timer" aria-current={page.url.pathname === '/timer' ? 'page' : undefined} onclick={closeMenu}>Timer</a>
				<a href="/counter" aria-current={page.url.pathname === '/counter' ? 'page' : undefined} onclick={closeMenu}>Rep Counter</a>
				<a href="/big-picture" aria-current={page.url.pathname === '/big-picture' ? 'page' : undefined} onclick={closeMenu}>Big Picture</a>
				{#if $summaryEntries.length > 0}<button type="button" onclick={openSummary}>Workout summary</button>{/if}
			</ActionMenu>
		</div>
		<div class="nav-utilities">
			<a href="/auth" aria-current={page.url.pathname === '/auth' ? 'page' : undefined} onclick={closeMenu}>Account</a>
			<button class="settings-btn" type="button" onclick={openSettings}>Settings</button>
		</div>
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
		z-index: 9;
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
		gap: 0.2rem;
		font-weight: 600;
		flex-wrap: nowrap;
	}

	.brand-name { font-weight: 700; white-space: nowrap; }
	.nav-utilities { display: flex; align-items: center; gap: 0.2rem; margin-left: 0.65rem; padding-left: 0.65rem; border-left: 1px solid var(--color-border); }
	.nav-utilities a { color: var(--color-text-muted); }
	.settings-btn, nav a { min-height: 44px; }
	nav a[aria-current="page"], .train-nav.active :global(summary) {
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-1));
		border-color: var(--color-accent);
		color: var(--color-text-primary);
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
		background: transparent;
		color: var(--color-text-muted);
		border: 1px solid transparent;
		padding: 0.4rem 0.8rem;
		border-radius: 10px;
		cursor: pointer;
		font-weight: 700;
	}
	.settings-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-surface-2);
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

	@media (max-width: 900px), (max-height: 600px) and (max-width: 1200px) {
		.topbar {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.5rem;
			padding: 0.35rem 0.75rem;
			background: var(--color-surface-1);
			backdrop-filter: none;
		}

		.menu-toggle {
			min-width: 48px;
			min-height: 48px;
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

		nav { max-height: calc(100dvh - 64px); overflow-y: auto; }
		.nav-utilities { width: 100%; margin: 0.35rem 0 0; padding: 0.5rem 0 0; border-left: 0; border-top: 1px solid var(--color-border); }
		.train-nav { width: 100%; }
		.train-nav :global(.action-options) { position: static; width: 100%; max-width: none; box-shadow: none; margin-top: 0.3rem; }
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

	@media (min-width: 901px) and (min-height: 601px), (min-width: 1201px) {
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
