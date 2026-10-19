// Records assets/inspector.gif, the image at the top of the README: the examples/react-vite app
// with the inspector panel open, driven on the example's virtual clock (`?demo`, see
// examples/react-vite/src/demo.ts) so that every run produces the same frames. It builds the
// example, serves its dist/ from this process, drives the system Chrome through playwright-core
// (channel 'chrome': no browser download), takes one screenshot per scene and encodes the frames
// with gifenc, one global palette for the whole file. The timeline runs at 10 frames a second; a
// scene that holds is one frame with a longer delay, so holds cost nothing and the file stays
// small. Identical consecutive frames are merged the same way.
//
//   npm run docs:gif
//
// The page uses system-ui, so the pixels depend on the fonts Chrome finds on the machine; the
// committed file was made on macOS. The frames, their order and their timing are the same
// everywhere, and the script fails if the story on screen is not the one the captions tell.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import gifenc from 'gifenc';
import { chromium } from 'playwright-core';

const { GIFEncoder, applyPalette, quantize } = gifenc;

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'examples', 'react-vite', 'dist');
const out = join(root, 'assets', 'inspector.gif');

const WIDTH = 800;
const HEIGHT = 780;
const FRAME_MS = 100; // 10 frames a second: every hold is rounded to this
const MAX_BYTES = 2_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The story, one scene per frame. `after` moves the virtual clock before the action, `click` is
 * a button's accessible name (and which one of several), `say` the caption above the page,
 * `hold` how long the frame stays. `offer` asserts whether the upgrade offer is on screen after
 * the scene, so a change to the preset or the example that breaks the story fails the run.
 */
const SCENES = [
  {
    say: 'A new visitor. The upgrade intent starts at its prior; the panel is the inspector.',
    hold: 2000,
    offer: false,
  },
  {
    click: ['See details', 1],
    say: 'pricing.viewed, weight 3: p and the lower bound both move up.',
    hold: 1200,
    offer: false,
  },
  {
    after: 75 * MINUTE,
    click: ['Hit a plan limit', 0],
    say: 'A new session, 75 minutes later: limit.hit, weight 2.',
    hold: 1200,
    offer: false,
  },
  {
    after: 80 * MINUTE,
    click: ['See details', 0],
    say: 'pricing.viewed again. A new session, so it counts in full.',
    hold: 1200,
    offer: false,
  },
  {
    after: 90 * MINUTE,
    click: ['Export', 0],
    say: 'export.clicked, weight 1. p is near 0.5, the lower bound is not: no reveal yet.',
    hold: 1400,
    offer: false,
  },
  {
    after: 2 * HOUR,
    click: ['See details', 2],
    say: 'pricing.viewed. The gate needs p and the lower bound both at 0.5.',
    hold: 1200,
    offer: false,
  },
  {
    after: 90 * MINUTE,
    click: ['Hit a plan limit', 0],
    say: 'limit.hit. The lower bound is close.',
    hold: 1200,
    offer: false,
  },
  {
    after: 2 * HOUR,
    click: ['See details', 1],
    say: 'pricing.viewed: both clear 0.5. The offer appears and markRevealed starts the cooldown.',
    hold: 2500,
    offer: true,
  },
  {
    after: 8 * DAY,
    say: 'Eight days later: the cooldown is over and the evidence has decayed toward the prior.',
    hold: 2500,
    offer: true,
  },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
};

/** Serves the example's build from this process on an ephemeral port. */
function serve() {
  const server = createServer((req, res) => {
    const path = normalize(new URL(req.url ?? '/', 'http://localhost').pathname);
    const file = join(dist, path === '/' ? 'index.html' : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolvePort) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolvePort({ server, port: typeof address === 'object' && address ? address.port : 0 });
    });
  });
}

/** An 8-bit, non-interlaced RGB or RGBA PNG (what Chrome writes) as RGBA bytes. */
function decodePng(buffer) {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 8; // signature
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (pos < data.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...data.subarray(pos + 4, pos + 8));
    const body = data.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const [depth, colorType, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`png: expected 8-bit RGB or RGBA, got depth ${depth} type ${colorType}`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    const line = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = raw[at++];
      let value;
      if (filter === 0) value = v;
      else if (filter === 1) value = v + a;
      else if (filter === 2) value = v + b;
      else if (filter === 3) value = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`png: unknown filter ${filter}`);
      line[x] = value & 255;
    }
  }
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    rgba[j] = pixels[i];
    rgba[j + 1] = pixels[i + 1];
    rgba[j + 2] = pixels[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

/** Two animation frames and a tick, so React's render and the inspector's effect have run. */
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 50))),
      ),
  );

