'use client'

import { useState } from 'react'
import { importCurriculum } from '@/app/actions/curriculum'
import { createClass } from '@/app/actions/classes'
import { saveTimetableEntry } from '@/app/actions/timetable'
import { generateSchedule } from '@/app/actions/schedule'
import { saveSettings } from '@/app/actions/settings'
import { exportReport } from '@/app/actions/export'
import { authClient } from '@/lib/auth-client'
import { BarChart3, BookOpen, CalendarDays, FileSpreadsheet, GraduationCap, Menu, Settings, TrendingUp, Upload, Users, X } from 'lucide-react'

const nav = [
  ['Tổng quan', BarChart3],
  ['Phân phối chương trình', BookOpen],
  ['Thời khóa biểu', CalendarDays],
  ['Lớp học', Users],
  ['Tiến độ', TrendingUp],
  ['Xuất báo cáo', FileSpreadsheet],
  ['Cài đặt', Settings],
] as const

const initialCurricula = [
  { title: 'Ngữ văn 10 — Cả năm', grade: 10, lessonCount: 105 },
  { title: 'Toán 11 — Cả năm', grade: 11, lessonCount: 105 },
]

export default function Page() {
  const [active, setActive] = useState('Tổng quan')
  const [menuOpen, setMenuOpen] = useState(false)
  const [curricula, setCurricula] = useState(initialCurricula)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [classMessage, setClassMessage] = useState('')
  const [timetableMessage, setTimetableMessage] = useState('')
  const [scheduleMessage, setScheduleMessage] = useState('')

  async function handleImport(formData: FormData) {
    setImporting(true)
    setImportMessage('')
    try {
      const record = await importCurriculum(formData)
      setCurricula((current) => [...current, { title: record.title, grade: record.grade, lessonCount: record.lessonCount }])
      setImportMessage(`Đã nhập ${record.title} với ${record.lessonCount} tiết.`)
    } catch {
      setImportMessage('Không thể nhập file. Hãy kiểm tra định dạng DOCX và đăng nhập lại nếu cần.')
    } finally {
      setImporting(false)
    }
  }

  async function handleCreateClass(formData: FormData) {
    setClassMessage('')
    try {
      const [record] = await createClass(formData)
      setClassMessage(`Đã tạo lớp ${record.name} và gán giáo viên ${record.teacher}.`)
    } catch {
      setClassMessage('Không thể tạo lớp. Vui lòng nhập đủ tên lớp, giáo viên và khối.')
    }
  }

  async function handleTimetable(formData: FormData) {
    setTimetableMessage('')
    try {
      await saveTimetableEntry(formData)
      setTimetableMessage('Đã lưu tiết học vào thời khóa biểu.')
    } catch {
      setTimetableMessage('Không thể lưu. Hãy kiểm tra mã lớp, thứ, buổi, tiết và môn học.')
    }
  }

  async function handleGenerateSchedule(formData: FormData) {
    setScheduleMessage('')
    try {
      const rows = await generateSchedule(formData)
      setScheduleMessage(`Đã sinh ${rows.length} buổi học và khởi tạo tiến độ.`)
    } catch {
      setScheduleMessage('Không thể sinh lịch. Hãy kiểm tra mã lớp, số tuần và tên bài học.')
    }
  }

  async function handleSettings(formData: FormData) {
    try { await saveSettings(formData); setScheduleMessage('Đã lưu cài đặt năm học.') } catch { setScheduleMessage('Không thể lưu cài đặt.') }
  }

  async function handleExport(formData: FormData) {
    try { const report = await exportReport(formData); setScheduleMessage(`Đã chuẩn bị ${report.filename}.`) } catch { setScheduleMessage('Không thể tạo báo cáo.') }
  }

  async function signOut() {
    await authClient.signOut()
    window.location.href = '/sign-in'
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-20 flex w-72 flex-col border-r border-border bg-card transition-transform md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GraduationCap className="size-5" /></div><div><p className="font-semibold">Kế hoạch dạy học</p><p className="text-xs text-muted-foreground">PPCT & Thời khóa biểu</p></div></div>
          <button className="md:hidden" onClick={() => setMenuOpen(false)} aria-label="Đóng menu"><X /></button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-4">{nav.map(([label, Icon]) => <button key={label} onClick={() => { setActive(label); setMenuOpen(false) }} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active === label ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Icon className="size-4" />{label}</button>)}</nav>
        <div className="border-t border-border p-4"><div className="rounded-lg bg-muted p-3"><p className="text-xs font-medium">Năm học</p><p className="mt-1 text-sm text-muted-foreground">2026 – 2027</p></div></div>
      </aside>
      {menuOpen && <button className="fixed inset-0 z-10 bg-foreground/20 md:hidden" onClick={() => setMenuOpen(false)} aria-label="Đóng menu" />}
      <main className="md:pl-72">
        <header className="flex h-20 items-center justify-between border-b border-border bg-card px-5 md:px-10"><div className="flex items-center gap-3"><button className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Mở menu"><Menu /></button><div><p className="text-sm text-muted-foreground">Thứ Sáu, 11 tháng 9, 2026</p><h1 className="text-xl font-semibold">{active}</h1></div></div><button onClick={signOut} className="text-sm text-muted-foreground hover:text-foreground">Đăng xuất</button></header>
        <div className="space-y-8 p-5 md:p-10">
          {active === 'Tổng quan' && <Dashboard curriculaCount={curricula.length} />}
          {active === 'Phân phối chương trình' && <section className="space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">Dữ liệu thật được lưu trên Neon</p><h2 className="mt-1 text-2xl font-semibold">Quản lý PPCT</h2></div><form action={handleImport} className="flex items-center gap-2"><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-muted"><Upload className="size-4" />{importing ? 'Đang nhập...' : 'Chọn file DOCX'}<input className="sr-only" type="file" name="file" accept=".docx" required disabled={importing} onChange={(event) => event.currentTarget.form?.requestSubmit()} /></label></form></div>{importMessage && <p className="rounded-lg bg-muted px-4 py-3 text-sm">{importMessage}</p>}<div className="grid gap-4 md:grid-cols-2">{curricula.map((item) => <article key={`${item.title}-${item.grade}`} className="rounded-xl border border-border bg-card p-5"><div className="flex items-start justify-between"><div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileSpreadsheet className="size-5" /></div><span className="rounded-full bg-muted px-3 py-1 text-xs">Khối {item.grade}</span></div><h3 className="mt-5 font-semibold">{item.title}</h3><p className="mt-2 text-sm text-muted-foreground">{item.lessonCount} tiết đã nhận diện</p></article>)}</div></section>}
          {active === 'Lớp học' && <section className="max-w-2xl space-y-6"><div><p className="text-sm text-muted-foreground">Khai báo lớp và giáo viên phụ trách</p><h2 className="mt-1 text-2xl font-semibold">Tạo lớp học</h2></div><form action={handleCreateClass} className="space-y-4 rounded-xl border border-border bg-card p-6"><label className="block text-sm font-medium">Tên lớp<input name="name" required placeholder="Ví dụ: 10A1" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><label className="block text-sm font-medium">Giáo viên<input name="teacher" required placeholder="Họ và tên giáo viên" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><label className="block text-sm font-medium">Khối<select name="grade" defaultValue="10" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="10">10</option><option value="11">11</option><option value="12">12</option></select></label><button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Lưu lớp học</button>{classMessage && <p className="text-sm text-muted-foreground">{classMessage}</p>}</form></section>}
          {active === 'Thời khóa biểu' && <section className="max-w-2xl space-y-6"><div><p className="text-sm text-muted-foreground">Xếp tiết theo lớp, ngày và buổi học</p><h2 className="mt-1 text-2xl font-semibold">Thời khóa biểu</h2></div><form action={handleTimetable} className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"><label className="text-sm font-medium">Mã lớp<input name="classId" type="number" min="1" required placeholder="ID lớp trong Neon" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><label className="text-sm font-medium">Thứ<select name="day" defaultValue="Thứ Hai" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"><option>Thứ Hai</option><option>Thứ Ba</option><option>Thứ Tư</option><option>Thứ Năm</option><option>Thứ Sáu</option></select></label><label className="text-sm font-medium">Buổi<select name="session" defaultValue="Sáng" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"><option>Sáng</option><option>Chiều</option></select></label><label className="text-sm font-medium">Tiết<select name="period" defaultValue="1" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label><label className="text-sm font-medium sm:col-span-2">Môn học<input name="subject" required placeholder="Ví dụ: Toán" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground sm:col-span-2">Lưu thời khóa biểu</button>{timetableMessage && <p className="text-sm text-muted-foreground sm:col-span-2">{timetableMessage}</p>}</form></section>}
          {active === 'Tiến độ' && <section className="max-w-2xl space-y-6"><div><p className="text-sm text-muted-foreground">Theo dõi số buổi đã sinh và trạng thái giảng dạy</p><h2 className="mt-1 text-2xl font-semibold">Tiến độ</h2></div><div className="rounded-xl border border-border bg-card p-6"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Hoàn thành chương trình</span><span className="text-2xl font-semibold">0%</span></div><div className="mt-4 h-2 rounded-full bg-muted"><div className="h-2 w-0 rounded-full bg-primary" /></div><p className="mt-4 text-sm leading-6 text-muted-foreground">Sinh lịch giảng dạy để bắt đầu cập nhật trạng thái từng buổi học.</p></div></section>}
          {active === 'Xuất báo cáo' && <section className="max-w-xl space-y-6"><div><p className="text-sm text-muted-foreground">Tạo báo cáo lịch báo giảng</p><h2 className="mt-1 text-2xl font-semibold">Xuất báo cáo</h2></div><form action={handleExport} className="rounded-xl border border-border bg-card p-6"><label className="text-sm font-medium">Tuần<input name="week" type="number" min="1" max="52" defaultValue="1" required className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><button className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Tạo báo cáo XLSX</button></form></section>}
          {active === 'Cài đặt' && <section className="max-w-xl space-y-6"><div><p className="text-sm text-muted-foreground">Thiết lập năm học và giáo viên</p><h2 className="mt-1 text-2xl font-semibold">Cài đặt</h2></div><form action={handleSettings} className="space-y-4 rounded-xl border border-border bg-card p-6"><label className="block text-sm font-medium">Năm học<input name="schoolYear" defaultValue="2026 – 2027" required className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><label className="block text-sm font-medium">Tên giáo viên<input name="teacherName" required placeholder="Họ và tên" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><label className="block text-sm font-medium">Số tuần<input name="totalWeeks" type="number" min="1" max="52" defaultValue="35" required className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Lưu cài đặt</button></form></section>}
          {active === 'Thời khóa biểu' && <section className="max-w-2xl space-y-6"><div><p className="text-sm text-muted-foreground">Xếp tiết theo lớp, ngày và buổi học</p><h2 className="mt-1 text-2xl font-semibold">Thời khóa biểu</h2></div><form action={handleTimetable} className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"><label className="text-sm font-medium">Mã lớp<input name="classId" type="number" min="1" required placeholder="ID lớp trong Neon" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><label className="text-sm font-medium">Thứ<select name="day" defaultValue="Thứ Hai" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"><option>Thứ Hai</option><option>Thứ Ba</option><option>Thứ Tư</option><option>Thứ Năm</option><option>Thứ Sáu</option></select></label><label className="text-sm font-medium">Buổi<select name="session" defaultValue="Sáng" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"><option>Sáng</option><option>Chiều</option></select></label><label className="text-sm font-medium">Tiết<select name="period" defaultValue="1" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label><label className="text-sm font-medium sm:col-span-2">Môn học<input name="subject" required placeholder="Ví dụ: Toán" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2" /></label><button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground sm:col-span-2">Lưu thời khóa biểu</button>{timetableMessage && <p className="text-sm text-muted-foreground sm:col-span-2">{timetableMessage}</p>}</form><div className="rounded-xl border border-border bg-card p-6"><h3 className="font-semibold">Sinh lịch và khởi tạo tiến độ</h3><form action={handleGenerateSchedule} className="mt-4 grid gap-4 sm:grid-cols-3"><input name="classId" type="number" min="1" required placeholder="Mã lớp" className="rounded-lg border border-input bg-background px-3 py-2" /><input name="weeks" type="number" min="1" max="52" defaultValue="35" required placeholder="Số tuần" className="rounded-lg border border-input bg-background px-3 py-2" /><input name="title" required placeholder="Tên bài / chủ đề" className="rounded-lg border border-input bg-background px-3 py-2" /><button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground sm:col-span-3">Sinh lịch giảng dạy</button>{scheduleMessage && <p className="text-sm text-muted-foreground sm:col-span-3">{scheduleMessage}</p>}</form></div></section>}
          {active !== 'Tổng quan' && active !== 'Phân phối chương trình' && active !== 'Lớp học' && active !== 'Thời khóa biểu' && active !== 'Tiến độ' && <EmptySection title={active} />}
        </div>
      </main>
    </div>
  )
}

function Dashboard({ curriculaCount }: { curriculaCount: number }) { const stats = [['PPCT', String(curriculaCount), 'bộ chương trình'], ['Lớp học', '0', 'lớp đang quản lý'], ['Tiết đã dạy', '0', 'trong năm học'], ['Tiến độ', '0%', 'hoàn thành chương trình']]; return <section className="space-y-8"><div><p className="text-sm text-muted-foreground">Không gian quản lý cá nhân</p><h2 className="mt-1 text-3xl font-semibold tracking-tight">Tổng quan năm học</h2></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(([label, value, note]) => <div key={label} className="rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-4 text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>)}</div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border bg-card p-6"><div className="flex items-center gap-3"><TrendingUp className="size-5 text-primary" /><h3 className="font-semibold">Tiến độ cần hoàn thiện</h3></div><p className="mt-3 text-sm leading-6 text-muted-foreground">Bắt đầu bằng cách nhập PPCT, sau đó khai báo lớp và xếp thời khóa biểu để sinh lịch giảng dạy.</p></div><div className="rounded-xl border border-border bg-card p-6"><div className="flex items-center gap-3"><BookOpen className="size-5 text-primary" /><h3 className="font-semibold">Quy trình đề xuất</h3></div><p className="mt-3 text-sm leading-6 text-muted-foreground">PPCT → Lớp học → Thời khóa biểu → Sinh lịch → Theo dõi tiến độ → Xuất báo cáo.</p></div></div></section> }
function EmptySection({ title }: { title: string }) { return <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center"><h2 className="text-xl font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Khu vực này sẽ dùng dữ liệu Neon trong bước triển khai tiếp theo.</p></section> }
