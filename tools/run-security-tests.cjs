// DOMPurify security regression runner (Node built-ins only, no playwright/jsdom).
// Launches headless Chrome with remote debugging, opens the test page directly,
// connects via a minimal WebSocket client to the DevTools Protocol, and reports
// the PASS/FAIL results the test page writes into <pre id="results">.
// Exits non-zero if any check fails.
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER_PORT = 8912;
const CDP_PORT = 9222;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TEST_URL = 'http://127.0.0.1:' + SERVER_PORT + '/tests/security-dompurify.html';

let failures = 0;
function log(m) { console.log(m); }

// ---------- static file server (serves repo root) ----------
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? '/index.html' : req.url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ct = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => resolve(d)); }).on('error', reject);
  });
}

function waitFor(url, retries, delay) {
  const tryOnce = (left) => httpGet(url).then(() => true, () => {
    if (left <= 0) return false;
    return new Promise((r) => setTimeout(r, delay)).then(() => tryOnce(left - 1));
  });
  return tryOnce(retries);
}

// ---------- minimal WebSocket client (proven against headless Chrome) ----------
// onConnected is invoked synchronously once the WebSocket handshake completes.
function wsConnect(url, onConnected) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const socket = net.connect(u.port, u.hostname, () => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = [
        'GET ' + u.pathname + ' HTTP/1.1', 'Host: ' + u.host,
        'Upgrade: websocket', 'Connection: Upgrade',
        'Sec-WebSocket-Key: ' + key, 'Sec-WebSocket-Version: 13', '', ''
      ].join('\r\n');
      socket.write(req);
    });
    let buffered = '', headersDone = false;
    let messageCb = null;
    let closed = false;

    function sendFrame(payload, opcode) {
      if (closed) return;
      const buf = Buffer.from(payload, 'utf8');
      const mk = crypto.randomBytes(4);
      const ext = buf.length >= 65536 ? 8 : buf.length >= 126 ? 2 : 0;
      const out = Buffer.alloc(2 + ext + 4 + buf.length);
      let o = 0;
      out[o++] = 0x80 | opcode;
      if (ext === 8) { out.writeBigUInt64BE(BigInt(buf.length), o); o += 8; }
      else if (ext === 2) { out.writeUInt16BE(buf.length, o); o += 2; }
      else { out[o] = 0x80 | buf.length; o++; }
      mk.copy(out, o); o += 4;
      for (let i = 0; i < buf.length; i++) out[o++] = buf[i] ^ mk[i % 4];
      socket.write(out);
    }

    socket.on('data', (chunk) => {
      buffered += chunk.toString('latin1');
      while (true) {
        if (!headersDone) {
          const idx = buffered.indexOf('\r\n\r\n');
          if (idx === -1) break;
          buffered = buffered.slice(idx + 4); headersDone = true;
          onConnected({
            send: (obj) => sendFrame(JSON.stringify(obj), 1),
            onMessage: (cb) => { messageCb = cb; },
            close: () => { closed = true; try { socket.destroy(); } catch (e) {} }
          });
          continue;
        }
        if (buffered.length < 2) break;
        const b0 = buffered.charCodeAt(0), b1 = buffered.charCodeAt(1);
        const opcode = b0 & 0x0f, masked = !!(b1 & 0x80), len = b1 & 0x7f;
        let off = 2, pl = len;
        if (pl === 126) { if (buffered.length < 4) break; pl = (buffered.charCodeAt(2) << 8) | buffered.charCodeAt(3); off = 4; }
        else if (pl === 127) { if (buffered.length < 10) break; off = 10; pl = 0; }
        if (masked) { if (buffered.length < off + 4) break; off += 4; }
        if (buffered.length < off + pl) break;
        const mk = masked ? [buffered.charCodeAt(off - 4), buffered.charCodeAt(off - 3), buffered.charCodeAt(off - 2), buffered.charCodeAt(off - 1)] : null;
        const payload = buffered.slice(off, off + pl);
        buffered = buffered.slice(off + pl);
        let str = '';
        for (let i = 0; i < payload.length; i++) str += String.fromCharCode(payload.charCodeAt(i) ^ (mk ? mk[i % 4] : 0));
        if (opcode === 1 && messageCb) messageCb(str);
        else if (opcode === 8) { closed = true; socket.destroy(); return; }
      }
    });
    socket.on('error', (e) => { reject(e); });
    setTimeout(() => { if (!headersDone) reject(new Error('WS handshake timeout')); }, 10000);
  });
}

