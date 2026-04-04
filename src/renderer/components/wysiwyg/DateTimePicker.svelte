<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'

  interface Props {
    value: string          // YYYY-MM-DDTHH:mm or YYYY-MM-DD or empty
    anchorEl: HTMLElement
    onSelect: (datetime: string) => void
    onClose: () => void
  }

  let { value, anchorEl, onSelect, onClose }: Props = $props()

  let menuEl: HTMLDivElement | undefined = $state(undefined)

  const today = new Date()
  const todayYear = today.getFullYear()
  const todayMonth = today.getMonth()
  const todayDay = today.getDate()

  // Parse initial value
  const datePart = value ? value.substring(0, 10) : ''
  const timePart = value && value.length > 10 ? value.substring(11, 16) : ''
  const parsed = datePart ? new Date(datePart + 'T00:00:00') : null

  let viewYear = $state(parsed && !isNaN(parsed.getTime()) ? parsed.getFullYear() : todayYear)
  let viewMonth = $state(parsed && !isNaN(parsed.getTime()) ? parsed.getMonth() : todayMonth)
  let selectedDate = $state(datePart)
  let hours = $state(timePart ? timePart.substring(0, 2) : '12')
  let minutes = $state(timePart ? timePart.substring(3, 5) : '00')

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const dayNames = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

  function pad(n: number | string): string { return n.toString().padStart(2, '0') }

  interface CalendarDay { day: number; month: number; year: number; isCurrentMonth: boolean }

  let calendarDays = $derived.by(() => {
    const firstDay = new Date(viewYear, viewMonth, 1)
    let startDow = firstDay.getDay() - 1
    if (startDow < 0) startDow = 6
    const dim = new Date(viewYear, viewMonth + 1, 0).getDate()
    const prevDim = new Date(viewYear, viewMonth, 0).getDate()
    const cells: CalendarDay[] = []
    for (let i = startDow - 1; i >= 0; i--) {
      const m = viewMonth === 0 ? 11 : viewMonth - 1
      const y = viewMonth === 0 ? viewYear - 1 : viewYear
      cells.push({ day: prevDim - i, month: m, year: y, isCurrentMonth: false })
    }
    for (let d = 1; d <= dim; d++) cells.push({ day: d, month: viewMonth, year: viewYear, isCurrentMonth: true })
    while (cells.length < 42) {
      const d = cells.length - startDow - dim + 1
      const m = viewMonth === 11 ? 0 : viewMonth + 1
      const y = viewMonth === 11 ? viewYear + 1 : viewYear
      cells.push({ day: d, month: m, year: y, isCurrentMonth: false })
    }
    return cells
  })

  function isSelected(cell: CalendarDay): boolean {
    return selectedDate === `${cell.year}-${pad(cell.month + 1)}-${pad(cell.day)}`
  }
  function isToday(cell: CalendarDay): boolean {
    return cell.day === todayDay && cell.month === todayMonth && cell.year === todayYear
  }

  function selectDay(cell: CalendarDay) {
    selectedDate = `${cell.year}-${pad(cell.month + 1)}-${pad(cell.day)}`
    emit()
  }

  function emit() {
    if (!selectedDate) return
    onSelect(`${selectedDate}T${pad(hours)}:${pad(minutes)}`)
  }

  function setNow() {
    const now = new Date()
    viewYear = now.getFullYear()
    viewMonth = now.getMonth()
    selectedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    hours = pad(now.getHours())
    minutes = pad(now.getMinutes())
    emit()
  }

  function clearTime() {
    if (selectedDate) onSelect(selectedDate)
  }

  function prevMonth() { if (viewMonth === 0) { viewMonth = 11; viewYear-- } else viewMonth-- }
  function nextMonth() { if (viewMonth === 11) { viewMonth = 0; viewYear++ } else viewMonth++ }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
  }

  function clampHours(e: Event) {
    let v = parseInt((e.target as HTMLInputElement).value) || 0
    if (v < 0) v = 0; if (v > 23) v = 23
    hours = pad(v)
    emit()
  }

  function clampMinutes(e: Event) {
    let v = parseInt((e.target as HTMLInputElement).value) || 0
    if (v < 0) v = 0; if (v > 59) v = 59
    minutes = pad(v)
    emit()
  }

  function positionPopover() {
    if (!menuEl || !anchorEl) return
    computePosition(anchorEl, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => { if (menuEl) { menuEl.style.left = `${x}px`; menuEl.style.top = `${y}px` } })
  }

  onMount(() => { positionPopover(); document.addEventListener('keydown', handleKeyDown, true) })
  onDestroy(() => { document.removeEventListener('keydown', handleKeyDown, true) })
  $effect(() => { void anchorEl; positionPopover() })
</script>

