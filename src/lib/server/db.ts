import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { libraryTemplates } from '$lib/timer/library/index.js'
import YAML from 'yaml'

let db: Database.Database | null = null

const dataDir = path.join(process.cwd(), 'data')
const dbFile = path.join(dataDir, 'kb_suite.db')

const ensureDir = () => {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

const initDb = () => {
  ensureDir()
  db = new Database(dbFile)
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      password_hash TEXT,
      salt TEXT,
      is_anonymous INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workouts (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      yaml_source TEXT,
      plan_json TEXT,
      updated_at INTEGER NOT NULL,
      is_template INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS completed_workouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workout_id TEXT,
      title TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      duration_s INTEGER,
      notes TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS completed_sets (
      id TEXT PRIMARY KEY,
      completed_workout_id TEXT NOT NULL,
      phase_index INTEGER,
      position INTEGER,
      round_label TEXT,
      set_label TEXT,
      reps REAL,
      weight REAL,
      duration_s REAL,
      type TEXT,
      auto_filled INTEGER,
      FOREIGN KEY (completed_workout_id) REFERENCES completed_workouts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workouts_owner ON workouts(owner_id);
    CREATE INDEX IF NOT EXISTS idx_completed_user ON completed_workouts(user_id);
    CREATE INDEX IF NOT EXISTS idx_completed_sets_workout ON completed_sets(completed_workout_id);
  `)
  migrateUsersTable()
  migrateCompletedSets()
  migrateCompletedWorkouts()
  seedTemplates()
}

export const getDb = () => {
  if (!db) {
    initDb()
  }
  return db!
}

const migrateUsersTable = () => {
  const database = db!
  const columns = database.prepare('PRAGMA table_info(users)').all() as { name: string }[]
  const names = new Set(columns.map((c) => c.name))
  if (!names.has('username')) {
    database.prepare('ALTER TABLE users ADD COLUMN username TEXT').run()
  }
  if (!names.has('password_hash')) {
    database.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run()
  }
  if (!names.has('salt')) {
    database.prepare('ALTER TABLE users ADD COLUMN salt TEXT').run()
  }
  if (!names.has('is_anonymous')) {
    database.prepare('ALTER TABLE users ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 1').run()
    database.prepare('UPDATE users SET is_anonymous = 1 WHERE is_anonymous IS NULL').run()
  }
}

const migrateCompletedSets = () => {
  const database = db!
  const columns = database.prepare('PRAGMA table_info(completed_sets)').all() as { name: string }[]
  const names = new Set(columns.map((c) => c.name))
  if (!names.has('duration_s')) {
    database.prepare('ALTER TABLE completed_sets ADD COLUMN duration_s REAL').run()
  }
  if (!names.has('type')) {
    database.prepare('ALTER TABLE completed_sets ADD COLUMN type TEXT').run()
    database.prepare('UPDATE completed_sets SET type = "work" WHERE type IS NULL').run()
  }
  if (!names.has('rpe')) {
    database.prepare('ALTER TABLE completed_sets ADD COLUMN rpe INTEGER').run()
  }
}

const migrateCompletedWorkouts = () => {
  const database = db!
  const columns = database
    .prepare('PRAGMA table_info(completed_workouts)')
    .all() as { name: string }[]
  const names = new Set(columns.map((c) => c.name))
  if (!names.has('rpe')) {
    database.prepare('ALTER TABLE completed_workouts ADD COLUMN rpe INTEGER').run()
  }
  if (!names.has('notes')) {
    database.prepare('ALTER TABLE completed_workouts ADD COLUMN notes TEXT').run()
  }
  if (!names.has('tags')) {
    database.prepare('ALTER TABLE completed_workouts ADD COLUMN tags TEXT').run()
    database.prepare('UPDATE completed_workouts SET tags = "[]" WHERE tags IS NULL').run()
  }
}

const defaultSettings = () => ({
  theme: 'dark',
  timer: {
    ttsEnabled: false,
    enableMetronome: false,
    notificationsEnabled: false,
    audioEnabled: true,
    openAiVoice: 'alloy'
  },
  counter: {
    lowFpsMode: false,
    voiceEnabled: false,
    debugOverlay: false,
    voiceSelected: 'alloy'
  }
})

const hashPassword = (password: string, salt: string) => {
  const derived = crypto.scryptSync(password, salt, 64)
  return derived.toString('hex')
}

export const createUserWithPassword = (username: string, password: string) => {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) {
    throw new Error('Username already taken')
  }
  const id = crypto.randomUUID()
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = hashPassword(password, salt)
  db.prepare(
    `INSERT INTO users (id, username, password_hash, salt, is_anonymous, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(id, username, passwordHash, salt, Date.now())
  return id
}

export const verifyUserPassword = (username: string, password: string): string | null => {
  const db = getDb()
  const row = db
    .prepare('SELECT id, password_hash, salt FROM users WHERE username = ?')
    .get(username) as { id: string; password_hash: string; salt: string } | undefined
  if (!row) return null
  const candidate = hashPassword(password, row.salt)
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(row.password_hash))
    ? row.id
    : null
}

const createAnonymousUser = () => {
  const id = crypto.randomUUID()
  getDb()
    .prepare(
      `INSERT INTO users (id, is_anonymous, created_at)
       VALUES (?, 1, ?)`
    )
    .run(id, Date.now())
  return id
}

const createSession = (userId: string, days = 365) => {
  const token = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = now + days * 24 * 60 * 60 * 1000
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, now, expiresAt)
  return { token, userId }
}

const getSession = (token: string) => {
  return getDb()
    .prepare('SELECT token, user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { token: string; user_id: string; expires_at: number } | undefined
}

const getUserInfo = (userId: string) => {
  return getDb()
    .prepare('SELECT id, username, is_anonymous FROM users WHERE id = ?')
    .get(userId) as { id: string; username?: string; is_anonymous?: number } | undefined
}

export const ensureSessionUser = (token?: string) => {
  const now = Date.now()
  if (token) {
    const existing = getSession(token)
    if (existing && existing.expires_at > now) {
      const user = getUserInfo(existing.user_id)
      return {
        userId: existing.user_id,
        token: existing.token,
        username: user?.username ?? null,
        isAnonymous: user?.is_anonymous === 1 || user?.is_anonymous === undefined
      }
    }
  }
  const userId = createAnonymousUser()
  const session = createSession(userId)
  return { ...session, username: null, isAnonymous: true }
}

export const createSessionForUser = (userId: string) => createSession(userId)

export const deleteSession = (token: string) => {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

const seedTemplates = () => {
  const database = getDb()
  const insert = database.prepare(
    `INSERT OR IGNORE INTO workouts (id, owner_id, name, description, yaml_source, plan_json, updated_at, is_template)
     VALUES (@id, NULL, @name, @description, @yaml_source, @plan_json, @updated_at, 1)`
  )

  libraryTemplates.forEach((template) => {
    try {
      const source = (template?.source ?? '').trim()
      if (!source) return
      const parsed = YAML.parse(source)
      insert.run({
        id: template?.id ?? crypto.randomUUID(),
        name: parsed?.title ?? 'Template workout',
        description: parsed?.description ?? '',
        yaml_source: source,
        plan_json: JSON.stringify(parsed ?? {}),
        updated_at: Date.now()
      })
    } catch (err) {
      console.warn('Failed to seed template', template?.id, err)
    }
  })
}

export const getSettingsForUser = (userId: string) => {
  const row = getDb()
    .prepare('SELECT data FROM settings WHERE user_id = ?')
    .get(userId) as { data: string } | undefined
  if (!row) return defaultSettings()
  try {
    return { ...defaultSettings(), ...JSON.parse(row.data) }
  } catch {
    return defaultSettings()
  }
}

export const saveSettingsForUser = (userId: string, data: any) => {
  const db = getDb()
  const payload = JSON.stringify(data ?? defaultSettings())
  db.prepare(
    `INSERT INTO settings (user_id, data, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(userId, payload, Date.now())
}