async function record() {
  console.log('record-inspector: building examples/react-vite');
  execFileSync('npm', ['run', 'build', '-w', 'examples/react-vite'], {
    cwd: root,
    stdio: 'ignore',
  });
  const { server, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const frames = [];
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/?demo`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.oracularDemo === 'object');
    const meter = page.getByText(/^p \d\.\d{3} · lower bound /);
    const framesDir = process.env.ORACULAR_GIF_FRAMES; // for a look at the frames while editing SCENES
    const offer = page.getByText('Ready for Pro?');

    for (const [i, scene] of SCENES.entries()) {
      if (scene.after) await page.evaluate((ms) => window.oracularDemo.advance(ms), scene.after);
      if (scene.say) await page.evaluate((text) => window.oracularDemo.say(text), scene.say);
      if (scene.click) {
        const [name, nth] = scene.click;
        await page.getByRole('button', { name, exact: true }).nth(nth).click();
      }
      await settle(page);
      // Every frame is the top of the page, and the whole story has to fit in it.
      const scrolled = await page.evaluate(() => window.scrollY);
      if (scrolled !== 0) throw new Error(`scene ${i + 1}: the page scrolled; raise HEIGHT`);
      const box = (await offer.count()) > 0 ? await offer.boundingBox() : null;
      if ((box !== null) !== scene.offer) {
        throw new Error(
          `scene ${i + 1}: expected the offer to be ${scene.offer ? 'shown' : 'absent'}; the preset or the example changed, update SCENES`,
        );
      }
      if (box !== null && box.y + box.height > HEIGHT) {
        throw new Error(`scene ${i + 1}: the offer is below the frame; raise HEIGHT`);
      }
      const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
      if (framesDir)
        writeFileSync(join(framesDir, `scene-${String(i + 1).padStart(2, '0')}.png`), png);
      console.log(`scene ${i + 1}: ${(await meter.textContent())?.trim()}`);
      frames.push({ png, hold: Math.max(FRAME_MS, Math.round(scene.hold / FRAME_MS) * FRAME_MS) });
    }
    if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
  } finally {
    await browser.close();
    server.close();
  }
  return frames;
}

function encode(frames) {
  // Merge identical consecutive frames into one with the summed delay.
  const distinct = [];
  for (const frame of frames) {
    const hash = createHash('sha1').update(frame.png).digest('hex');
    const last = distinct[distinct.length - 1];
    if (last && last.hash === hash) last.hold += frame.hold;
    else distinct.push({ ...frame, hash });
  }
  const decoded = distinct.map((frame) => ({ ...frame, ...decodePng(frame.png) }));
  for (const frame of decoded) {
    if (frame.width !== WIDTH || frame.height !== HEIGHT) {
      throw new Error(`frame is ${frame.width}x${frame.height}, expected ${WIDTH}x${HEIGHT}`);
    }
  }
  // One palette for the whole file, from every third pixel of every distinct frame.
  const step = 3;
  const perFrame = Math.ceil((WIDTH * HEIGHT) / step);
  const sample = new Uint8Array(perFrame * decoded.length * 4);
  let k = 0;
  for (const frame of decoded) {
    for (let p = 0; p < WIDTH * HEIGHT; p += step) {
      sample.set(frame.rgba.subarray(p * 4, p * 4 + 4), k);
      k += 4;
    }
  }
  const palette = quantize(sample.subarray(0, k), 256, { format: 'rgb565' });
  const gif = GIFEncoder();
  decoded.forEach((frame, i) => {
    const index = applyPalette(frame.rgba, palette, 'rgb565');
    gif.writeFrame(index, WIDTH, HEIGHT, {
      palette: i === 0 ? palette : undefined,
      delay: frame.hold,
      repeat: 0,
    });
  });
  gif.finish();
  const bytes = gif.bytes();
  const duration = decoded.reduce((sum, frame) => sum + frame.hold, 0);
  return { bytes, duration, frames: decoded.length, colors: palette.length };
}

const frames = await record();
const { bytes, duration, frames: count, colors } = encode(frames);
if (bytes.length > MAX_BYTES) {
  throw new Error(
    `inspector.gif is ${bytes.length} bytes, over the ${MAX_BYTES} byte limit: shorten the story`,
  );
}
writeFileSync(out, bytes);
console.log(
  `record-inspector: wrote assets/inspector.gif, ${WIDTH}x${HEIGHT}, ${count} frames over ${(duration / 1000).toFixed(1)} s, ${colors} colors, ${(bytes.length / 1024).toFixed(0)} KiB`,
);
