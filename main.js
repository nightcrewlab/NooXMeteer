const { app, BrowserWindow, session, desktopCapturer, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let win, tray, quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWin());

function showWin() {
  if (!win) return;
  win.show(); if (win.isMinimized()) win.restore(); win.focus();
}

function create() {
  win = new BrowserWindow({
    width: 480, height: 740, minWidth: 400, minHeight: 560,
    backgroundColor: '#0b0d12', title: 'NooXMeteer',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { backgroundThrottling: false }
  });
  win.setMenu(null);
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && i.key === 'F12') win.webContents.toggleDevTools();
  });
  // Kapatınca sistem tepsisine gönder (ses dağıtımı arka planda sürer)
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });

  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(s => cb({ video: s[0], audio: 'loopback' }));
  });
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(true));
  win.loadFile('index.html');

  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('NooXMeteer');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'NooXMeteer’ı Aç', click: showWin },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWin);
}

app.whenReady().then(create);
app.on('before-quit', () => { quitting = true; });
