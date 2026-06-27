<script lang="ts">
  import { onMount } from 'svelte'

  let username = ''
  let password = ''
  let mode: 'login' | 'register' = 'login'
  let status = ''
  let error = ''
  let userId: string | null = null
  let usernameCurrent: string | null = null
  let isAnonymous = true
  let tokenName = ''
  let apiTokens: {
    id: string
    name: string
    token_prefix: string
    created_at: number | null
    last_used_at: number | null
  }[] = []
  let generatedToken = ''
  let tokenStatus = ''
  let tokenError = ''

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
      isAnonymous = data?.isAnonymous !== false
      if (!isAnonymous) {
        await loadApiTokens()
      } else {
        apiTokens = []
      }
    } catch {
      userId = null
      usernameCurrent = null
      isAnonymous = true
      apiTokens = []
    }
  }

  const loadApiTokens = async () => {
    tokenError = ''
    try {
      const res = await fetch('/api/api-tokens')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load API tokens')
      apiTokens = Array.isArray(data?.items) ? data.items : []
    } catch (err) {
      tokenError = (err as any)?.message ?? 'Failed to load API tokens'
    }
  }

  const createApiToken = async () => {
    tokenStatus = ''
    tokenError = ''
    generatedToken = ''
    try {
      const res = await fetch('/api/api-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tokenName })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create API token')
      generatedToken = data?.token ?? ''
      tokenStatus = 'API token created.'
      tokenName = ''
      await loadApiTokens()
    } catch (err) {
      tokenError = (err as any)?.message ?? 'Failed to create API token'
    }
  }

  const revokeApiToken = async (id: string) => {
    tokenStatus = ''
    tokenError = ''
    try {
      const res = await fetch(`/api/api-tokens/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to revoke API token')
      tokenStatus = 'API token revoked.'
      if (apiTokens.some((token) => token.id === id && generatedToken.startsWith(token.token_prefix))) {
        generatedToken = ''
      }
      await loadApiTokens()
    } catch (err) {
      tokenError = (err as any)?.message ?? 'Failed to revoke API token'
    }
  }

  const copyGeneratedToken = async () => {
    if (!generatedToken) return
    tokenStatus = ''
    tokenError = ''
    try {
      await navigator.clipboard.writeText(generatedToken)
      tokenStatus = 'API token copied.'
    } catch {
      tokenError = 'Copy failed.'
    }
  }

  const formatDate = (value: number | null) => {
    if (!value) return 'Never'
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
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

  {#if userId && !isAnonymous}
    <section class="card api-card">
      <header class="card-header">
        <div>
          <h2>API tokens</h2>
          <p class="muted small">Use bearer tokens with `/api/v1` integrations.</p>
        </div>
        <button class="secondary" type="button" on:click={loadApiTokens}>Refresh</button>
      </header>

      <div class="token-create">
        <label>
          <span>Token name</span>
          <input bind:value={tokenName} placeholder="Hermes" />
        </label>
        <button class="primary" type="button" on:click={createApiToken}>Generate token</button>
      </div>

      {#if generatedToken}
        <div class="token-once">
          <label>
            <span>New token</span>
            <input readonly value={generatedToken} />
          </label>
          <button class="secondary" type="button" on:click={copyGeneratedToken}>Copy</button>
        </div>
      {/if}

      {#if tokenStatus}<p class="status">{tokenStatus}</p>{/if}
      {#if tokenError}<p class="error">{tokenError}</p>{/if}

      {#if apiTokens.length}
        <ul class="token-list">
          {#each apiTokens as token (token.id)}
            <li>
              <div>
                <strong>{token.name}</strong>
                <span class="muted small">{token.token_prefix}…</span>
                <span class="muted small">Created {formatDate(token.created_at)}</span>
                <span class="muted small">Last used {formatDate(token.last_used_at)}</span>
              </div>
              <button class="danger" type="button" on:click={() => revokeApiToken(token.id)}>
                Revoke
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">No active API tokens.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .auth-page {
    max-width: 760px;
    width: min(760px, 100%);
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
  .card-header,
  .token-create,
  .token-once,
  .token-list li {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    justify-content: space-between;
  }
  .card-header {
    align-items: flex-start;
  }
  .card-header h2,
  .card-header p {
    margin: 0;
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
  .secondary,
  .danger {
    padding: 0.55rem 0.7rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .danger {
    color: var(--color-danger-soft);
    border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border));
  }
  .api-card {
    gap: 1rem;
  }
  .token-create label,
  .token-once label {
    flex: 1;
  }
  .token-once input {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.9rem;
  }
  .token-list {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .token-list li {
    align-items: center;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    border-radius: 10px;
    padding: 0.7rem;
  }
  .token-list li div {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.7rem;
    align-items: baseline;
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
  @media (max-width: 640px) {
    .card-header,
    .token-create,
    .token-once,
    .token-list li {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
