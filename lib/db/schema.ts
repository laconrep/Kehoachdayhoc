import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const user = pgTable('user', { id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(), emailVerified: boolean('emailVerified').notNull().default(false), image: text('image'), createdAt: timestamp('createdAt').notNull().defaultNow(), updatedAt: timestamp('updatedAt').notNull().defaultNow() })
export const session = pgTable('session', { id: text('id').primaryKey(), expiresAt: timestamp('expiresAt').notNull(), token: text('token').notNull().unique(), createdAt: timestamp('createdAt').notNull().defaultNow(), updatedAt: timestamp('updatedAt').notNull().defaultNow(), ipAddress: text('ipAddress'), userAgent: text('userAgent'), userId: text('userId').notNull() })
export const account = pgTable('account', { id: text('id').primaryKey(), accountId: text('accountId').notNull(), providerId: text('providerId').notNull(), userId: text('userId').notNull(), accessToken: text('accessToken'), refreshToken: text('refreshToken'), idToken: text('idToken'), accessTokenExpiresAt: timestamp('accessTokenExpiresAt'), refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'), scope: text('scope'), password: text('password'), createdAt: timestamp('createdAt').notNull().defaultNow(), updatedAt: timestamp('updatedAt').notNull().defaultNow() })
export const verification = pgTable('verification', { id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(), expiresAt: timestamp('expiresAt').notNull(), createdAt: timestamp('createdAt').notNull().defaultNow(), updatedAt: timestamp('updatedAt').notNull().defaultNow() })

export const teachers = pgTable('teachers', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
}, (t) => [uniqueIndex('teachers_user_name').on(t.userId, t.name)])

export const subjects = pgTable('subjects', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  grade: integer('grade').notNull(),
  weeklyPeriods: integer('weekly_periods').notNull().default(3),
}, (t) => [uniqueIndex('subjects_user_name_grade').on(t.userId, t.name, t.grade)])

export const ppctTracks = pgTable('ppct_tracks', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull(),
  subjectId: integer('subject_id').notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  lessonCount: integer('lesson_count').notNull().default(0),
  sourceFile: text('source_file'),
  importedAt: timestamp('imported_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('tracks_subject_type').on(t.subjectId, t.type)])

export const ppctItems = pgTable('ppct_items', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull(),
  trackId: integer('track_id').notNull(),
  period: integer('period').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  requirement: text('requirement').notNull().default(''),
  warning: text('warning').notNull().default(''),
}, (t) => [uniqueIndex('items_track_period').on(t.trackId, t.period)])

export const classes = pgTable('classes', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  grade: integer('grade').notNull(),
  subjectId: integer('subject_id').notNull(),
  teacherId: integer('teacher_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('classes_user_name_subject').on(t.userId, t.name, t.subjectId)])

export const classElectives = pgTable('class_electives', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull(),
  classId: integer('class_id').notNull(),
  trackId: integer('track_id').notNull(),
  weeklyHours: integer('weekly_hours').notNull().default(1),
}, (t) => [uniqueIndex('electives_class_track').on(t.classId, t.trackId)])

export const timetableSlots = pgTable('timetable_slots', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull(),
  classId: integer('class_id').notNull(),
  day: integer('day').notNull(),
  session: text('session').notNull(),
  period: integer('period').notNull(),
  type: text('type').notNull().default('chinh_khoa'),
})

export const settings = pgTable('settings', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull().unique(),
  schoolYear: text('school_year').notNull().default('2026 – 2027'),
  startDate: text('start_date'),
  totalWeeks: integer('total_weeks').notNull().default(35),
  teacherName: text('teacher_name'),
})

export const lessons = pgTable('lessons', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('user_id').notNull(),
  slotId: integer('slot_id').notNull(),
  classId: integer('class_id').notNull(),
  week: integer('week').notNull(),
  date: text('date').notNull(),
  itemId: integer('item_id'),
  status: text('status').notNull().default('Bình thường'),
  note: text('note'),
}, (t) => [uniqueIndex('lessons_slot_week').on(t.slotId, t.week)])

export const curricula = pgTable('curricula', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('userId').notNull(),
  grade: integer('grade').notNull(),
  title: text('title').notNull(),
  lessonCount: integer('lessonCount').notNull().default(0),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const timetableEntries = pgTable('timetable_entries', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: text('userId').notNull(),
  classId: integer('classId').notNull(),
  day: text('day').notNull(),
  session: text('session').notNull(),
  period: integer('period').notNull(),
  subject: text('subject').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
