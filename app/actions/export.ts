'use server'

import * as XLSX from 'xlsx'
import { DAYS, STATUSES } from '@/lib/ppct/constants'
import { loadState } from '@/lib/ppct/api'
import { requireUser } from '@/lib/session'

export async function exportReport(formData: FormData) {
  const user = await requireUser()
  const week = Number(formData.get('week'))
  const teacherId = Number(formData.get('teacherId') || 0)
  const subjectName = String(formData.get('subject') || '').trim()
  const state = await loadState(user.id, user.name || '')
  const total = state.settings.totalWeeks || 35
  if (!Number.isInteger(week) || week < 1 || week > total) throw new Error('Invalid week')
  const start = new Date(`${state.settings.startDate || new Date().toISOString().slice(0, 10)}T00:00:00`)
  start.setDate(start.getDate() + (week - 1) * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('vi-VN')
  let records = state.lessons.filter((l) => l.week === week)
  if (teacherId) records = records.filter((l) => l.teacherId === teacherId)
  if (subjectName) records = records.filter((l) => l.subjectName === subjectName)
  const headerTeacher = teacherId
    ? (state.teachers.find((t) => t.id === teacherId)?.name || '')
    : [...new Set(records.map((r) => r.teacherName).filter(Boolean))].length === 1
      ? records[0]?.teacherName || ''
      : 'Nhiều giáo viên'
  const header = ['Thứ, ngày', 'Buổi', 'Tiết TKB', 'Môn học', 'Lớp', 'Giáo viên', 'Tiết PPCT', 'Tên bài dạy', 'Ghi chú', 'Trạng thái']
  const rows: Array<Array<string | number>> = [
    ['KẾ HOẠCH DẠY HỌC'],
    ['Giáo viên:', headerTeacher, '', '', 'Từ ngày:', fmt(start)],
    ['Tuần:', `Tuần ${week}`, '', '', 'Đến ngày:', fmt(end)],
    header,
  ]
  if (teacherId) {
    for (const day of Object.keys(DAYS).map(Number)) {
      for (const session of ['Sáng', 'Chiều']) {
        for (let period = 1; period <= 5; period++) {
          const record = records.find((r) => r.day === day && r.session === session && r.period === period)
          rows.push([
            period === 1 ? (session === 'Sáng' ? (day === 8 ? 'CN' : String(day)) : '') : '',
            period === 1 ? session : '',
            period,
            record?.subjectName || '',
            record?.className || '',
            record?.teacherName || '',
            record?.itemPeriod || '',
            record?.title || '',
            record?.note || '',
            record?.status || '',
          ])
        }
      }
    }
  } else {
    for (const record of records) {
      rows.push([DAYS[record.day] || record.day, record.session, record.period, record.subjectName, record.className, record.teacherName, record.itemPeriod || '', record.title, record.note, record.status])
    }
    if (!records.length) rows.push(['Chưa có buổi dạy'])
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'LBG')
  const classes = state.classes.filter((c) => (!teacherId || c.teacherId === teacherId) && (!subjectName || c.subjectName === subjectName))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Lớp', 'Môn', 'Giáo viên'], ...classes.map((c) => [c.name, c.subjectName, c.teacherName])]), 'Môn học - Lớp học')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['STT', 'Trạng thái'], ...STATUSES.map((name, i) => [i + 1, name])]), 'Kiểu giảng dạy')
  const buffer = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
  return { filename: `Lich-bao-giang-tuan-${week}.xlsx`, base64: buffer }
}