// ---------- CDP session ----------
function createSession(wsUrl) {
  return new Promise((resolve, reject) => {
    wsConnect(wsUrl, (ws) => {
      let nextId = 1, pending = {};
      const eventWaiters = {};
      let pageContextId = 1;
      ws.onMessage((text) => {
        try { var msg = JSON.parse(text); } catch (e) { return; }
        if (msg.id && pending[msg.id]) { pending[msg.id].resolve(msg); delete pending[msg.id]; }
        if (!msg.id && msg.method && eventWaiters[msg.method]) {
          eventWaiters[msg.method](msg.params);
          delete eventWaiters[msg.method];
        }
        if (!msg.id && msg.method === 'Runtime.executionContextCreated') {
          const ctx = msg.params.context;
          if (ctx.origin && ctx.origin.indexOf('127.0.0.1:8912') !== -1) pageContextId = ctx.id;
        }
        if (!msg.id && msg.method === 'Runtime.exceptionThrown') {
          const ed = msg.params.exceptionDetails;
          log('JS EXCEPTION: ' + JSON.stringify({ text: ed.text, desc: ed.exception && ed.exception.description, url: ed.url, line: ed.lineNumber, col: ed.columnNumber, scriptId: ed.scriptId }));
        }
      });
      function waitForEvent(method, ms) {
        return new Promise((res, rej) => {
          eventWaiters[method] = res;
          setTimeout(() => { if (eventWaiters[method]) { delete eventWaiters[method]; rej(new Error('event timeout: ' + method)); } }, ms || 15000);
        });
      }
      function send(method, params) {
        const attempt = (left) => {
          const id = nextId++;
          return new Promise((resolve, reject) => {
            pending[id] = { resolve, reject };
            ws.send({ id, method, params: params || {} });
            setTimeout(() => {
              if (pending[id]) {
                delete pending[id];
                if (left <= 0) reject(new Error('CDP timeout: ' + method));
                else attempt(left - 1);
              }
            }, 6000);
          });
        };
        return attempt(3);
      }
      function evaluate(expr) {
        return send('Runtime.evaluate', { expression: expr, returnByValue: true });
      }
      // Prime the session so Chrome's page backend accepts commands.
      send('Runtime.enable')
        .then(() => resolve({ send, evaluate, waitForEvent, close: () => ws.close() }))
        .catch(reject);
    });
  });
}

(async () => {
  await new Promise((resolve) => server.listen(SERVER_PORT, '127.0.0.1', resolve));
  log('Serving repo root on http://127.0.0.1:' + SERVER_PORT);

  // Launch Chrome headless with remote debugging, opening the test page directly.
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + CDP_PORT,
    '--no-first-run', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    TEST_URL
  ], { stdio: 'ignore' });
  chrome.on('exit', () => {});

  try {
    await waitFor('http://127.0.0.1:' + CDP_PORT + '/json/version', 40, 250);
    log('Chrome remote debugging ready on port ' + CDP_PORT);

    // Find the page target that is our test page.
    let pageTarget = null;
    for (let i = 0; i < 40 && !pageTarget; i++) {
      const list = JSON.parse(await httpGet('http://127.0.0.1:' + CDP_PORT + '/json/list'));
      pageTarget = list.find((t) => t.type === 'page' && t.url === TEST_URL && t.webSocketDebuggerUrl);
      if (!pageTarget) await new Promise((r) => setTimeout(r, 250));
    }
    if (!pageTarget) throw new Error('no usable page target');
    log('Using page target ' + pageTarget.id + ' (' + pageTarget.url + ')');

    const session = await createSession(pageTarget.webSocketDebuggerUrl);
    log('CDP page session established');

    await session.send('Runtime.enable');
    log('Runtime enabled');

    // Read the results the test page wrote into document.title (single evaluate).
    const title = await session.evaluate('document.title');
    const titleVal = title.result && title.result.result && title.result.result.value || '';
    const m = titleVal.match(/^SECURITY_RESULTS::(.*)$/);
    let failedVal = false, resultsText = '';
    if (m) {
      try { const parsed = JSON.parse(m[1]); failedVal = parsed.failed === true; resultsText = parsed.checks || ''; } catch (e) {}
    }
    console.log('\n--- DOMPurify 3.4.17 SECURITY REGRESSION RESULTS ---');
    console.log(resultsText || titleVal);
    console.log('----------------------------------------------------\n');
    failures = failedVal ? 1 : 0;
    if (failedVal) log('SECURITY FAILURE(S) DETECTED');
    try { server.close(); } catch (e) {}
    process.exit(failures > 0 ? 1 : 0);
  } catch (e) {
    console.error('RUNNER ERROR:', e.message);
    try { server.close(); } catch (e2) {}
    process.exit(2);
  }
})();
