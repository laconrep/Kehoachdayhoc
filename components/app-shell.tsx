'use client'

import { useMemo, useState, useTransition } from 'react'
import { previewCurriculum, commitCurriculum, updateCurriculum } from '@/app/actions/curriculum'
import { createClass, assignClassTeacher } from '@/app/actions/classes'
import { saveTimetableGrid } from '@/app/actions/timetable'
import { generateSchedule, updateLessonStatus } from '@/app/actions/schedule'
import { saveSettings } from '@/app/actions/settings'
import { exportReport } from '@/app/actions/export'
import { getAppState } from '@/app/actions/data'
import { authClient } from '@/lib/auth-client'
import { DAYS, DAY_NUMBERS, GRADES, PERIODS, SESSIONS, STATUSES, TRACK_LABELS, type TrackType } from '@/lib/ppct/constants'
import type { AppState, ImportPreview, PpctItemDraft } from '@/lib/ppct/types'
import { BarChart3, BookOpen, CalendarDays, FileSpreadsheet, GraduationCap, Menu, Settings, TrendingUp, Upload, Users, X } from 'lucide-react'

const NAV = [
  ['Tổng quan', 'dashboard', BarChart3],
  ['Phân phối chương trình', 'import', BookOpen],
  ['Lớp học', 'classes', Users],
  ['Thời khóa biểu', 'timetable', CalendarDays],
  ['Tiến độ', 'progress', TrendingUp],
  ['Xuất báo cáo', 'export', FileSpreadsheet],
  ['Cài đặt', 'settings', Settings],
] as const