<div class="dtp" bind:this={menuEl} role="dialog" aria-label="Date and time picker">
  <div class="dtp-header">
    <button class="dtp-nav" onclick={prevMonth} aria-label="Previous month">
      <span class="material-symbols-outlined">chevron_left</span>
    </button>
    <span class="dtp-title">{monthNames[viewMonth]} {viewYear}</span>
    <button class="dtp-nav" onclick={nextMonth} aria-label="Next month">
      <span class="material-symbols-outlined">chevron_right</span>
    </button>
  </div>
  <div class="dtp-weekdays">
    {#each dayNames as d}<span class="dtp-wd">{d}</span>{/each}
  </div>
  <div class="dtp-grid">
    {#each calendarDays as cell}
      <button
        class="dtp-day"
        class:outside={!cell.isCurrentMonth}
        class:selected={isSelected(cell)}
        class:today={isToday(cell)}
        onmousedown={(e) => { e.preventDefault(); selectDay(cell) }}
      >{cell.day}</button>
    {/each}
  </div>
  <div class="dtp-time-section">
    <div class="dtp-time-row">
      <span class="material-symbols-outlined dtp-time-icon">schedule</span>
      <input class="dtp-time-input" type="text" value={hours} maxlength="2" onchange={clampHours} aria-label="Hours" />
      <span class="dtp-time-sep">:</span>
      <input class="dtp-time-input" type="text" value={minutes} maxlength="2" onchange={clampMinutes} aria-label="Minutes" />
    </div>
    <div class="dtp-time-actions">
      <button class="dtp-action" onmousedown={(e) => { e.preventDefault(); setNow() }}>Now</button>
      <button class="dtp-action" onmousedown={(e) => { e.preventDefault(); clearTime() }}>Date only</button>
    </div>
  </div>
</div>

<style>
  .dtp {
    position: fixed;
    z-index: var(--z-overlay, 40);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: 8px;
    width: 252px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }
  .dtp-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .dtp-nav {
    background: none; border: none; color: var(--color-text-dim, #71717a); cursor: pointer;
    padding: 2px; border-radius: 4px; display: flex; align-items: center; transition: color 150ms ease;
  }
  .dtp-nav:hover { color: var(--color-text, #e4e4e7); }
  .dtp-nav .material-symbols-outlined { font-size: 18px; }
  .dtp-title {
    color: var(--color-text, #e4e4e7); font-family: var(--font-display, 'Space Grotesk'), sans-serif;
    font-size: 13px; font-weight: 600;
  }
  .dtp-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; margin-bottom: 2px; }
  .dtp-wd { font-size: 10px; color: var(--color-text-dim, #71717a); padding: 4px 0; }
  .dtp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
  .dtp-day {
    width: 32px; height: 28px; display: flex; align-items: center; justify-content: center;
    background: none; border: none; border-radius: 4px; color: var(--color-text, #e4e4e7);
    font-size: 11px; cursor: pointer; transition: background 150ms ease;
  }
  .dtp-day:hover { background: var(--color-border, #27272a); }
  .dtp-day.outside { color: var(--color-text-dim, #71717a); opacity: 0.4; }
  .dtp-day.selected { background: var(--color-primary, #00E5FF); color: #0a0a0a; font-weight: 600; }
  .dtp-day.today:not(.selected) { box-shadow: inset 0 0 0 1px var(--color-primary-glow, rgba(0, 229, 255, 0.4)); }

  .dtp-time-section {
    border-top: 1px solid var(--color-border, #27272a);
    margin-top: 6px; padding-top: 6px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .dtp-time-row { display: flex; align-items: center; gap: 4px; justify-content: center; }
  .dtp-time-icon { font-size: 16px; color: var(--color-text-dim, #71717a); }
  .dtp-time-input {
    width: 32px; text-align: center; background: var(--color-border, #27272a);
    border: 1px solid transparent; border-radius: 4px; color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace; font-size: 13px; padding: 4px 2px;
  }
  .dtp-time-input:focus { border-color: var(--color-primary, #00E5FF); outline: none; }
  .dtp-time-sep { color: var(--color-text-dim, #71717a); font-size: 14px; }
  .dtp-time-actions { display: flex; gap: 4px; justify-content: center; }
  .dtp-action {
    background: none; border: 1px solid var(--color-border, #27272a); border-radius: 4px;
    color: var(--color-text-dim, #71717a); font-size: 10px; padding: 3px 8px; cursor: pointer;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace; transition: all 150ms ease;
  }
  .dtp-action:hover { color: var(--color-text, #e4e4e7); border-color: var(--color-text-dim, #71717a); }
  @media (prefers-reduced-motion: reduce) {
    .dtp-nav, .dtp-day, .dtp-action, .dtp-time-input { transition: none; }
  }
</style>
