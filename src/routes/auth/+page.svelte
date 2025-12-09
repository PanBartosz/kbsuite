<script lang="ts">
  import { onMount } from 'svelte'

  let username = ''
  let password = ''
  let mode: 'login' | 'register' = 'login'
  let status = ''
  let error = ''
  let userId: string | null = null
  let usernameCurrent: string | null = null

  const submit = async () => {
    status = ''
    error = ''
    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error ?? 'Request failed')
      }
      userId = data?.userId ?? null
      usernameCurrent = data?.username ?? null
      status = mode === 'login' ? 'Logged in.' : 'Account created.'
      await fetchSession()
    } catch (err) {
      error = (err as any)?.message ?? 'Request failed'
    }
  }

  const fetchSession = async () => {
    try {
      const res = await fetch('/api/session')
      const data = await res.json().catch(() => ({}))
      userId = data?.userId ?? null
      usernameCurrent = data?.username ?? null
    } catch {
      userId = null
      usernameCurrent = null
    }
  }

  onMount(fetchSession)
</script>

<div class="auth-page">
  <header>
    <h1>Account</h1>
    <p>Register or log in with username/password.</p>
  </header>

  <div class="card">
    <div class="tabs">
      <button class:active={mode === 'login'} on:click={() => (mode = 'login')}>Login</button>
      <button class:active={mode === 'register'} on:click={() => (mode = 'register')}>Register</button>
    </div>

    <label>
      <span>Username</span>
      <input bind:value={username} placeholder="yourname" />
    </label>
    <label>
      <span>Password</span>
      <input type="password" bind:value={password} placeholder="••••••••" />
    </label>
    <button class="primary" on:click={submit} disabled={!username || !password}>
      {mode === 'login' ? 'Login' : 'Register'}
    </button>
    {#if status}<p class="status">{status}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
    {#if userId}
      <p class="muted small">
        Current user: {usernameCurrent ? usernameCurrent : userId}
        {#if usernameCurrent && usernameCurrent !== userId}
          <span class="muted small">(id {userId})</span>
        {/if}
      </p>
    {/if}
  </div>
</div>

<style>
  .auth-page {
    max-width: 520px;
    width: min(520px, 100%);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  header h1 {
    margin: 0;
  }
  .card {
    border: 1px solid var(--color-border);
    background: var(--color-surface-2);
    border-radius: 14px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  input {
    padding: 0.55rem 0.7rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .primary {
    padding: 0.65rem;
    border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    cursor: pointer;
  }
  .tabs {
    display: inline-flex;
    gap: 0.35rem;
  }
  .tabs button {
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    padding: 0.45rem 0.75rem;
    border-radius: 10px;
    cursor: pointer;
  }
  .tabs button.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .status {
    color: var(--color-success);
  }
  .error {
    color: var(--color-danger);
  }
  .muted {
    color: var(--color-text-muted);
  }
  .small {
    font-size: 0.9rem;
  }
</style>
