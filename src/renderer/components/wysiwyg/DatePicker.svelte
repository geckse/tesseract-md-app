<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'

  interface Props {
    value: string
    anchorEl: HTMLElement
    onSelect: (date: string) => void
    onClose: () => void
  }

  let { value, anchorEl, onSelect, onClose }: Props = $props()

  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let viewMode = $state<'days' | 'months' | 'years'>('days')

  const today = new Date()
  const todayYear = today.getFullYear()
  const todayMonth = today.getMonth()
  const todayDay = today.getDate()

  // Parse initial value
  const parsed = value ? new Date(value + 'T00:00:00') : null
  let viewYear = $state(parsed && !isNaN(parsed.getTime()) ? parsed.getFullYear() : todayYear)
  let viewMonth = $state(parsed && !isNaN(parsed.getTime()) ? parsed.getMonth() : todayMonth)

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const dayNames = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

  interface CalendarDay {
    day: number
    month: number
    year: number
    isCurrentMonth: boolean
  }

  let calendarDays = $derived.by(() => {
    const firstDay = new Date(viewYear, viewMonth, 1)
    let startDow = firstDay.getDay() - 1 // Monday = 0
    if (startDow < 0) startDow = 6
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()
    const cells: CalendarDay[] = []

    for (let i = startDow - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i
      const m = viewMonth === 0 ? 11 : viewMonth - 1
      const y = viewMonth === 0 ? viewYear - 1 : viewYear
      cells.push({ day: d, month: m, year: y, isCurrentMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, month: viewMonth, year: viewYear, isCurrentMonth: true })
    }
    while (cells.length < 42) {
      const d = cells.length - startDow - daysInMonth + 1
      const m = viewMonth === 11 ? 0 : viewMonth + 1
      const y = viewMonth === 11 ? viewYear + 1 : viewYear
      cells.push({ day: d, month: m, year: y, isCurrentMonth: false })
    }
    return cells
  })

  let yearRange = $derived.by(() => {
    const start = viewYear - 6
    const years: number[] = []
    for (let i = 0; i < 12; i++) years.push(start + i)
    return years
  })

  function pad(n: number): string { return n.toString().padStart(2, '0') }

  function isSelected(cell: CalendarDay): boolean {
    if (!value) return false
    return value === `${cell.year}-${pad(cell.month + 1)}-${pad(cell.day)}`
  }

  function isToday(cell: CalendarDay): boolean {
    return cell.day === todayDay && cell.month === todayMonth && cell.year === todayYear
  }

  function selectDay(cell: CalendarDay) {
    onSelect(`${cell.year}-${pad(cell.month + 1)}-${pad(cell.day)}`)
  }

  function prevMonth() {
    if (viewMonth === 0) { viewMonth = 11; viewYear-- }
    else viewMonth--
  }

  function nextMonth() {
    if (viewMonth === 11) { viewMonth = 0; viewYear++ }
    else viewMonth++
  }

  function selectMonth(m: number) {
    viewMonth = m
    viewMode = 'days'
  }

  function selectYear(y: number) {
    viewYear = y
    viewMode = 'months'
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
  }

  function positionPopover() {
    if (!menuEl || !anchorEl) return
    computePosition(anchorEl, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (menuEl) { menuEl.style.left = `${x}px`; menuEl.style.top = `${y}px` }
    })
  }

  onMount(() => {
    positionPopover()
    document.addEventListener('keydown', handleKeyDown, true)
  })

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown, true)
  })

  $effect(() => { void anchorEl; positionPopover() })
</script>

<div class="dp" bind:this={menuEl} role="dialog" aria-label="Date picker">
  {#if viewMode === 'days'}
    <div class="dp-header">
      <button class="dp-nav" onclick={prevMonth} aria-label="Previous month">
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <button class="dp-title" onclick={() => (viewMode = 'months')}>
        {monthNames[viewMonth]} {viewYear}
      </button>
      <button class="dp-nav" onclick={nextMonth} aria-label="Next month">
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
    <div class="dp-weekdays">
      {#each dayNames as d}
        <span class="dp-weekday">{d}</span>
      {/each}
    </div>
    <div class="dp-grid">
      {#each calendarDays as cell}
        <button
          class="dp-day"
          class:outside={!cell.isCurrentMonth}
          class:selected={isSelected(cell)}
          class:today={isToday(cell)}
          onmousedown={(e) => { e.preventDefault(); selectDay(cell) }}
        >
          {cell.day}
        </button>
      {/each}
    </div>
  {:else if viewMode === 'months'}
    <div class="dp-header">
      <button class="dp-nav" onclick={() => viewYear--} aria-label="Previous year">
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <button class="dp-title" onclick={() => (viewMode = 'years')}>
        {viewYear}
      </button>
      <button class="dp-nav" onclick={() => viewYear++} aria-label="Next year">
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
    <div class="dp-month-grid">
      {#each monthShort as m, i}
        <button
          class="dp-month"
          class:selected={viewMonth === i && viewYear === (parsed?.getFullYear() ?? -1)}
          onmousedown={(e) => { e.preventDefault(); selectMonth(i) }}
        >
          {m}
        </button>
      {/each}
    </div>
  {:else}
    <div class="dp-header">
      <button class="dp-nav" onclick={() => (viewYear -= 12)} aria-label="Previous years">
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <button class="dp-title" onclick={() => (viewMode = 'days')}>
        {yearRange[0]}–{yearRange[11]}
      </button>
      <button class="dp-nav" onclick={() => (viewYear += 12)} aria-label="Next years">
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
    <div class="dp-month-grid">
      {#each yearRange as y}
        <button
          class="dp-month"
          class:selected={y === viewYear}
          onmousedown={(e) => { e.preventDefault(); selectYear(y) }}
        >
          {y}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dp {
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
  .dp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .dp-nav {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    transition: color 150ms ease;
  }
  .dp-nav:hover { color: var(--color-text, #e4e4e7); }
  .dp-nav .material-symbols-outlined { font-size: 18px; }
  .dp-title {
    background: none;
    border: none;
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-display, 'Space Grotesk'), sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 4px;
    transition: background 150ms ease;
  }
  .dp-title:hover { background: var(--color-border, #27272a); }
  .dp-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    text-align: center;
    margin-bottom: 2px;
  }
  .dp-weekday {
    font-size: 10px;
    color: var(--color-text-dim, #71717a);
    padding: 4px 0;
  }
  .dp-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
  }
  .dp-day {
    width: 32px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-size: 11px;
    cursor: pointer;
    transition: background 150ms ease;
  }
  .dp-day:hover { background: var(--color-border, #27272a); }
  .dp-day.outside { color: var(--color-text-dim, #71717a); opacity: 0.4; }
  .dp-day.selected {
    background: var(--color-primary, #00E5FF);
    color: #0a0a0a;
    font-weight: 600;
  }
  .dp-day.today:not(.selected) {
    box-shadow: inset 0 0 0 1px var(--color-primary-glow, rgba(0, 229, 255, 0.4));
  }
  .dp-month-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 4px 0;
  }
  .dp-month {
    background: none;
    border: none;
    color: var(--color-text, #e4e4e7);
    font-size: 12px;
    padding: 8px 4px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 150ms ease;
  }
  .dp-month:hover { background: var(--color-border, #27272a); }
  .dp-month.selected {
    background: var(--color-primary, #00E5FF);
    color: #0a0a0a;
    font-weight: 600;
  }
  @media (prefers-reduced-motion: reduce) {
    .dp-nav, .dp-title, .dp-day, .dp-month { transition: none; }
  }
</style>
