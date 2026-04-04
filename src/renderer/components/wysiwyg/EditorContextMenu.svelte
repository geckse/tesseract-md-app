<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { navigateLink, navigateLinkNewTab, navigateLinkOtherPane, resolveHref, isExternalHref } from '../../lib/link-navigation';
  import { workspace } from '../../stores/workspace.svelte';

  interface Props {
    editor: Editor;
    x: number;
    y: number;
    onclose: () => void;
  }

  let { editor, x, y, onclose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state(undefined);

  // ── Editor state checks ───────────────────────────────────────────────

  const hasSelection = $derived(() => {
    const { from, to } = editor.state.selection;
    return from !== to;
  });

  const isOnLink = $derived(() => editor.isActive('link'));
  const isOnWikilink = $derived(() => editor.isActive('wikilink'));
  const isBold = $derived(() => editor.isActive('bold'));
  const isItalic = $derived(() => editor.isActive('italic'));
  const isCode = $derived(() => editor.isActive('code'));
  const isStrike = $derived(() => editor.isActive('strike'));

  // ── Actions ───────────────────────────────────────────────────────────

  function exec(fn: () => void) {
    fn();
    onclose();
  }

  function handleUndo() { exec(() => editor.chain().focus().undo().run()); }
  function handleRedo() { exec(() => editor.chain().focus().redo().run()); }

  function handleCut() {
    document.execCommand('cut');
    onclose();
  }
  function handleCopy() {
    document.execCommand('copy');
    onclose();
  }
  function handlePaste() {
    navigator.clipboard.readText().then((text) => {
      editor.chain().focus().insertContent(text).run();
    });
    onclose();
  }

  function handleBold() { exec(() => editor.chain().focus().toggleBold().run()); }
  function handleItalic() { exec(() => editor.chain().focus().toggleItalic().run()); }
  function handleStrike() { exec(() => editor.chain().focus().toggleStrike().run()); }
  function handleCode() { exec(() => editor.chain().focus().toggleCode().run()); }
  function handleClearFormatting() { exec(() => editor.chain().focus().clearNodes().unsetAllMarks().run()); }

  function handleLink() {
    if (editor.isActive('link')) {
      exec(() => editor.chain().focus().unsetLink().run());
    } else {
      onclose();
      editor.view.dom.dispatchEvent(new CustomEvent('open-link-modal', { bubbles: true }));
    }
  }

  function handleRemoveLink() {
    exec(() => editor.chain().focus().extendMarkRange('link').unsetLink().run());
  }

  function handleCopyLinkUrl() {
    const href = getLinkHref();
    if (href) navigator.clipboard.writeText(href);
    onclose();
  }

  function handleNavigateLink() {
    const href = getLinkHref();
    if (href) navigateLink(href);
    onclose();
  }

  function handleOpenInNewTab() {
    const href = getLinkHref();
    if (href) navigateLinkNewTab(href);
    onclose();
  }

  function handleOpenInOtherPane() {
    const href = getLinkHref();
    if (href) navigateLinkOtherPane(href);
    onclose();
  }

  function handleEditLink() {
    const href = getLinkHref();
    onclose();
    editor.chain().focus().extendMarkRange('link').run();
    editor.view.dom.dispatchEvent(new CustomEvent('open-link-modal', {
      bubbles: true,
      detail: { initialQuery: href ?? '' },
    }));
  }

  /** Get the href of the link at cursor, whether it's a regular link or wikilink. */
  function getLinkHref(): string | null {
    if (editor.isActive('link')) {
      return editor.getAttributes('link').href ?? null;
    }
    if (editor.isActive('wikilink')) {
      return editor.getAttributes('wikilink').target ?? null;
    }
    return null;
  }

  /** Determine label for the other pane direction. */
  const otherPaneLabel = $derived(() => {
    const paneOrder = workspace.paneOrder;
    if (paneOrder.length < 2) return 'Open in Split';
    const activeIdx = paneOrder.indexOf(workspace.activePaneId);
    return activeIdx === 0 ? 'Open in Right Pane' : 'Open in Left Pane';
  });

  // Block type conversions
  function handleParagraph() { exec(() => editor.chain().focus().setParagraph().run()); }
  function handleHeading(level: 1 | 2 | 3) { exec(() => editor.chain().focus().toggleHeading({ level }).run()); }
  function handleBulletList() { exec(() => editor.chain().focus().toggleBulletList().run()); }
  function handleOrderedList() { exec(() => editor.chain().focus().toggleOrderedList().run()); }
  function handleBlockquote() { exec(() => editor.chain().focus().toggleBlockquote().run()); }
  function handleCodeBlock() { exec(() => editor.chain().focus().toggleCodeBlock().run()); }

  // ── Positioning ───────────────────────────────────────────────────────

  onMount(() => {
    if (!menuEl) return;
    // Clamp position to viewport
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (x + rect.width > vw) x = vw - rect.width - 8;
    if (y + rect.height > vh) y = vh - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
  });

  // ── Close on outside click / Escape ───────────────────────────────────

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  function handleOutsideClick(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onclose();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    // Delay to avoid catching the right-click itself
    requestAnimationFrame(() => {
      window.addEventListener('mousedown', handleOutsideClick);
    });
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('mousedown', handleOutsideClick);
  });

  const isMac = navigator.platform.includes('Mac');
  const mod = isMac ? '⌘' : 'Ctrl+';

  // Flip submenus to the left when the menu is in the right half of the screen
  const flipSubmenu = $derived(x > window.innerWidth / 2);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="context-menu"
  class:flip-submenu={flipSubmenu}
  bind:this={menuEl}
  style="left: {x}px; top: {y}px;"
  role="menu"
  aria-label="Editor context menu"