function todayLabel() {
  return new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function fieldClass() {
  return 'mt-2 w-full rounded-lg border border-input bg-background px-3 py-2'
}

function btnClass() {
  return 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60'
}

export function AppShell({ initial, authEnabled }: { initial: AppState; authEnabled: boolean }) {
  const [state, setState] = useState(initial)
  const [active, setActive] = useState<(typeof NAV)[number][1]>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [editSubjectId, setEditSubjectId] = useState<number | null>(null)
  const [week, setWeek] = useState(1)
  const [filterTeacher, setFilterTeacher] = useState(0)
  const [filterSubject, setFilterSubject] = useState('')
  const [tkbTeacher, setTkbTeacher] = useState(0)

  async function refresh() {
    setState(await getAppState())
  }

  function run(task: () => Promise<void>, ok?: string) {
    startTransition(async () => {
      try {
        await task()
        await refresh()
        if (ok) setMessage(ok)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Không thể thực hiện.')
      }
    })
  }

  const subjectNames = useMemo(() => [...new Set(state.subjects.map((s) => s.name))], [state.subjects])
  const teachersForTkb = state.teachers.length ? state.teachers : []
  const activeTkbTeacher = tkbTeacher || teachersForTkb[0]?.id || 0
  const tkbClasses = state.classes.filter((c) => !activeTkbTeacher || c.teacherId === activeTkbTeacher)
  const slotLookup = useMemo(() => {
    const map = new Map<string, string>()
    for (const slot of state.slots) {
      const cls = state.classes.find((c) => c.id === slot.classId)
      if (!cls) continue
      map.set(`${cls.teacherId || 0}|${slot.day}|${slot.session}|${slot.period}`, `${slot.classId}:${slot.type}`)
    }
    return map
  }, [state.slots, state.classes])

  const filteredLessons = state.lessons.filter((l) => l.week === week && (!filterTeacher || l.teacherId === filterTeacher) && (!filterSubject || l.subjectName === filterSubject))
  const progressPct = state.stats.totalItems ? Math.min(100, Math.round((state.stats.taught / state.stats.totalItems) * 100)) : 0

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-20 flex w-72 flex-col border-r border-border bg-card transition-transform md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GraduationCap className="size-5" /></div>
            <div><p className="font-semibold">Kế hoạch dạy học</p><p className="text-xs text-muted-foreground">PPCT & Thời khóa biểu</p></div>
          </div>
          <button className="md:hidden" onClick={() => setMenuOpen(false)} aria-label="Đóng menu"><X /></button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-4">
          {NAV.map(([label, id, Icon]) => (
            <button key={id} onClick={() => { setActive(id); setMenuOpen(false) }} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
              <Icon className="size-4" />{label}
            </button>
          ))}
        </nav>
        <div className="border-t border-border p-4"><div className="rounded-lg bg-muted p-3"><p className="text-xs font-medium">Năm học</p><p className="mt-1 text-sm text-muted-foreground">{state.settings.schoolYear}</p></div></div>
      </aside>
      {menuOpen && <button className="fixed inset-0 z-10 bg-foreground/20 md:hidden" onClick={() => setMenuOpen(false)} aria-label="Đóng menu" />}
      <main className="md:pl-72">
        <header className="flex h-20 items-center justify-between border-b border-border bg-card px-5 md:px-10">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Mở menu"><Menu /></button>
            <div><p className="text-sm text-muted-foreground capitalize">{todayLabel()}</p><h1 className="text-xl font-semibold">{NAV.find((n) => n[1] === active)?.[0]}</h1></div>
          </div>
          {authEnabled && <button onClick={async () => { await authClient.signOut(); window.location.href = '/sign-in' }} className="text-sm text-muted-foreground hover:text-foreground">Đăng xuất</button>}
        </header>
        <div className="space-y-8 p-5 md:p-10">
          {message && <p className="rounded-lg bg-muted px-4 py-3 text-sm">{message}</p>}
          {active === 'dashboard' && (
            <section className="space-y-8">
              <div>
                <p className="text-sm text-muted-foreground">Chào {state.settings.teacherName || state.userName || 'thầy/cô'}</p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight">Tổng quan năm học</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[['PPCT', String(state.stats.tracks), 'chương trình'], ['Lớp học', String(state.stats.classes), 'lớp đang quản lý'], ['Tiết TKB', String(state.stats.slots), 'tiết / tuần'], ['Buổi đã sinh', String(state.stats.lessons), 'buổi dạy']].map(([label, value, note]) => (
                  <div key={label} className="rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-4 text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="font-semibold">Quy trình</h3>
                  <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>1. Import PPCT từng môn / khối (không đè môn đã lưu)</li>
                    <li>2. Thêm lớp, nhập tên giáo viên</li>
                    <li>3. Xếp TKB riêng từng GV</li>
                    <li>4. Sinh lịch, cập nhật tiến độ, xuất báo cáo</li>
                  </ol>
                </div>
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="font-semibold">PPCT đã lưu</h3>
                  <ul className="mt-3 space-y-2 text-sm">
                    {state.subjects.length ? state.subjects.map((s) => (
                      <li key={s.id} className="flex justify-between gap-3"><span>{s.name} · Khối {s.grade}</span><span className="text-muted-foreground">{s.tracks.map((t) => `${t.type === 'chinh_khoa' ? 'CK' : 'CĐ'} ${t.lessonCount}`).join(' · ')}</span></li>
                    )) : <li className="text-muted-foreground">Chưa import môn nào.</li>}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {active === 'import' && (
            <ImportSection
              state={state}
              pending={pending}
              preview={preview}
              setPreview={setPreview}
              editSubjectId={editSubjectId}
              setEditSubjectId={setEditSubjectId}
              run={run}
              setMessage={setMessage}
            />
          )}

          {active === 'classes' && (
            <section className="space-y-6">
              <div><p className="text-sm text-muted-foreground">Giáo viên không đăng ký — chỉ nhập tên rồi gắn vào lớp</p><h2 className="mt-1 text-2xl font-semibold">Lớp học</h2></div>
              <form className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => { await createClass(fd) }, 'Đã thêm lớp và gán giáo viên.') }}>
                <label className="text-sm font-medium">Tên lớp<input name="name" required placeholder="10A1" className={fieldClass()} /></label>
                <label className="text-sm font-medium">Giáo viên<input name="teacher" required placeholder="Họ và tên" className={fieldClass()} /></label>
                <label className="text-sm font-medium sm:col-span-2">Môn – khối
                  <select name="subjectId" required className={fieldClass()} defaultValue="">
                    <option value="" disabled>Chọn môn đã import</option>
                    {state.subjects.map((s) => <option key={s.id} value={s.id}>{s.name} · Khối {s.grade}</option>)}
                  </select>
                </label>
                <button disabled={pending || !state.subjects.length} className={`${btnClass()} sm:col-span-2`}>Lưu lớp học</button>
              </form>
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left"><tr><th className="px-4 py-3">Lớp</th><th className="px-4 py-3">Môn</th><th className="px-4 py-3">GV</th><th className="px-4 py-3">TKB CK</th><th className="px-4 py-3">Gán GV</th></tr></thead>
                  <tbody>
                    {state.classes.map((cls) => (
                      <tr key={cls.id} className="border-t border-border">
                        <td className="px-4 py-3">{cls.name}</td>
                        <td className="px-4 py-3">{cls.subjectName} · {cls.grade}</td>
                        <td className="px-4 py-3">{cls.teacherName || '—'}</td>
                        <td className="px-4 py-3">{cls.assignedCore}/{cls.weeklyCore}</td>
                        <td className="px-4 py-3">
                          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => { await assignClassTeacher(fd) }, 'Đã gán giáo viên.') }}>
                            <input type="hidden" name="classId" value={cls.id} />
                            <input name="teacher" defaultValue={cls.teacherName} required className="rounded-lg border border-input bg-background px-2 py-1" />
                            <button className="text-primary">Lưu</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                    {!state.classes.length && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={5}>Chưa có lớp.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {active === 'timetable' && (
            <section className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div><p className="text-sm text-muted-foreground">Trùng ô giữa các GV được; trong một GV mỗi ô một lớp</p><h2 className="mt-1 text-2xl font-semibold">Thời khóa biểu theo giáo viên</h2></div>
                <label className="text-sm">Giáo viên
                  <select value={activeTkbTeacher} onChange={(e) => setTkbTeacher(Number(e.target.value))} className={fieldClass()}>
                    {teachersForTkb.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </div>
              {!teachersForTkb.length && <p className="text-sm text-muted-foreground">Thêm lớp và giáo viên trước khi xếp TKB.</p>}
              {!!teachersForTkb.length && (
                <TimetableGrid
                  key={`${activeTkbTeacher}-${state.slots.length}`}
                  classes={tkbClasses}
                  teacherId={activeTkbTeacher}
                  lookup={slotLookup}
                  pending={pending}
                  onSave={(slots) => {
                    const fd = new FormData()
                    fd.set('teacherId', String(activeTkbTeacher))
                    fd.set('slots', JSON.stringify(slots))
                    run(async () => { await saveTimetableGrid(fd) }, 'Đã lưu TKB giáo viên. Nhấn Sinh lịch để cập nhật kế hoạch.')
                  }}
                />
              )}
              <form onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await generateSchedule(); setMessage(`Đã sinh ${r.count} buổi dạy.`) } ) }}>
                <button disabled={pending || !state.slots.length} className={btnClass()}>Sinh lịch cả năm</button>
              </form>
            </section>
          )}

          {active === 'progress' && (
            <section className="space-y-6">
              <div><p className="text-sm text-muted-foreground">Lọc tuần / GV / môn được giữ khi cập nhật buổi dạy</p><h2 className="mt-1 text-2xl font-semibold">Tiến độ</h2></div>
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Hoàn thành chương trình</span><span className="text-2xl font-semibold">{progressPct}%</span></div>
                <div className="mt-4 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${progressPct}%` }} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm">Tuần<select value={week} onChange={(e) => setWeek(Number(e.target.value))} className={fieldClass()}>{Array.from({ length: state.settings.totalWeeks }, (_, i) => i + 1).map((w) => <option key={w} value={w}>Tuần {w}</option>)}</select></label>
                <label className="text-sm">Giáo viên<select value={filterTeacher} onChange={(e) => setFilterTeacher(Number(e.target.value))} className={fieldClass()}><option value={0}>Tất cả</option>{state.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                <label className="text-sm">Môn<select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)} className={fieldClass()}><option value="">Tất cả</option>{subjectNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
              </div>
              <div className="space-y-3">
                {filteredLessons.map((lesson) => (
                  <form key={`${lesson.id}-${week}-${filterTeacher}-${filterSubject}`} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[110px_90px_1fr_160px_160px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => { await updateLessonStatus(fd) }, 'Đã cập nhật buổi dạy.') }}>
                    <input type="hidden" name="lessonId" value={lesson.id} />
                    <div className="text-sm"><div className="font-medium">{DAYS[lesson.day]}</div><div className="text-muted-foreground">{lesson.date}</div></div>
                    <div className="text-sm">{lesson.session} · Tiết {lesson.period}</div>
                    <div className="text-sm"><div className="font-medium">{lesson.className} · {lesson.subjectName}</div><div className="text-muted-foreground">{lesson.teacherName} {lesson.itemPeriod ? `· PPCT ${lesson.itemPeriod}` : ''}</div></div>
                    <select name="status" defaultValue={lesson.status} className={fieldClass()}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                    <select name="itemId" defaultValue={lesson.itemId || ''} className={fieldClass()}>
                      <option value="">Không gán tiết PPCT</option>
                      {state.items.filter((item) => {
                        const cls = state.classes.find((c) => c.id === lesson.classId)
                        const subject = state.subjects.find((s) => s.id === cls?.subjectId)
                        return subject?.tracks.some((t) => t.id === item.trackId)
                      }).map((item) => <option key={item.id} value={item.id}>Tiết {item.period}: {item.title}</option>)}
                    </select>
                    <input name="note" defaultValue={lesson.note} placeholder="Ghi chú" className={fieldClass()} />
                    <button className={btnClass()}>Lưu</button>
                  </form>
                ))}
                {!filteredLessons.length && <p className="text-sm text-muted-foreground">Chưa có buổi dạy. Hãy xếp TKB rồi sinh lịch.</p>}
              </div>
            </section>
          )}

          {active === 'export' && (
            <section className="max-w-xl space-y-6">
              <div><p className="text-sm text-muted-foreground">Lịch báo giảng theo tuần, lọc GV / môn</p><h2 className="mt-1 text-2xl font-semibold">Xuất báo cáo</h2></div>
              <form className="space-y-4 rounded-xl border border-border bg-card p-6" onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                run(async () => {
                  const report = await exportReport(fd)
                  const bytes = Uint8Array.from(atob(report.base64), (c) => c.charCodeAt(0))
                  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
                  const a = document.createElement('a')
                  a.href = url
                  a.download = report.filename
                  a.click()
                  URL.revokeObjectURL(url)
                }, `Đã tải ${fd.get('week') ? `tuần ${fd.get('week')}` : 'báo cáo'}.`)
              }}>
                <label className="block text-sm font-medium">Tuần<input name="week" type="number" min={1} max={state.settings.totalWeeks} defaultValue={week} required className={fieldClass()} /></label>
                <label className="block text-sm font-medium">Giáo viên<select name="teacherId" defaultValue="0" className={fieldClass()}><option value="0">Tất cả</option>{state.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                <label className="block text-sm font-medium">Môn<select name="subject" defaultValue="" className={fieldClass()}><option value="">Tất cả</option>{subjectNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <button disabled={pending} className={btnClass()}>Tải XLSX</button>
              </form>
            </section>
          )}

          {active === 'settings' && (
            <section className="max-w-xl space-y-6">
              <div><p className="text-sm text-muted-foreground">Ngày bắt đầu dùng để tính lịch dương</p><h2 className="mt-1 text-2xl font-semibold">Cài đặt</h2></div>
              <form className="space-y-4 rounded-xl border border-border bg-card p-6" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => { await saveSettings(fd) }, 'Đã lưu. Hãy sinh lại lịch nếu đổi ngày / số tuần.') }}>
                <label className="block text-sm font-medium">Năm học<input name="schoolYear" defaultValue={state.settings.schoolYear} required className={fieldClass()} /></label>
                <label className="block text-sm font-medium">Ngày bắt đầu tuần 1<input name="startDate" type="date" defaultValue={state.settings.startDate} required className={fieldClass()} /></label>
                <label className="block text-sm font-medium">Tên mặc định<input name="teacherName" defaultValue={state.settings.teacherName} placeholder="Họ và tên" className={fieldClass()} /></label>
                <label className="block text-sm font-medium">Số tuần<input name="totalWeeks" type="number" min={1} max={52} defaultValue={state.settings.totalWeeks} required className={fieldClass()} /></label>
                <button disabled={pending} className={btnClass()}>Lưu cài đặt</button>
              </form>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function ImportSection({ state, pending, preview, setPreview, editSubjectId, setEditSubjectId, run, setMessage }: {
  state: AppState
  pending: boolean
  preview: ImportPreview | null
  setPreview: (v: ImportPreview | null) => void
  editSubjectId: number | null
  setEditSubjectId: (v: number | null) => void
  run: (task: () => Promise<void>, ok?: string) => void
  setMessage: (v: string) => void
}) {
  const editSubject = state.subjects.find((s) => s.id === editSubjectId)
  return (
    <section className="space-y-6">
      <div><p className="text-sm text-muted-foreground">Mỗi khối nhiều môn; upload từng môn, không đè môn đã lưu; tự tách chính khóa / chuyên đề</p><h2 className="mt-1 text-2xl font-semibold">Import PPCT</h2></div>
      <div className="grid gap-4 md:grid-cols-3">
        {GRADES.map((grade) => {
          const list = state.subjects.filter((s) => s.grade === grade)
          return (
            <article key={grade} className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-semibold">Khối {grade}</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {list.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-2">
                    <span>{s.name}<span className="block text-xs text-muted-foreground">{s.tracks.map((t) => `${t.type === 'chinh_khoa' ? 'CK' : 'CĐ'} ${t.lessonCount}`).join(' · ')}</span></span>
                    <button className="text-primary" onClick={() => { setEditSubjectId(s.id); setPreview(null) }}>Sửa</button>
                  </li>
                ))}
                {!list.length && <li className="text-muted-foreground">Chưa có môn</li>}
              </ul>
              <form className="mt-4" onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                run(async () => {
                  const next = await previewCurriculum(fd)
                  setPreview(next)
                  setEditSubjectId(null)
                  setMessage(`Đã tách ${next.groups.chinh_khoa.length} tiết CK, ${next.groups.chuyen_de.length} tiết CĐ. Kiểm tra rồi lưu.`)
                })
              }}>
                <input type="hidden" name="grade" value={grade} />
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                  <Upload className="size-4" />{pending ? 'Đang đọc...' : 'Thêm môn (.docx)'}
                  <input className="sr-only" type="file" name="file" accept=".docx" required disabled={pending} onChange={(ev) => ev.currentTarget.form?.requestSubmit()} />
                </label>
              </form>
            </article>
          )
        })}
      </div>
      {preview && <PpctEditor key={preview.filename} title={`Xem trước ${preview.filename} · Khối ${preview.grade}`} subjectDefault={preview.subjectGuess} weeklyDefault={3} groups={preview.groups} expected={preview.expected} pending={pending} onCancel={() => setPreview(null)} onSave={(payload) => {
        const fd = new FormData()
        fd.set('preview', JSON.stringify(preview))
        fd.set('subjectName', payload.subjectName)
        fd.set('weekly', String(payload.weekly))
        fd.set('groups', JSON.stringify(payload.groups))
        run(async () => {
          const result = await commitCurriculum(fd)
          setPreview(null)
          setMessage(`Đã lưu: ${result.savedTypes.join(', ')}${result.skippedAll.length ? `. Bỏ trùng tiết: ${result.skippedAll.join(', ')}` : ''}`)
        })
      }} />}
      {editSubject && !preview && (
        <PpctEditor
          key={editSubject.id}
          title={`Sửa ${editSubject.name} · Khối ${editSubject.grade}`}
          subjectDefault={editSubject.name}
          weeklyDefault={editSubject.weeklyPeriods}
          groups={{
            chinh_khoa: state.items.filter((i) => editSubject.tracks.find((t) => t.id === i.trackId && t.type === 'chinh_khoa')).map((i) => ({ tiet_so: i.period, bai_hoc: i.title, noi_dung_chi_tiet: i.content, yeu_cau_can_dat: i.requirement, canh_bao: i.warning })),
            chuyen_de: state.items.filter((i) => editSubject.tracks.find((t) => t.id === i.trackId && t.type === 'chuyen_de')).map((i) => ({ tiet_so: i.period, bai_hoc: i.title, noi_dung_chi_tiet: i.content, yeu_cau_can_dat: i.requirement, canh_bao: i.warning })),
          }}
          expected={null}
          pending={pending}
          lockSubject
          onCancel={() => setEditSubjectId(null)}
          onSave={(payload) => {
            const fd = new FormData()
            fd.set('subjectId', String(editSubject.id))
            fd.set('groups', JSON.stringify(payload.groups))
            run(async () => {
              const result = await updateCurriculum(fd)
              setEditSubjectId(null)
              setMessage(`Đã cập nhật${result.updated.length ? ': ' + result.updated.join(', ') : ''}.`)
            })
          }}
        />
      )}
    </section>
  )
}

