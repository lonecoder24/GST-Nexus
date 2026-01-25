
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Determine dev mode
const isDev = !app.isPackaged;

// --- PORTABLE DATA STORAGE CONFIGURATION ---
/**
 * For Portable Windows Apps:
 * app.getPath('exe') points to the temporary extraction folder.
 * process.env.PORTABLE_EXECUTABLE_DIR points to the actual folder where the .exe resides.
 */
if (!isDev) {
  let baseDir;
  
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    // This is the true location of the Portable .exe
    baseDir = process.env.PORTABLE_EXECUTABLE_DIR;
  } else {
    // Fallback for non-portable packaged builds
    baseDir = path.dirname(app.getPath('exe'));
  }
  
  const localDataPath = path.join(baseDir, 'GSTNexus_Data');

  // Create the folder if it doesn't exist
  if (!fs.existsSync(localDataPath)) {
    try {
      fs.mkdirSync(localDataPath, { recursive: true });
    } catch (e) {
      console.error("Could not create local data folder:", e);
    }
  }

  // CRITICAL: Set the userData path before the app is ready
  // This redirects IndexedDB, LocalStorage, and Cache to the portable folder
  try {
    app.setPath('userData', localDataPath);
  } catch (e) {
    console.error("Failed to set userData path:", e);
  }
}
// -------------------------------------------

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(900, height),
    title: "GST Nexus",
    icon: path.join(__dirname, 'favicon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, 
      enableRemoteModule: true,
      webSecurity: false 
    },
    autoHideMenuBar: true,
    backgroundColor: '#f1f5f9',
  });

  win.setMenuBarVisibility(false);
  
  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, 'index.html')}`;

  win.loadURL(startUrl);

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