>
  <!-- Link actions (top-level when cursor is on a link) -->
  {#if isOnLink() || isOnWikilink()}
    <button class="menu-item" onclick={handleNavigateLink} role="menuitem">
      <span class="material-symbols-outlined">arrow_forward</span>
      <span class="menu-label">Navigate Link</span>
    </button>
    <button class="menu-item" onclick={handleOpenInNewTab} role="menuitem">
      <span class="material-symbols-outlined">tab</span>
      <span class="menu-label">Open in New Tab</span>
    </button>
    <button class="menu-item" onclick={handleOpenInOtherPane} role="menuitem">
      <span class="material-symbols-outlined">vertical_split</span>
      <span class="menu-label">{otherPaneLabel()}</span>
    </button>
    <div class="separator"></div>
    <button class="menu-item" onclick={handleEditLink} role="menuitem">
      <span class="material-symbols-outlined">edit</span>
      <span class="menu-label">Edit Link</span>
    </button>
    <button class="menu-item" onclick={handleCopyLinkUrl} role="menuitem">
      <span class="material-symbols-outlined">content_copy</span>
      <span class="menu-label">Copy Link URL</span>
    </button>
    <button class="menu-item" onclick={handleRemoveLink} role="menuitem">
      <span class="material-symbols-outlined">link_off</span>
      <span class="menu-label">Remove Link</span>
    </button>
    <div class="separator"></div>
  {/if}

  <!-- Clipboard -->
  <button class="menu-item" onclick={handleCopy} disabled={!hasSelection()} role="menuitem">
    <span class="material-symbols-outlined">content_copy</span>
    <span class="menu-label">Copy</span>
    <span class="menu-shortcut">{mod}C</span>
  </button>
  <button class="menu-item" onclick={handlePaste} role="menuitem">
    <span class="material-symbols-outlined">content_paste</span>
    <span class="menu-label">Paste</span>
    <span class="menu-shortcut">{mod}V</span>
  </button>
  <button class="menu-item" onclick={handleCut} disabled={!hasSelection()} role="menuitem">
    <span class="material-symbols-outlined">content_cut</span>
    <span class="menu-label">Cut</span>
    <span class="menu-shortcut">{mod}X</span>
  </button>

  <div class="separator"></div>

  <!-- Add Link (when NOT on a link) -->
  {#if !isOnLink() && !isOnWikilink()}
    <button class="menu-item" onclick={handleLink} role="menuitem">
      <span class="material-symbols-outlined">link</span>
      <span class="menu-label">Add Link</span>
      <span class="menu-shortcut">{mod}K</span>
    </button>

    <div class="separator"></div>
  {/if}

  <!-- Undo / Redo -->
  <button class="menu-item" onclick={handleUndo} disabled={!editor.can().undo()} role="menuitem">
    <span class="material-symbols-outlined">undo</span>
    <span class="menu-label">Undo</span>
    <span class="menu-shortcut">{mod}Z</span>
  </button>
  <button class="menu-item" onclick={handleRedo} disabled={!editor.can().redo()} role="menuitem">
    <span class="material-symbols-outlined">redo</span>
    <span class="menu-label">Redo</span>
    <span class="menu-shortcut">{mod}{isMac ? '⇧Z' : 'Y'}</span>
  </button>

  {#if hasSelection()}
    <div class="separator"></div>

    <!-- Format submenu -->
    <div class="submenu-trigger" role="menuitem" aria-haspopup="true">
      <span class="material-symbols-outlined">text_format</span>
      <span class="menu-label">Format</span>
      <span class="material-symbols-outlined submenu-arrow">chevron_right</span>
      <div class="submenu">
        <button class="menu-item" class:active={isBold()} onclick={handleBold} role="menuitem">
          <span class="material-symbols-outlined">format_bold</span>
          <span class="menu-label">Bold</span>
          <span class="menu-shortcut">{mod}B</span>
        </button>
        <button class="menu-item" class:active={isItalic()} onclick={handleItalic} role="menuitem">
          <span class="material-symbols-outlined">format_italic</span>
          <span class="menu-label">Italic</span>
          <span class="menu-shortcut">{mod}I</span>
        </button>
        <button class="menu-item" class:active={isStrike()} onclick={handleStrike} role="menuitem">
          <span class="material-symbols-outlined">strikethrough_s</span>
          <span class="menu-label">Strikethrough</span>
        </button>
        <button class="menu-item" class:active={isCode()} onclick={handleCode} role="menuitem">
          <span class="material-symbols-outlined">code</span>
          <span class="menu-label">Inline Code</span>
        </button>
      </div>
    </div>
  {/if}

  <div class="separator"></div>

  <!-- Turn into submenu -->
  <div class="submenu-trigger" role="menuitem" aria-haspopup="true">
    <span class="material-symbols-outlined">transform</span>
    <span class="menu-label">Turn into</span>
    <span class="material-symbols-outlined submenu-arrow">chevron_right</span>
    <div class="submenu">
      <button class="menu-item" onclick={handleParagraph} class:active={editor.isActive('paragraph') && !editor.isActive('heading')} role="menuitem">
        <span class="material-symbols-outlined">notes</span>
        <span class="menu-label">Paragraph</span>
      </button>
      <button class="menu-item" onclick={() => handleHeading(1)} class:active={editor.isActive('heading', { level: 1 })} role="menuitem">
        <span class="material-symbols-outlined">title</span>
        <span class="menu-label">Heading 1</span>
      </button>
      <button class="menu-item" onclick={() => handleHeading(2)} class:active={editor.isActive('heading', { level: 2 })} role="menuitem">
        <span class="material-symbols-outlined">title</span>
        <span class="menu-label">Heading 2</span>
      </button>
      <button class="menu-item" onclick={() => handleHeading(3)} class:active={editor.isActive('heading', { level: 3 })} role="menuitem">
        <span class="material-symbols-outlined">title</span>
        <span class="menu-label">Heading 3</span>
      </button>
      <div class="separator"></div>
      <button class="menu-item" onclick={handleBulletList} class:active={editor.isActive('bulletList')} role="menuitem">
        <span class="material-symbols-outlined">format_list_bulleted</span>
        <span class="menu-label">Bullet List</span>
      </button>
      <button class="menu-item" onclick={handleOrderedList} class:active={editor.isActive('orderedList')} role="menuitem">
        <span class="material-symbols-outlined">format_list_numbered</span>
        <span class="menu-label">Numbered List</span>
      </button>
      <button class="menu-item" onclick={handleBlockquote} class:active={editor.isActive('blockquote')} role="menuitem">
        <span class="material-symbols-outlined">format_quote</span>
        <span class="menu-label">Blockquote</span>
      </button>
      <button class="menu-item" onclick={handleCodeBlock} class:active={editor.isActive('codeBlock')} role="menuitem">
        <span class="material-symbols-outlined">terminal</span>
        <span class="menu-label">Code Block</span>
      </button>
    </div>
  </div>

  <div class="separator"></div>
  <button class="menu-item" onclick={handleClearFormatting} role="menuitem">
    <span class="material-symbols-outlined">format_clear</span>
    <span class="menu-label">Clear Formatting</span>
  </button>
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: 50;
    min-width: 200px;
    max-width: 280px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 4px;
    overflow: visible;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-size: 13px;
    font-family: inherit;
    line-height: 1;
    box-sizing: border-box;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.1s ease;
  }

  .menu-item:hover:not(:disabled) {
    background: var(--color-border, #27272a);
  }

  .menu-item:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .menu-item.active {
    color: var(--color-primary, #00E5FF);
  }

  .menu-item .material-symbols-outlined {
    font-size: 16px;
    width: 18px;
    text-align: center;
    flex-shrink: 0;
    color: var(--color-text-secondary, #a1a1aa);
  }

  .menu-item.active .material-symbols-outlined {
    color: var(--color-primary, #00E5FF);
  }

  .menu-label {
    flex: 1;
  }

  .menu-shortcut {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, monospace);
    flex-shrink: 0;
  }

  .separator {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: 4px 0;
  }

  /* ── Submenu trigger ─────────────────────────────────── */

  .submenu-trigger {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-size: 13px;
    font-family: inherit;
    line-height: 1;
    box-sizing: border-box;
    cursor: default;
    transition: background-color 0.1s ease;
  }

  .submenu-trigger:hover {
    background: var(--color-border, #27272a);
  }

  .submenu-trigger > .material-symbols-outlined {
    font-size: 16px;
    width: 18px;
    text-align: center;
    flex-shrink: 0;
    color: var(--color-text-secondary, #a1a1aa);
  }

  .submenu-trigger > .submenu-arrow {
    font-size: 12px;
    width: auto;
    margin-left: auto;
    color: var(--color-text-dim, #71717a);
  }

  /* ── Submenu panel ─────────────────────────────────── */

  .submenu {
    display: none;
    position: absolute;
    top: -4px;
    min-width: 180px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 4px;
    z-index: 51;
    left: 100%;
  }

  .submenu-trigger:hover > .submenu {
    display: block;
  }

  /* Flip submenu to left when parent menu is in the right half of the viewport */
  .context-menu.flip-submenu .submenu {
    left: auto;
    right: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .menu-item {
      transition: none;
    }
  }
</style>
