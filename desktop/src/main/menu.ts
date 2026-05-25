import { type BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * Build the application menu (Phase: post-launch undo/redo).
 *
 * The Edit submenu's Undo/Redo items send `menu:undo` / `menu:redo`
 * push events to the renderer via `webContents.send`. The renderer's
 * `useUndo` hook subscribes and then calls the `undo:do` IPC channel
 * itself — going through the renderer keeps query-cache invalidation
 * + toast surfacing aligned with what direct ⌘Z presses (intercepted
 * by the renderer's keyboard listener inside an input field, say)
 * would do.
 *
 * macOS gets the standard `appMenu` first per platform convention;
 * Windows/Linux don't get the app menu (Electron skips it by default).
 *
 * Accelerators:
 *  - Undo:  ⌘Z on macOS, Ctrl+Z on Windows/Linux
 *  - Redo:  ⇧⌘Z on macOS (Apple HIG), Ctrl+Y on Windows/Linux (per
 *    Windows + Office convention; both apps that ship on both
 *    platforms — VS Code, Notion — wire it the same way).
 */
export function buildAppMenu(getWin: () => BrowserWindow | null): Menu {
  const isMac = process.platform === 'darwin';

  const editSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Undo',
      accelerator: 'CmdOrCtrl+Z',
      click: () => {
        getWin()?.webContents.send('menu:undo', {});
      },
    },
    {
      label: 'Redo',
      accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
      click: () => {
        getWin()?.webContents.send('menu:redo', {});
      },
    },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
  ];

  const template: MenuItemConstructorOptions[] = [];
  if (isMac) template.push({ role: 'appMenu' });
  template.push({ label: 'Edit', submenu: editSubmenu });
  template.push({ role: 'viewMenu' });
  template.push({ role: 'windowMenu' });
  return Menu.buildFromTemplate(template);
}
