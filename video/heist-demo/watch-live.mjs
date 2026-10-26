/** Archive only the public projection of a real mission for production evidence.
 * Usage: node video/heist-demo/watch-live.mjs ROOM [origin]
 * No Twitch credentials, browser tokens, or private dossiers are read or saved.
 */
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const roomId = process.argv[2]?.toUpperCase();
if (!/^[A-Z0-9]{6}$/.test(roomId || '')) throw new Error('Supply the six-character mission ID.');
const origin = new URL(process.argv[3] || 'http://127.0.0.1:3000').origin;
const out = resolve('artifacts/live-verification', roomId);
await mkdir(out, { recursive: true });
const source = `${origin}/api/rooms/${roomId}/events`;
const startedAt = new Date().toISOString();
await writeFile(`${out}/source.json`, JSON.stringify({ roomId, origin, startedAt,
  source: 'Real HEIST public SSE projection; incoming Twitch messages are identified by source=twitch.',
  caveat: 'Connected status alone does not prove incoming commands, outgoing replies, viewers, or OBS.' }, null, 2));
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), 30 * 60 * 1000);
const stop = () => abort.abort();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
let signature = '', buffer = '', count = 0;
const decoder = new TextDecoder();
try {
  const response = await fetch(source, { signal: abort.signal });
  if (!response.ok) throw new Error(`Public mission feed returned HTTP ${response.status}.`);
  console.log(`Archiving public live evidence for mission ${roomId}; no credentials recorded.`);
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, split); buffer = buffer.slice(split + 2);
      const line = event.split('\n').find(value => value.startsWith('data: '));
      if (!line) continue;
      const state = JSON.parse(line.slice(6));
      const { clock, ...stable } = state;
      const next = JSON.stringify(stable);
      if (next === signature) continue;
      signature = next;
      const entry = { receivedAt: new Date().toISOString(), state };
      await appendFile(`${out}/events.jsonl`, JSON.stringify(entry) + '\n');
      await writeFile(`${out}/latest.json`, JSON.stringify(entry, null, 2));
      const incoming = state.comms.filter(message => message.source === 'twitch');
      console.log(`Evidence update ${++count}: ${state.bridge.status}; ${incoming.length} incoming Twitch communications; ${state.crew.total} crew; stage ${state.stageIndex + 1}.`);
    }
  }
} catch (error) {
  if (error.name !== 'AbortError') console.error(error.message);
} finally {
  clearTimeout(timer);
  console.log('Public live evidence recording closed.');
}