function PpctEditor({ title, subjectDefault, weeklyDefault, groups, expected, pending, lockSubject, onCancel, onSave }: {
  title: string
  subjectDefault: string
  weeklyDefault: number
  groups: Record<TrackType, PpctItemDraft[]>
  expected: number | null
  pending: boolean
  lockSubject?: boolean
  onCancel: () => void
  onSave: (payload: { subjectName: string; weekly: number; groups: Record<TrackType, PpctItemDraft[]> }) => void
}) {
  const [subjectName, setSubjectName] = useState(subjectDefault)
  const [weekly, setWeekly] = useState(weeklyDefault)
  const [draft, setDraft] = useState(groups)
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 className="font-semibold">{title}</h3>{expected ? <p className="text-sm text-muted-foreground">Tổng số tiết khai báo: {expected}</p> : null}</div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-2 text-sm">Hủy</button>
          <button disabled={pending} onClick={() => onSave({ subjectName, weekly, groups: draft })} className={btnClass()}>Lưu PPCT</button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Tên môn<input value={subjectName} disabled={lockSubject} onChange={(e) => setSubjectName(e.target.value)} className={fieldClass()} /></label>
        <label className="text-sm">Tiết CK / tuần<input type="number" min={1} value={weekly} onChange={(e) => setWeekly(Number(e.target.value))} className={fieldClass()} /></label>
      </div>
      {(['chinh_khoa', 'chuyen_de'] as TrackType[]).map((type) => (
        <div key={type} className="mt-6">
          <h4 className="mb-2 font-medium">{TRACK_LABELS[type]} ({draft[type].length})</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left"><tr><th className="px-2 py-2">Tiết</th><th className="px-2 py-2">Bài học</th><th className="px-2 py-2">Nội dung</th><th className="px-2 py-2">Cảnh báo</th></tr></thead>
              <tbody>
                {draft[type].map((item, index) => (
                  <tr key={`${type}-${index}`} className="border-t border-border">
                    <td className="px-2 py-2"><input type="number" value={item.tiet_so} onChange={(e) => setDraft((cur) => ({ ...cur, [type]: cur[type].map((row, i) => i === index ? { ...row, tiet_so: Number(e.target.value) } : row) }))} className="w-16 rounded border border-input px-2 py-1" /></td>
                    <td className="px-2 py-2"><input value={item.bai_hoc} onChange={(e) => setDraft((cur) => ({ ...cur, [type]: cur[type].map((row, i) => i === index ? { ...row, bai_hoc: e.target.value } : row) }))} className="w-full rounded border border-input px-2 py-1" /></td>
                    <td className="px-2 py-2"><input value={item.noi_dung_chi_tiet} onChange={(e) => setDraft((cur) => ({ ...cur, [type]: cur[type].map((row, i) => i === index ? { ...row, noi_dung_chi_tiet: e.target.value } : row) }))} className="w-full rounded border border-input px-2 py-1" /></td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">{item.canh_bao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function TimetableGrid({ classes, teacherId, lookup, pending, onSave }: {
  classes: AppState['classes']
  teacherId: number
  lookup: Map<string, string>
  pending: boolean
  onSave: (slots: Array<{ classId: number; day: number; session: string; period: number; type: TrackType }>) => void
}) {
  const [grid, setGrid] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {}
    for (const day of DAY_NUMBERS) for (const session of SESSIONS) for (const period of PERIODS) {
      const key = `${day}|${session}|${period}`
      start[key] = lookup.get(`${teacherId}|${day}|${session}|${period}`) || ''
    }
    return start
  })
  return (
    <form onSubmit={(e) => {
      e.preventDefault()
      const slots = Object.entries(grid).flatMap(([key, value]) => {
        if (!value) return []
        const [day, session, period] = key.split('|')
        const [classId, type] = value.split(':')
        return [{ classId: Number(classId), day: Number(day), session, period: Number(period), type: (type === 'chuyen_de' ? 'chuyen_de' : 'chinh_khoa') as TrackType }]
      })
      onSave(slots)
    }} className="overflow-x-auto rounded-xl border border-border bg-card p-4">
      <table className="min-w-[960px] w-full text-xs">
        <thead><tr><th className="p-2 text-left">Buổi / tiết</th>{DAY_NUMBERS.map((d) => <th key={d} className="p-2">{DAYS[d]}</th>)}</tr></thead>
        <tbody>
          {SESSIONS.map((session) => PERIODS.map((period) => (
            <tr key={`${session}-${period}`} className="border-t border-border">
              <td className="p-2 whitespace-nowrap">{session} · {period}</td>
              {DAY_NUMBERS.map((day) => {
                const key = `${day}|${session}|${period}`
                return (
                  <td key={key} className="p-1">
                    <select value={grid[key] || ''} onChange={(e) => setGrid((cur) => ({ ...cur, [key]: e.target.value }))} className="w-full rounded border border-input bg-background px-1 py-1">
                      <option value="">—</option>
                      {classes.map((cls) => (
                        <optgroup key={cls.id} label={`${cls.name} · ${cls.subjectName}`}>
                          <option value={`${cls.id}:chinh_khoa`}>{cls.name} CK</option>
                          <option value={`${cls.id}:chuyen_de`}>{cls.name} CĐ</option>
                        </optgroup>
                      ))}
                    </select>
                  </td>
                )
              })}
            </tr>
          )))}
        </tbody>
      </table>
      <button disabled={pending} className={`${btnClass()} mt-4`}>Lưu TKB giáo viên này</button>
    </form>
  )
}
