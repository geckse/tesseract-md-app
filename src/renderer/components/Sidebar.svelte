<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  interface NavItem {
    icon: string;
    label: string;
    id: string;
  }

  interface FolderItem {
    icon: string;
    label: string;
    id: string;
    expanded?: boolean;
    children?: { label: string; id: string; active?: boolean }[];
  }

  export let userName = 'Alex Designer';
  export let userInitials = 'AD';
  export let userPlan = 'Pro';

  const collections: NavItem[] = [
    { icon: 'star', label: 'Favorites', id: 'favorites' },
    { icon: 'schedule', label: 'Recent', id: 'recent' },
  ];

  let folders: FolderItem[] = [
    {
      icon: 'folder_open',
      label: 'Project Alpha',
      id: 'project-alpha',
      expanded: true,
      children: [
        { label: 'Research Notes', id: 'research-notes' },
        { label: 'Design Specs.md', id: 'design-specs', active: true },
        { label: 'Meeting Logs', id: 'meeting-logs' },
      ],
    },
    { icon: 'folder', label: 'Marketing', id: 'marketing', expanded: false, children: [] },
    { icon: 'folder', label: 'Engineering', id: 'engineering', expanded: false, children: [] },
  ];

  function handleNavClick(id: string) {
    dispatch('navigate', { id });
  }

  function toggleFolder(index: number) {
    folders[index].expanded = !folders[index].expanded;
  }

  function handleFileClick(folderId: string, fileId: string) {
    dispatch('file-select', { folderId, fileId });
  }
</script>

<aside class="sidebar">
  <!-- Logo -->
  <div class="logo-area">
    <div class="logo-icon">
      <span class="material-symbols-outlined">database</span>
    </div>
    <span class="logo-text">mdvdb</span>
  </div>

  <!-- Scrollable content -->
  <div class="nav-content">
    <!-- Collections -->
    <div class="nav-section">
      <h3 class="section-header">Collections</h3>
      <nav class="nav-list">
        {#each collections as item}
          <button class="nav-item" on:click={() => handleNavClick(item.id)}>
            <span class="material-symbols-outlined nav-icon">{item.icon}</span>
            <span class="nav-label">{item.label}</span>
          </button>
        {/each}
      </nav>
    </div>

    <!-- Knowledge Base -->
    <div class="nav-section">
      <h3 class="section-header">Knowledge Base</h3>
      <nav class="nav-list">
        {#each folders as folder, i}
          <div class="folder-group">
            <button
              class="nav-item folder-button"
              class:expanded={folder.expanded}
              on:click={() => toggleFolder(i)}
            >
              <span class="material-symbols-outlined nav-icon folder-icon">
                {folder.expanded ? 'folder_open' : 'folder'}
              </span>
              <span class="nav-label folder-label">{folder.label}</span>
              <span class="material-symbols-outlined chevron">
                {folder.expanded ? 'expand_more' : 'chevron_right'}
              </span>
            </button>

            {#if folder.expanded && folder.children && folder.children.length > 0}
              <div class="folder-children">
                {#each folder.children as child}
                  <button
                    class="file-item"
                    class:active={child.active}
                    on:click={() => handleFileClick(folder.id, child.id)}
                  >
                    <span class="material-symbols-outlined file-icon">description</span>
                    <span class="file-label">{child.label}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
    </div>
  </div>

  <!-- User area -->
  <div class="user-area">
    <button class="user-button">
      <div class="user-avatar">{userInitials}</div>
      <div class="user-info">
        <span class="user-name">{userName}</span>
        <span class="user-plan">{userPlan}</span>
      </div>
    </button>
  </div>
</aside>

<style>
  .sidebar {
    width: 256px;
    min-width: 256px;
    background: var(--color-surface-darker, #0a0a0a);
    border-right: 1px solid var(--color-border, #27272a);
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    z-index: 20;
  }

  .logo-area {
    height: 56px;
    display: flex;
    align-items: center;
    padding: 0 20px;
    border-bottom: 1px solid var(--color-border, #27272a);
    gap: 12px;
  }

  .logo-icon {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: var(--color-primary, #00E5FF);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-surface-darker, #0a0a0a);
    box-shadow: 0 0 10px rgba(0, 229, 255, 0.4);
  }

  .logo-icon .material-symbols-outlined {
    font-size: 14px;
    font-weight: bold;
  }

  .logo-text {
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -0.025em;
    color: #fff;
  }

  .nav-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px 0;
  }

  .nav-section {
    padding: 0 12px;
    margin-bottom: 24px;
  }

  .section-header {
    padding: 0 12px;
    font-size: 11px;
    font-weight: 700;
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 12px;
  }

  .nav-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: all 0.15s;
    font-family: inherit;
  }

  .nav-item:hover {
    background: var(--color-surface, #161617);
    color: #fff;
  }

  .nav-item:hover .nav-icon {
    color: var(--color-primary, #00E5FF);
  }

  .nav-icon {
    font-size: 18px;
    transition: color 0.15s;
  }

  .nav-label {
    font-size: 14px;
  }

  .folder-button {
    position: relative;
  }

  .folder-button.expanded {
    background: var(--color-surface, #161617);
    color: #fff;
    border: 1px solid rgba(39, 39, 42, 0.5);
  }

  .folder-button.expanded .folder-icon {
    color: var(--color-primary, #00E5FF);
  }

  .folder-label {
    flex: 1;
    font-weight: 500;
  }

  .chevron {
    font-size: 16px;
    color: var(--color-text-dim, #71717a);
    opacity: 0;
    transition: opacity 0.15s;
  }

  .folder-button:hover .chevron,
  .folder-button.expanded .chevron {
    opacity: 1;
  }

  .folder-children {
    padding-left: 12px;
    margin-left: 16px;
    margin-top: 4px;
    border-left: 1px solid var(--color-border, #27272a);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 4px;
    padding-bottom: 4px;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 6px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: all 0.15s;
    font-family: inherit;
  }

  .file-item:hover {
    background: var(--color-surface, #161617);
    color: #fff;
  }

  .file-item.active {
    background: rgba(0, 229, 255, 0.1);
    color: var(--color-primary, #00E5FF);
    border-right: 2px solid var(--color-primary, #00E5FF);
  }

  .file-item.active .file-label {
    font-weight: 500;
  }

  .file-icon {
    font-size: 16px;
  }

  .file-label {
    font-size: 14px;
  }

  .user-area {
    padding: 16px;
    border-top: 1px solid var(--color-border, #27272a);
    margin-top: auto;
    background: var(--color-surface-darker, #0a0a0a);
  }

  .user-button {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border-radius: 6px;
    background: none;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
    font-family: inherit;
  }

  .user-button:hover {
    background: var(--color-surface, #161617);
  }

  .user-button:hover .user-avatar {
    border-color: var(--color-primary, #00E5FF);
  }

  .user-avatar {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: linear-gradient(135deg, #374151, #111827);
    border: 1px solid var(--color-border, #27272a);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-dim, #71717a);
    font-weight: 700;
    font-size: 12px;
    transition: border-color 0.15s;
  }

  .user-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .user-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
  }

  .user-plan {
    font-size: 10px;
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
