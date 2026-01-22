
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Replace external dependency with native Electron API to avoid ESM/CommonJS conflicts
const isDev = !app.isPackaged;

// PORTABLE MODE CONFIGURATION
// If running in production (packaged), set the data path to be inside a 'Data' folder 
// next to the executable. This ensures data stays on the USB drive.
if (!isDev) {
  const exePath = path.dirname(process.execPath);
  const dataPath = path.join(exePath, 'GSTNexus_Data');

  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath);
  }
  
  app.setPath('userData', dataPath);
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // 1. Create the browser window.
  const win = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(900, height),
    title: "GST Nexus",
    icon: path.join(__dirname, 'favicon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Simplified for this specific offline use-case
      enableRemoteModule: true,
      webSecurity: false // Optional: Helps if you encounter local file CORS issues
    },
    autoHideMenuBar: true, // Hides menu bar but keeps Alt key access
    backgroundColor: '#f1f5f9', // Matches the app bg
  });

  // 2. Remove the default menu bar completely
  win.setMenuBarVisibility(false);
  
  // 3. Load the app
  // In production, Vite copies public files to dist root. 
  // So electron.js and index.html will be siblings in the dist folder.
  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, 'index.html')}`;

  win.loadURL(startUrl);

  // Open DevTools automatically if in Dev mode
  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

// This method will be called when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit when all windows are closed.
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
