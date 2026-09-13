import { pool } from './index'

let ready: Promise<void> | null = null

export function ensureSchema() {
  if (!ready) ready = run().catch((error) => {
    ready = null
    throw error
  })
  return ready
}

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(user_id, name)
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      grade INTEGER NOT NULL,
      weekly_periods INTEGER NOT NULL DEFAULT 3,
      UNIQUE(user_id, name, grade)
    );
    CREATE TABLE IF NOT EXISTS ppct_tracks (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      lesson_count INTEGER NOT NULL DEFAULT 0,
      source_file TEXT,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(subject_id, type)
    );
    CREATE TABLE IF NOT EXISTS ppct_items (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      track_id INTEGER NOT NULL REFERENCES ppct_tracks(id) ON DELETE CASCADE,
      period INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      requirement TEXT NOT NULL DEFAULT '',
      warning TEXT NOT NULL DEFAULT '',
      UNIQUE(track_id, period)
    );
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      grade INTEGER NOT NULL,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, name, subject_id)
    );
    CREATE TABLE IF NOT EXISTS class_electives (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES ppct_tracks(id) ON DELETE CASCADE,
      weekly_hours INTEGER NOT NULL DEFAULT 1,
      UNIQUE(class_id, track_id)
    );
    CREATE TABLE IF NOT EXISTS timetable_slots (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      day INTEGER NOT NULL,
      session TEXT NOT NULL,
      period INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'chinh_khoa'
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      school_year TEXT NOT NULL DEFAULT '2026 – 2027',
      start_date TEXT,
      total_weeks INTEGER NOT NULL DEFAULT 35,
      teacher_name TEXT
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id TEXT NOT NULL,
      slot_id INTEGER NOT NULL REFERENCES timetable_slots(id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      week INTEGER NOT NULL,
      date TEXT NOT NULL,
      item_id INTEGER REFERENCES ppct_items(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'Bình thường',
      note TEXT,
      UNIQUE(slot_id, week)
    );
  `)
}
