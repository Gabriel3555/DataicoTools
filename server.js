// Servidor para crear facturas y notas crédito en Dataico.
// Sin dependencias. Local: node server.js  →  http://localhost:3000. En Vercel se exporta el manejador.
// No guarda nada: el navegador manda el Auth-token en cada petición (cabecera X-Dataico-Token)
// y este servidor solo lo reenvía a Dataico, que no acepta llamadas directas desde el navegador.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.VERCEL ? undefined : '127.0.0.1';
const DATAICO_BASE = 'https://api.dataico.com/direct/dataico_api/v2';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Rutas de Dataico que se permiten reenviar.
const ALLOWED = [
  { method: 'POST', re: /^\/invoices$/ },
  { method: 'GET', re: /^\/invoices$/ },
  { method: 'GET', re: /^\/invoices\/[\w-]+$/ },
  // Corrige y reenvía una factura rechazada por la DIAN (mismo consecutivo).
  { method: 'PUT', re: /^\/invoices\/[\w-]+$/ },
  { method: 'POST', re: /^\/credit_notes$/ },
  { method: 'GET', re: /^\/credit_notes$/ },
  { method: 'GET', re: /^\/credit_notes\/[\w-]+$/ },
  { method: 'GET', re: /^\/numberings\/(invoice|credit-note)$/ },
];

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function proxy(req, res, dataicoPath, search) {
  const rule = ALLOWED.find((r) => r.method === req.method && r.re.test(dataicoPath));
  if (!rule) return send(res, 404, { error: 'Ruta no permitida: ' + req.method + ' ' + dataicoPath });

  const authToken = String(req.headers['x-dataico-token'] || '').trim();
  if (!authToken) return send(res, 400, { error: 'Ingresa el Auth-token en la pestaña Configuración.' });

  let bodyText;
  if (req.method === 'POST' || req.method === 'PUT') {
    bodyText = await readBody(req);
    try {
      JSON.parse(bodyText);
    } catch {
      return send(res, 400, { error: 'El JSON enviado no es válido.' });
    }
  }

  let upstream;
  try {
    upstream = await fetch(DATAICO_BASE + dataicoPath + search, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'Auth-token': authToken },
      body: bodyText,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return send(res, 502, { error: 'No se pudo conectar con Dataico: ' + err.message });
  }

  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Dataico a veces devuelve saltos de línea sin escapar dentro de los mensajes de error.
    try {
      data = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      data = { raw: text };
    }
  }

  send(res, 200, { status: upstream.status, ok: upstream.ok, data });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p.startsWith('/api/dataico/')) return proxy(req, res, p.slice('/api/dataico'.length), url.search);

  if (req.method === 'GET') {
    const file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
    if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      return send(res, 200, fs.readFileSync(file), (types[path.extname(file)] || 'text/plain') + '; charset=utf-8');
    }
  }
  send(res, 404, { error: 'No encontrado' });
}

function listener(req, res) {
  handle(req, res).catch((err) => send(res, 500, { error: err.message }));
}

module.exports = listener;

if (require.main === module) {
  http.createServer(listener).listen(PORT, HOST, () => {
    console.log(`Facturas Dataico en http://localhost:${PORT}`);
  });
}
