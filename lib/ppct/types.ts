import type { StatusName, TrackType } from './constants'

export type { StatusName, TrackType }

export type PpctItemDraft = {
  tiet_so: number
  bai_hoc: string
  noi_dung_chi_tiet: string
  yeu_cau_can_dat: string
  canh_bao: string
}

export type ImportPreview = {
  grade: number
  filename: string
  expected: number | null
  subjectGuess: string
  groups: Record<TrackType, PpctItemDraft[]>
}

export type TeacherRow = { id: number; name: string }

export type TrackRow = {
  id: number
  subjectId: number
  type: TrackType
  name: string
  lessonCount: number
  sourceFile: string | null
  importedAt: string | null
}

export type ItemRow = {
  id: number
  trackId: number
  period: number
  title: string
  content: string
  requirement: string
  warning: string
}

export type SubjectRow = {
  id: number
  name: string
  grade: number
  weeklyPeriods: number
  tracks: TrackRow[]
}

export type ClassRow = {
  id: number
  name: string
  grade: number
  subjectId: number
  subjectName: string
  teacherId: number | null
  teacherName: string
  weeklyCore: number
  assignedCore: number
  electiveTrackId: number | null
  electiveHours: number
}

export type SlotRow = {
  id: number
  classId: number
  teacherId: number | null
  day: number
  session: string
  period: number
  type: TrackType
}

export type LessonRow = {
  id: number
  slotId: number
  classId: number
  teacherId: number | null
  teacherName: string
  subjectName: string
  className: string
  week: number
  date: string
  day: number
  session: string
  period: number
  type: TrackType
  itemId: number | null
  itemPeriod: number | null
  title: string
  status: StatusName
  note: string
}

export type SettingsRow = {
  schoolYear: string
  startDate: string
  totalWeeks: number
  teacherName: string
}

export type AppState = {
  userName: string
  settings: SettingsRow
  teachers: TeacherRow[]
  subjects: SubjectRow[]
  items: ItemRow[]
  classes: ClassRow[]
  slots: SlotRow[]
  lessons: LessonRow[]
  stats: { tracks: number; classes: number; slots: number; lessons: number; taught: number; totalItems: number }
}
