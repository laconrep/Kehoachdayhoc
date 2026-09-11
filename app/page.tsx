'use client'

import { useState } from 'react'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  GraduationCap,
  Menu,
  Settings,
  Users,
  X,
} from 'lucide-react'

const navItems = [
  { label: 'Tổng quan', icon: BarChart3 },
  { label: 'Phân phối chương trình', icon: BookOpen },
  { label: 'Thời khóa biểu', icon: CalendarDays },
  { label: 'Lớp học', icon: Users },
  { label: 'Cài đặt', icon: Settings },
]

const schedule = [
  ['Thứ 2', '08:00', 'Toán 10A1', 'Tiết 1'],
  ['Thứ 2', '09:00', 'Toán 10A2', 'Tiết 2'],
  ['Thứ 3', '08:00', 'Toán 11A1', 'Tiết 1'],
  ['Thứ 4', '14:00', 'Chuyên đề 12A1', 'Tiết 3'],
]

export default function Page() {
  const [active, setActive] = useState('Tổng quan')
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-20 flex w-72 flex-col border-r border-border bg-card transition-transform md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GraduationCap className="size-5" /></div>
            <div><p className="font-semibold tracking-tight">Kế hoạch dạy học</p><p className="text-xs text-muted-foreground">PPCT & Thời khóa biểu</p></div>
          </div>
          <button className="md:hidden" aria-label="Đóng menu" onClick={() => setMenuOpen(false)}><X className="size-5" /></button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-4" aria-label="Điều hướng chính">
          {navItems.map(({ label, icon: Icon }) => <button key={label} onClick={() => { setActive(label); setMenuOpen(false) }} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active === label ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="size-4" />{label}</button>)}
        </nav>
        <div className="border-t border-border p-4"><div className="rounded-lg bg-muted p-3"><p className="text-xs font-medium">Năm học</p><p className="mt-1 text-sm text-muted-foreground">2026 – 2027</p></div></div>
      </aside>
      {menuOpen && <button aria-label="Đóng menu" className="fixed inset-0 z-10 bg-foreground/20 md:hidden" onClick={() => setMenuOpen(false)} />}
      <main className="md:pl-72">
        <header className="flex h-20 items-center justify-between border-b border-border bg-card px-5 md:px-10"><div className="flex items-center gap-3"><button className="md:hidden" aria-label="Mở menu" onClick={() => setMenuOpen(true)}><Menu className="size-5" /></button><div><p className="text-sm text-muted-foreground">Thứ Sáu, 11 tháng 9, 2026</p><h1 className="text-xl font-semibold tracking-tight">{active}</h1></div></div><div className="hidden items-center gap-3 sm:flex"><span className="size-2 rounded-full bg-emerald-500" /><span className="text-sm text-muted-foreground">Hệ thống hoạt động</span></div></header>
        <div className="mx-auto max-w-7xl space-y-8 p-5 md:p-10">
          {active !== 'Tổng quan' ? <section className="rounded-xl border border-border bg-card p-8"><div className="flex items-center gap-3"><ClipboardList className="size-5 text-primary" /><h2 className="text-lg font-semibold">{active}</h2></div><p className="mt-2 text-muted-foreground">Khu vực {active.toLowerCase()} đang sẵn sàng để sử dụng.</p><button onClick={() => setActive('Tổng quan')} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary">Quay lại tổng quan <ChevronRight className="size-4" /></button></section> : <><section><p className="text-sm font-medium text-muted-foreground">Xin chào, giáo viên</p><h2 className="mt-1 text-3xl font-semibold tracking-tight text-balance">Tổng quan năm học</h2><p className="mt-2 text-muted-foreground">Theo dõi tiến độ giảng dạy và lịch học của bạn.</p></section><section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Lớp học', '12', 'lớp đang quản lý'], ['Môn học', '4', 'môn học'], ['Tiết đã dạy', '248', 'trong năm học'], ['Tiến độ', '71%', 'hoàn thành chương trình']].map(([title, value, note]) => <div className="rounded-xl border border-border bg-card p-5" key={title}><p className="text-sm text-muted-foreground">{title}</p><p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>)}</section><section className="rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-semibold">Lịch dạy sắp tới</h3><p className="mt-1 text-sm text-muted-foreground">Các tiết học trong tuần này</p></div><button onClick={() => setActive('Thời khóa biểu')} className="text-sm font-medium text-primary">Xem tất cả</button></div><div className="divide-y divide-border">{schedule.map(([day, time, subject, lesson]) => <div className="flex items-center gap-4 px-5 py-4" key={`${day}-${time}`}><div className="w-16 text-sm font-medium">{day}</div><div className="w-14 text-sm text-muted-foreground">{time}</div><div className="flex-1"><p className="text-sm font-medium">{subject}</p><p className="text-xs text-muted-foreground">{lesson}</p></div><ChevronRight className="size-4 text-muted-foreground" /></div>)}</div></section></>}
        </div>
      </main>
    </div>
  )
}
