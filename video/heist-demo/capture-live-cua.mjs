/** Paste this helper into the CUA REPL after selecting the intended app/chat tab.
 * The screenshot API records the real page. No hidden app state is read.
 * Example: await captureLive(tab, {name:'vote-chat',roomId:'ABC123',
 * directory:'/absolute/path/to/artifacts/live-verification/ABC123/frames',
 * source:'Actual Twitch chat, broadcaster account test',seconds:14});
 * Encode with: python3 video/heist-demo/assemble-live-capture.py ABC123
 */
var captureFs = await import('node:fs/promises');
async function captureLive(tab, { name, roomId, directory, source, seconds = 14 }) {
  if (!/^[a-z0-9_-]+$/.test(name) || !/^[A-Z0-9]{6}$/.test(roomId) || seconds <= 0 || seconds > 20) {
    throw new Error('Use a capture name, mission ID and duration between 0 and 20 seconds.');
  }
  const url = new URL(await tab.url());
  const localApp = ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '3000'
    && new RegExp(`^/(play|crew)/${roomId}$`).test(url.pathname);
  const twitchChat = url.protocol === 'https:' && url.hostname === 'www.twitch.tv'
    && /^\/popout\/[a-zA-Z0-9_]+\/chat$/.test(url.pathname);
  if ((!localApp && !twitchChat) || url.search || url.hash) {
    throw new Error('Capture only the selected clean HEIST or Twitch chat URL, never authorization pages.');
  }
  await captureFs.mkdir(directory, { recursive: true });
  const timingFile = `${directory}/${name}-timing.json`;
  try { await captureFs.access(timingFile); throw new Error('Choose a new capture name to preserve the existing source.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const start = Date.now(), frames = [];
  while (Date.now() - start < seconds * 1000) {
    const at = Date.now();
    const bytes = await tab.screenshot({ fullPage: false });
    const file = `${name}-${String(frames.length).padStart(5, '0')}.png`;
    await captureFs.writeFile(`${directory}/${file}`, bytes);
    frames.push({ file, offsetSeconds: (at - start) / 1000 });
  }
  const timing = { source, roomId, startedAt: new Date(start).toISOString(),
    durationSeconds: (Date.now() - start) / 1000, frames };
  await captureFs.writeFile(timingFile, JSON.stringify(timing, null, 2));
  return { recordedFrames: frames.length, durationSeconds: timing.durationSeconds };
}
