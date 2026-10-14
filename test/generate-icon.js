// Render the repository-native SVG into Windows distribution assets. No external service.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.test-artifacts', 'icon-render');
fs.mkdirSync(cache, { recursive: true });
app.setPath('userData', path.join(cache, 'profile'));
app.setPath('sessionData', path.join(cache, 'session'));
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 512, height: 512, frame: false, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true } });
    const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
    await win.loadURL('data:text/html;charset=utf-8,<html></html>');
    const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const data = await win.webContents.executeJavaScript(`(async () => {
      const image = new Image(); image.src = ${JSON.stringify(uri)};
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      canvas.getContext('2d').drawImage(image, 0, 0, 512, 512);
      return canvas.toDataURL('image/png');
    })()`);
    const image = nativeImage.createFromBuffer(Buffer.from(data.split(',')[1], 'base64'));
    const png = image.resize({ width: 512, height: 512 }).toPNG();
    fs.writeFileSync(path.join(root, 'assets/icon.png'), png);
    const frames = [32, 64, 256].map(size => ({ size, png: image.resize({ width: size, height: size }).toPNG() }));
    const header = Buffer.alloc(6 + 16 * frames.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
    let offset = header.length;
    frames.forEach(({ size, png }, index) => {
      const entry = 6 + index * 16;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += png.length;
    });
    fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([header, ...frames.map(frame => frame.png)]));
    console.log('PASS: SVG rendered to 512px PNG and 32/64/256px Windows ICO.'); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
