// Servidor local para crear facturas y notas crédito en Dataico.
// Sin dependencias: node server.js  →  http://localhost:3000
// El Auth-token nunca sale al navegador; este servidor lo agrega al reenviar a Dataico.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const DATAICO_BASE = 'https://api.dataico.com/direct/dataico_api/v2';
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
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
  { method: 'GET', re: /^\/numberings\/(invoice|credit-note|debit-note|support-doc)$/ },
];

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// Variables de entorno tienen prioridad sobre data/config.json.
function getConfig() {
  const saved = readJson(CONFIG_FILE, {});
  return {
    authToken: process.env.DATAICO_AUTH_TOKEN || saved.authToken || '',
    accountId: process.env.DATAICO_ACCOUNT_ID || saved.accountId || '',
    env: process.env.DATAICO_ENV || saved.env || 'PRUEBAS',
    invoicePrefix: saved.invoicePrefix ?? 'SETP',
    resolutionNumber: saved.resolutionNumber ?? '18760000001',
    creditNotePrefix: saved.creditNotePrefix ?? 'NC',
    sendEmail: saved.sendEmail ?? false,
  };
}

function publicConfig() {
  const { authToken, ...rest } = getConfig();
  return { ...rest, hasToken: Boolean(authToken), tokenHint: authToken ? '••••' + authToken.slice(-4) : '' };
}

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

function addHistory(kind, requestBody, status, data, method) {
  const doc = (data && (data.invoice || data.credit_note)) || data || {};
  const reqDoc = requestBody.invoice || requestBody.credit_note || {};
  const history = readJson(HISTORY_FILE, []);
  history.unshift({
    at: new Date().toISOString(),
    kind,
    env: reqDoc.env,
    status,
    number: doc.number || reqDoc.number || '',
    prefix: reqDoc.numbering?.prefix || '',
    uuid: doc.uuid || '',
    cufe: doc.cufe || doc.cude || '',
    dian_status: doc.dian_status || '',
    pdf_url: doc.pdf_url || '',
    xml_url: doc.xml_url || '',
    customer: reqDoc.customer?.company_name ||
      [reqDoc.customer?.first_name, reqDoc.customer?.family_name].filter(Boolean).join(' ') || '',
    invoice_id: reqDoc.invoice_id || '',
    correction: method === 'PUT',
    request: requestBody,
    response: data,
  });
  writeJson(HISTORY_FILE, history.slice(0, 500));
}

async function proxy(req, res, dataicoPath, search) {
  const rule = ALLOWED.find((r) => r.method === req.method && r.re.test(dataicoPath));
  if (!rule) return send(res, 404, { error: 'Ruta no permitida: ' + req.method + ' ' + dataicoPath });

  const cfg = getConfig();
  if (!cfg.authToken) return send(res, 400, { error: 'Configura el Auth-token en la pestaña Configuración.' });

  let bodyText;
  let bodyJson;
  const sendsBody = req.method === 'POST' || req.method === 'PUT';
  if (sendsBody) {
    bodyText = await readBody(req);
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      return send(res, 400, { error: 'El JSON enviado no es válido.' });
    }
  }

  let upstream;
  try {
    upstream = await fetch(DATAICO_BASE + dataicoPath + search, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'Auth-token': cfg.authToken },
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

  if (sendsBody) {
    addHistory(dataicoPath.startsWith('/invoices') ? 'factura' : 'nota_credito', bodyJson, upstream.status, data, req.method);
  }
  send(res, 200, { status: upstream.status, ok: upstream.ok, data });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/api/config' && req.method === 'GET') return send(res, 200, publicConfig());
  if (p === '/api/config' && req.method === 'POST') {
    const incoming = JSON.parse((await readBody(req)) || '{}');
    const saved = readJson(CONFIG_FILE, {});
    for (const key of ['accountId', 'env', 'invoicePrefix', 'resolutionNumber', 'creditNotePrefix', 'sendEmail']) {
      if (key in incoming) saved[key] = incoming[key];
    }
    // Un token vacío significa "no cambiar".
    if (incoming.authToken) saved.authToken = incoming.authToken.trim();
    if (saved.env !== 'PRUEBAS' && saved.env !== 'PRODUCCION') saved.env = 'PRUEBAS';
    writeJson(CONFIG_FILE, saved);
    return send(res, 200, publicConfig());
  }
  if (p === '/api/history' && req.method === 'GET') return send(res, 200, readJson(HISTORY_FILE, []));
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

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => send(res, 500, { error: err.message }));
  })
  .listen(PORT, HOST, () => {
    const cfg = getConfig();
    console.log(`Facturas Dataico en http://localhost:${PORT}  (ambiente: ${cfg.env})`);
  });
