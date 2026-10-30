// Interfaz para crear facturas y notas crédito en Dataico (API v2).
// Todas las llamadas pasan por el servidor local (/api/dataico/...), que agrega el Auth-token.

let config = {};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(n || 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "2026-10-29" -> "29/10/2026" (formato que usa Dataico)
const toDataicoDate = (iso) => (iso ? iso.split('-').reverse().join('/') : undefined);
// "29/10/2026" -> "2026-10-29" (para los <input type="date">)
const fromDataicoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s || '').slice(0, 10);
};
const today = () => new Date().toLocaleDateString('en-CA');

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error HTTP ${res.status}`);
  return body;
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'historial') loadHistory();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

const ID_TYPES = [
  ['NIT', 'NIT'], ['CC', 'Cédula de ciudadanía'], ['CE', 'Cédula de extranjería'], ['TI', 'Tarjeta de identidad'],
  ['PASAPORTE', 'Pasaporte'], ['NIT_OTRO_PAIS', 'NIT de otro país'], ['TE', 'Tarjeta de extranjería'],
  ['DE', 'Documento de identificación extranjero'], ['RC', 'Registro civil'], ['PEP', 'PEP'],
  ['PPT', 'Permiso por protección temporal'],
];

function renderCustomer(container) {
  const p = container.dataset.prefix;
  container.innerHTML = `
    <div class="actions" style="justify-content:flex-start;margin-top:0">
      <button type="button" class="secondary small" data-final>Consumidor final</button>
    </div>
    <div class="grid">
      <label>Tipo de persona
        <select name="${p}_party_type">
          <option value="PERSONA_JURIDICA">Persona jurídica</option>
          <option value="PERSONA_NATURAL">Persona natural</option>
        </select>
      </label>
      <label>Tipo de documento
        <select name="${p}_party_identification_type">
          ${ID_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </label>
      <label>Número de identificación<input name="${p}_party_identification" placeholder="sin dígito de verificación" required></label>
      <label data-juridica>Razón social<input name="${p}_company_name"></label>
      <label data-natural hidden>Nombres<input name="${p}_first_name"></label>
      <label data-natural hidden>Apellidos<input name="${p}_family_name"></label>
      <label>Correo<input type="email" name="${p}_email"></label>
      <label>Teléfono<input name="${p}_phone"></label>
      <label>Responsabilidad de IVA
        <input name="${p}_tax_level_code" list="${p}-tax-levels" value="COMUN">
        <datalist id="${p}-tax-levels">
          <option value="COMUN">Responsable de IVA</option>
          <option value="SIMPLIFICADO">No responsable de IVA</option>
          <option value="NO_RESPONSABLE_DE_IVA">No responsable de IVA</option>
        </datalist>
      </label>
      <label>Régimen
        <input name="${p}_regimen" list="${p}-regimenes" value="ORDINARIO">
        <datalist id="${p}-regimenes">
          <option value="ORDINARIO">Ordinario</option>
          <option value="SIMPLE">Régimen simple</option>
          <option value="GRAN_CONTRIBUYENTE">Gran contribuyente</option>
          <option value="AUTORRETENEDOR">Autorretenedor</option>
          <option value="AGENTE_RETENCION_IVA">Agente de retención de IVA</option>
        </datalist>
      </label>
      <label>País (código)<input name="${p}_country_code" value="CO" maxlength="2"></label>
      <label>Departamento (código DANE)<input name="${p}_department" placeholder="ej. 11 (Bogotá)"></label>
      <label>Ciudad (código DANE)<input name="${p}_city" placeholder="ej. 001"></label>
      <label>Dirección<input name="${p}_address_line"></label>
    </div>`;

  const typeSel = $(`[name=${p}_party_type]`, container);
  const syncType = () => {
    const natural = typeSel.value === 'PERSONA_NATURAL';
    $$('[data-natural]', container).forEach((el) => (el.hidden = !natural));
    $$('[data-juridica]', container).forEach((el) => (el.hidden = natural));
  };
  typeSel.addEventListener('change', syncType);

  $('[data-final]', container).addEventListener('click', () => {
    const set = (k, v) => ($(`[name=${p}_${k}]`, container).value = v);
    set('party_type', 'PERSONA_NATURAL');
    set('party_identification_type', 'CC');
    set('party_identification', '222222222222');
    set('first_name', 'Consumidor');
    set('family_name', 'Final');
    set('tax_level_code', 'SIMPLIFICADO');
    set('regimen', 'ORDINARIO');
    // Mismos datos de ubicación que envía Softix para el consumidor final.
    set('country_code', 'CO');
    set('department', '11');
    set('city', '001');
    set('address_line', 'NO APLICA');
    syncType();
  });
}

function fillCustomer(container, c = {}) {
  const p = container.dataset.prefix;
  for (const [k, v] of Object.entries(c)) {
    const input = $(`[name=${p}_${k}]`, container);
    if (input && v != null) input.value = v;
  }
  $(`[name=${p}_party_type]`, container).dispatchEvent(new Event('change'));
}

function readCustomer(container) {
  const p = container.dataset.prefix;
  const v = (k) => $(`[name=${p}_${k}]`, container).value.trim();
  const natural = v('party_type') === 'PERSONA_NATURAL';
  const customer = {
    party_type: v('party_type'),
    party_identification_type: v('party_identification_type'),
    party_identification: v('party_identification'),
    tax_level_code: v('tax_level_code'),
    regimen: v('regimen'),
    email: v('email'),
    phone: v('phone'),
    country_code: v('country_code').toUpperCase(),
    department: v('department'),
    city: v('city'),
    address_line: v('address_line'),
  };
  if (natural) {
    customer.first_name = v('first_name');
    customer.family_name = v('family_name');
  } else {
    customer.company_name = v('company_name');
  }
  return dropEmpty(customer);
}

function dropEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== '' && val !== undefined && val !== null));
}

$$('.customer').forEach(renderCustomer);

/* ------------------------------------------------------------------ */
/* Ítems                                                               */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Retenciones                                                         */
/* ------------------------------------------------------------------ */

const RETENTION_TYPES = [['RET_FUENTE', 'Retención en la fuente'], ['RET_IVA', 'ReteIVA'], ['RET_ICA', 'ReteICA']];

function retentionsTable(el) {
  el.innerHTML = `
    <div data-rows></div>
    <button type="button" class="secondary small" data-add>+ Agregar retención</button>`;
  const box = $('[data-rows]', el);
  // Avisa al formulario para que recalcule los totales.
  const changed = () => el.dispatchEvent(new Event('input', { bubbles: true }));

  function addRow(r = {}) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <label>Tipo
        <select data-f="tax_category">
          ${RETENTION_TYPES.map(([v, l]) => `<option value="${v}" ${r.tax_category === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      <label>Tasa %<input data-f="tax_rate" type="number" min="0" max="100" step="any" value="${esc(r.tax_rate ?? '')}"></label>
      <button type="button" class="danger small" title="Quitar">✕</button>`;
    $('button', row).addEventListener('click', () => { row.remove(); changed(); });
    box.appendChild(row);
    changed();
  }

  $('[data-add]', el).addEventListener('click', () => addRow());

  return {
    get() {
      return $$('.row', box)
        .map((row) => ({ tax_category: $('[data-f=tax_category]', row).value, rate: $('[data-f=tax_rate]', row).value }))
        .filter((r) => r.rate !== '')
        .map((r) => ({ tax_category: r.tax_category, tax_rate: Number(r.rate) }));
    },
    set(list) {
      box.innerHTML = '';
      (list || []).forEach(addRow);
      changed();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ítems                                                               */
/* ------------------------------------------------------------------ */

// extras() devuelve { retentions, prepayment } para mostrar el neto a pagar.
function itemsTable(el, extras) {
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Código</th><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unit.</th>
          <th class="num">% Desc.</th><th>IVA</th><th class="num">Subtotal</th><th></th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <button type="button" class="secondary small" data-add>+ Agregar ítem</button>
      <div class="totals"></div>
    </div>`;
  const tbody = $('tbody', el);

  function addRow(item = {}) {
    const tr = document.createElement('tr');
    const rate = item.iva ?? '19';
    tr.dataset.unit = item.measuring_unit || '94'; // 94 = unidad (código DIAN), como en Softix
    tr.innerHTML = `
      <td><input data-f="sku" value="${esc(item.sku ?? '')}"></td>
      <td><input data-f="description" value="${esc(item.description ?? '')}" required></td>
      <td><input data-f="quantity" type="number" min="0" step="any" value="${item.quantity ?? 1}" required></td>
      <td><input data-f="price" type="number" min="0" step="any" value="${item.price ?? ''}" required></td>
      <td><input data-f="discount_rate" type="number" min="0" max="100" step="any" value="${item.discount_rate ?? 0}"></td>
      <td><select data-f="iva">
        ${[['19', '19%'], ['5', '5%'], ['0', '0%'], ['', 'Excluido']]
          .map(([v, l]) => `<option value="${v}" ${String(rate) === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></td>
      <td class="num" data-subtotal></td>
      <td><button type="button" class="danger small" title="Quitar">✕</button></td>`;
    $('button', tr).addEventListener('click', () => { tr.remove(); recalc(); });
    tbody.appendChild(tr);
    recalc();
  }

  function rows() {
    return $$('tr', tbody).map((tr) => {
      const f = (k) => $(`[data-f=${k}]`, tr).value;
      return {
        tr,
        unit: tr.dataset.unit,
        sku: f('sku').trim(),
        description: f('description').trim(),
        quantity: Number(f('quantity')) || 0,
        price: Number(f('price')) || 0,
        discount_rate: Number(f('discount_rate')) || 0,
        iva: f('iva'),
      };
    });
  }

  function recalc() {
    let base = 0, iva = 0, discount = 0;
    for (const r of rows()) {
      const gross = r.quantity * r.price;
      const disc = gross * (r.discount_rate / 100);
      const net = gross - disc;
      base += net;
      discount += disc;
      iva += r.iva === '' ? 0 : net * (Number(r.iva) / 100);
      $('[data-subtotal]', r.tr).textContent = money(net);
    }
    // Estimado: ReteIVA se calcula sobre el IVA; retefuente y ReteICA sobre la base.
    const { retentions = [], prepayment = 0 } = extras?.() || {};
    const withheld = retentions.reduce((s, r) => s + (r.tax_category === 'RET_IVA' ? iva : base) * (r.tax_rate / 100), 0);
    const total = base + iva;
    $('.totals', el).innerHTML = `
      <div><span>Descuentos</span><span>${money(discount)}</span></div>
      <div><span>Base</span><span>${money(base)}</span></div>
      <div><span>IVA</span><span>${money(iva)}</span></div>
      <div class="grand"><span>Total</span><span>${money(total)}</span></div>
      ${withheld ? `<div><span>Retenciones (estimado)</span><span>−${money(withheld)}</span></div>` : ''}
      ${prepayment ? `<div><span>Anticipo</span><span>−${money(prepayment)}</span></div>` : ''}
      ${withheld || prepayment ? `<div class="grand"><span>Neto a pagar</span><span>${money(total - withheld - prepayment)}</span></div>` : ''}`;
  }

  el.addEventListener('input', recalc);
  $('[data-add]', el).addEventListener('click', () => addRow());
  addRow();

  return {
    recalc,
    // Formato de ítem de Dataico
    get() {
      return rows().map((r) => dropEmpty({
        sku: r.sku || undefined,
        measuring_unit: r.unit,
        description: r.description,
        quantity: r.quantity,
        price: r.price,
        discount_rate: r.discount_rate || undefined,
        // Ítems regalados (100 % de descuento): la DIAN pide el precio de referencia, como hace Softix.
        original_price: r.discount_rate === 100 ? r.price : undefined,
        // Excluidos: Softix omite "taxes" en vez de mandar una lista vacía.
        taxes: r.iva === '' ? undefined : [{ tax_category: 'IVA', tax_rate: Number(r.iva) }],
      }));
    },
    set(items) {
      tbody.innerHTML = '';
      (items.length ? items : [{}]).forEach(addRow);
    },
  };
}

const invoiceRet = retentionsTable($('#ret-factura'));
const noteRet = retentionsTable($('#ret-nota'));
const invoiceItems = itemsTable($('#items-factura'), () => ({
  retentions: invoiceRet.get(),
  prepayment: Number($('#form-factura').elements.prepayment_amount.value) || 0,
}));
const noteItems = itemsTable($('#items-nota'), () => ({ retentions: noteRet.get() }));
$('#form-factura').addEventListener('input', () => invoiceItems.recalc());
$('#form-nota').addEventListener('input', () => noteItems.recalc());

// Convierte ítems de una factura consultada en Dataico a filas de la tabla.
function itemsFromInvoice(inv) {
  return (inv.items || []).map((it) => {
    const iva = (it.taxes || []).find((t) => (t.tax_category || '').toUpperCase() === 'IVA');
    return {
      sku: it.sku,
      measuring_unit: it.measuring_unit,
      description: it.description,
      quantity: it.quantity,
      price: it.price,
      discount_rate: it.discount_rate || 0,
      iva: iva ? String(Number(iva.tax_rate)) : '',
    };
  });
}

/* ------------------------------------------------------------------ */
/* Construcción del JSON                                               */
/* ------------------------------------------------------------------ */

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const PURCHASE_ORDER_NOTE = 'Orden de compra: ';

function buildInvoice() {
  const f = $('#form-factura').elements;
  const notes = lines(f.notes.value);
  // order_reference lleva la orden de pedido (igual que Softix); la orden de compra va como nota en el PDF.
  const purchaseOrder = f.purchase_order.value.trim();
  if (purchaseOrder) notes.unshift(PURCHASE_ORDER_NOTE + purchaseOrder);
  const retentions = invoiceRet.get();
  const prepayment = Number(f.prepayment_amount.value) || 0;
  return {
    actions: { send_dian: f.send_dian.checked, send_email: f.send_email.checked },
    invoice: dropEmpty({
      env: config.env,
      dataico_account_id: config.accountId,
      number: f.number.value.trim(),
      issue_date: toDataicoDate(f.issue_date.value),
      payment_date: toDataicoDate(f.payment_date.value),
      order_reference: f.order_reference.value.trim(),
      invoice_type_code: f.invoice_type_code.value,
      payment_means_type: f.payment_means_type.value,
      payment_means: f.payment_means.value.trim(),
      numbering: {
        resolution_number: f.resolution_number.value.trim(),
        prefix: f.prefix.value.trim(),
        flexible: f.flexible.checked,
      },
      notes: notes.length ? notes : undefined,
      customer: readCustomer($('#tab-factura .customer')),
      items: invoiceItems.get(),
      retentions: retentions.length ? retentions : undefined,
      // Softix lo envía como un solo objeto, no como lista.
      prepayments: prepayment ? dropEmpty({
        amount: prepayment,
        received_date: toDataicoDate(f.prepayment_date.value) || toDataicoDate(f.issue_date.value),
        description: f.prepayment_description.value.trim() || 'Anticipo',
      }) : undefined,
    }),
  };
}

function buildCreditNote() {
  const f = $('#form-nota').elements;
  const notes = lines(f.notes.value);
  const noRef = f.sin_factura_referenciada.checked;
  const note = {
    env: config.env,
    dataico_account_id: config.accountId,
    number: f.number.value.trim(),
    issue_date: toDataicoDate(f.issue_date.value),
    reason: f.reason.value,
    numbering: { prefix: f.prefix.value.trim(), flexible: f.flexible.checked },
    notes: notes.length ? notes : undefined,
    items: noteItems.get(),
  };
  const retentions = noteRet.get();
  if (retentions.length) note.retentions = retentions;
  if (noRef) {
    note.sin_factura_referenciada = true;
    note.customer = readCustomer($('#tab-nota .customer'));
  } else if (f.invoice_id.value.trim()) {
    note.invoice_id = f.invoice_id.value.trim();
  } else {
    note.invoice_cufe = f.invoice_cufe.value.trim();
  }
  return { actions: { send_dian: f.send_dian.checked, send_email: f.send_email.checked }, credit_note: dropEmpty(note) };
}

const KINDS = {
  factura: { build: buildInvoice, path: '/api/dataico/invoices', result: '#result-factura', label: 'Factura' },
  nota: { build: buildCreditNote, path: '/api/dataico/credit_notes', result: '#result-nota', label: 'Nota crédito' },
};

/* ------------------------------------------------------------------ */
/* Envío                                                               */
/* ------------------------------------------------------------------ */

function validate(kind, payload) {
  const doc = payload.invoice || payload.credit_note;
  if (!config.hasToken || !config.accountId) return 'Configura el Auth-token y el Dataico Account ID en la pestaña Configuración.';
  if (!doc.items?.length) return 'Agrega al menos un ítem.';
  if (doc.items.some((i) => !i.description || !(i.quantity > 0))) return 'Cada ítem necesita descripción y cantidad mayor a 0.';
  // Mismas validaciones que hace Softix antes de enviar a Dataico.
  if (doc.items.some((i) => (i.price ?? 0) < 0 || (i.discount_rate ?? 0) < 0 || (i.discount_rate ?? 0) > 100)) {
    return 'Hay ítems con precio negativo o descuento fuera de 0–100 %.';
  }
  const badIva = doc.items.some((i) => (i.taxes || []).some((t) =>
    String(t.tax_category).toUpperCase() === 'IVA' && ![0, 5, 16, 19].includes(Number(t.tax_rate))));
  if (badIva) return 'El IVA de cada ítem debe ser 0, 5, 16 o 19 %.';
  if ((doc.retentions || []).some((r) => !(r.tax_rate >= 0 && r.tax_rate <= 100))) return 'Las tasas de retención deben estar entre 0 y 100 %.';
  if ([].concat(doc.prepayments || []).some((pp) => !(pp.amount > 0))) return 'El anticipo debe ser mayor a 0.';
  if (kind === 'nota' && !doc.sin_factura_referenciada && !doc.invoice_id && !doc.invoice_cufe) {
    return 'Busca la factura de referencia o indica su UUID / CUFE.';
  }
  if (kind === 'nota' && !doc.sin_factura_referenciada && noteRefStatus && noteRefStatus !== 'DIAN_ACEPTADO') {
    return `La factura de referencia está en estado ${noteRefStatus}. Solo se puede hacer nota crédito a facturas aceptadas por la DIAN.`;
  }
  return null;
}

// Softix detecta cuando alguien facturó desde la plataforma de Dataico y el consecutivo quedó atrás.
async function existingInvoice(doc) {
  if (!doc.number) return null;
  const full = (doc.numbering?.prefix || '') + doc.number;
  try {
    const res = await api('/api/dataico/invoices?number=' + encodeURIComponent(full));
    const found = res.data?.invoice || res.data;
    return res.ok && found?.uuid ? { full, ...found } : null;
  } catch {
    return null; // Si la consulta falla, Dataico igual valida el número al crear la factura.
  }
}

async function submit(kind, payload) {
  const k = KINDS[kind];
  const out = $(k.result);
  const problem = validate(kind, payload);
  if (problem) return renderError(out, problem);

  const doc = payload.invoice || payload.credit_note;
  const fix = kind === 'factura' ? correcting : null;
  if (doc.env === 'PRODUCCION' && payload.actions?.send_dian &&
      !confirm(`Vas a ${fix ? 'reenviar corregido' : 'emitir'} un documento REAL ante la DIAN (ambiente PRODUCCION).\n\n${k.label} ${doc.numbering?.prefix || ''}${doc.number || ''}\n\n¿Continuar?`)) {
    return;
  }

  const buttons = $$(`#tab-${kind} button`);
  buttons.forEach((b) => (b.disabled = true));
  out.className = 'result';
  out.innerHTML = '<p>Enviando a Dataico…</p>';
  try {
    if (kind === 'factura' && !fix) {
      const dup = await existingInvoice(doc);
      if (dup) {
        return renderError(out, `La factura ${dup.full} ya existe en Dataico (estado ${dup.dian_status || 'desconocido'}). ` +
          'Puede que se haya emitido desde la plataforma de Dataico: usa el siguiente consecutivo.');
      }
    }
    const res = fix
      ? await api('/api/dataico/invoices/' + encodeURIComponent(fix.uuid), { method: 'PUT', body: JSON.stringify(payload) })
      : await api(k.path, { method: 'POST', body: JSON.stringify(payload) });
    renderDataicoResult(out, res, k.label, payload);
    const status = (res.data?.invoice || res.data || {}).dian_status;
    if (fix && res.ok && !hasErrors(res.data) && status !== 'DIAN_RECHAZADO') endCorrection();
  } catch (err) {
    renderError(out, err.message);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function hasErrors(data) {
  return Boolean(data && (data.errors?.length || data.error || data.message && !data.uuid && !data.invoice && !data.credit_note));
}

// Dataico explica los rechazos de la DIAN en dian_messages (texto u objetos).
function dianMessages(doc, data) {
  return [].concat(doc.dian_messages || data.dian_messages || [])
    .map((m) => (typeof m === 'string' ? m : (m.message || m.description || m.error || JSON.stringify(m))));
}

function renderDataicoResult(out, res, label, payload) {
  const data = res.data || {};
  const doc = data.invoice || data.credit_note || data;
  const ok = res.ok && !hasErrors(data);
  const rejected = doc.dian_status === 'DIAN_RECHAZADO';
  const dianMsgs = dianMessages(doc, data);
  out.className = 'result ' + (!ok ? 'err' : rejected ? 'warn' : 'ok');

  const fields = [
    ['Número', doc.number],
    ['UUID', doc.uuid],
    ['CUFE / CUDE', doc.cufe || doc.cude],
    ['Estado DIAN', doc.dian_status],
    ['Estado correo', doc.email_status],
    ['Fecha', doc.issue_date],
  ].filter(([, v]) => v);
  const links = [['PDF', doc.pdf_url], ['XML', doc.xml_url]].filter(([, v]) => v);
  const errors = data.errors ? (Array.isArray(data.errors) ? data.errors : [data.errors]) : [];

  out.innerHTML = `
    <h3>${!ok ? `${label}: Dataico respondió con error` : rejected ? `${label}: la DIAN la rechazó` : `${label}: respuesta exitosa`} (HTTP ${res.status})</h3>
    ${fields.length ? `<dl class="kv">${fields.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    ${links.length ? `<p>${links.map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener">Descargar ${k}</a>`).join(' · ')}</p>` : ''}
    ${errors.length ? `<ul class="error">${errors.map((e) => `<li>${esc(typeof e === 'string' ? e : (e.error || e.message || JSON.stringify(e)))}</li>`).join('')}</ul>` : ''}
    ${data.error || (data.message && !ok) ? `<p class="error">${esc(data.error || data.message)}</p>` : ''}
    ${data.raw ? `<p class="error">${esc(data.raw)}</p>` : ''}
    ${dianMsgs.length ? `<p><b>Mensajes de la DIAN</b></p><ul class="error">${dianMsgs.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    ${doc.uuid && label === 'Factura' && rejected ? `<div class="actions" style="justify-content:flex-start"><button type="button" class="small" data-fix>Corregir y reenviar con el mismo número</button></div>` : ''}
    ${ok && doc.uuid && label === 'Factura' && !rejected ? `<div class="actions" style="justify-content:flex-start"><button type="button" class="secondary small" data-nc="${esc(doc.uuid)}">Crear nota crédito para esta factura</button></div>` : ''}
    <details><summary>Respuesta completa</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>`;
  $('[data-nc]', out)?.addEventListener('click', (e) => startCreditNote(e.target.dataset.nc));
  $('[data-fix]', out)?.addEventListener('click', () => startCorrection(doc.uuid, payload));
}

function renderError(out, message) {
  out.className = 'result err';
  out.innerHTML = `<h3>Error</h3><p>${esc(message)}</p>`;
}

$('#form-factura').addEventListener('submit', (e) => { e.preventDefault(); submit('factura', buildInvoice()); });
$('#form-nota').addEventListener('submit', (e) => { e.preventDefault(); submit('nota', buildCreditNote()); });

/* ------------------------------------------------------------------ */
/* Vista previa / edición de JSON                                      */
/* ------------------------------------------------------------------ */

const dialog = $('#json-dialog');
let previewKind = null;

$$('[data-preview]').forEach((btn) => btn.addEventListener('click', () => {
  previewKind = btn.dataset.preview;
  $('#json-editor').value = JSON.stringify(KINDS[previewKind].build(), null, 2);
  $('#json-error').textContent = '';
  dialog.showModal();
}));

$('#json-send').addEventListener('click', (e) => {
  let payload;
  try {
    payload = JSON.parse($('#json-editor').value);
  } catch (err) {
    e.preventDefault();
    $('#json-error').textContent = 'JSON inválido: ' + err.message;
    return;
  }
  dialog.close();
  submit(previewKind, payload);
});

/* ------------------------------------------------------------------ */
/* Corregir una factura rechazada (PUT /invoices/{uuid})               */
/* ------------------------------------------------------------------ */

// Dataico solo deja modificar facturas rechazadas por la DIAN; conservan el número.
let correcting = null; // { uuid, number }

function fillInvoiceForm({ actions = {}, invoice: inv = {} }) {
  const f = $('#form-factura').elements;
  const n = inv.numbering || {};
  const prefix = n.prefix || f.prefix.value;
  let number = String(inv.number || '');
  if (prefix && number.startsWith(prefix)) number = number.slice(prefix.length);
  f.prefix.value = prefix;
  if (n.resolution_number) f.resolution_number.value = n.resolution_number;
  f.number.value = number;
  if (n.flexible != null) f.flexible.checked = n.flexible;
  f.issue_date.value = fromDataicoDate(inv.issue_date) || today();
  f.payment_date.value = fromDataicoDate(inv.payment_date) || f.issue_date.value;
  if (inv.payment_means_type) f.payment_means_type.value = inv.payment_means_type;
  if (inv.payment_means) f.payment_means.value = inv.payment_means;
  if (inv.invoice_type_code) f.invoice_type_code.value = inv.invoice_type_code;
  f.order_reference.value = inv.order_reference || '';

  const notes = [].concat(inv.notes || []);
  const po = notes.findIndex((l) => String(l).startsWith(PURCHASE_ORDER_NOTE));
  f.purchase_order.value = po >= 0 ? notes.splice(po, 1)[0].slice(PURCHASE_ORDER_NOTE.length) : '';
  f.notes.value = notes.join('\n');

  fillCustomer($('#tab-factura .customer'), inv.customer);
  invoiceItems.set(itemsFromInvoice(inv));
  invoiceRet.set(inv.retentions);
  const pp = [].concat(inv.prepayments || [])[0] || {};
  f.prepayment_amount.value = pp.amount ?? '';
  f.prepayment_date.value = fromDataicoDate(pp.received_date);
  f.prepayment_description.value = pp.description || '';

  f.send_dian.checked = actions.send_dian ?? true;
  f.send_email.checked = actions.send_email ?? false;
}

async function startCorrection(uuid, payload) {
  showTab('factura');
  try {
    if (!payload?.invoice) {
      // Sin el JSON original (p. ej. desde Consultar): se parte de lo que tiene Dataico.
      const res = await api('/api/dataico/invoices/' + encodeURIComponent(uuid));
      payload = { invoice: res.data?.invoice || res.data || {} };
    }
    fillInvoiceForm(payload);
    const f = $('#form-factura').elements;
    correcting = { uuid, number: f.prefix.value + f.number.value };
    syncCorrection();
    $('#tab-factura').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    alert('No se pudo cargar la factura: ' + err.message);
  }
}

function endCorrection() {
  correcting = null;
  syncCorrection();
}

function syncCorrection() {
  const banner = $('#correction-banner');
  const f = $('#form-factura').elements;
  banner.hidden = !correcting;
  f.number.readOnly = Boolean(correcting);
  f.prefix.readOnly = Boolean(correcting);
  $('#btn-submit-factura').textContent = correcting ? 'Reenviar factura corregida' : 'Crear factura';
  if (!correcting) return;
  banner.innerHTML = `
    <span>Corrigiendo la factura <b>${esc(correcting.number)}</b>, rechazada por la DIAN. Se reenvía con el mismo número.</span>
    <button type="button" class="secondary small">Cancelar corrección</button>`;
  $('button', banner).addEventListener('click', endCorrection);
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

async function fetchInvoice(q) {
  q = q.trim();
  const path = UUID_RE.test(q)
    ? '/api/dataico/invoices/' + encodeURIComponent(q)
    : '/api/dataico/invoices?number=' + encodeURIComponent(q);
  return api(path);
}

async function fetchCreditNote(q) {
  q = q.trim();
  const path = UUID_RE.test(q)
    ? '/api/dataico/credit_notes/' + encodeURIComponent(q)
    : '/api/dataico/credit_notes?number=' + encodeURIComponent(q);
  return api(path);
}

$('#btn-lookup').addEventListener('click', async () => {
  const out = $('#result-consultar');
  const q = $('#lookup-q').value;
  const isNote = $('#lookup-kind').value === 'nota';
  if (!q.trim()) return renderError(out, 'Escribe un número (con prefijo) o UUID.');
  out.className = 'result';
  out.innerHTML = '<p>Consultando…</p>';
  try {
    renderDataicoResult(out, await (isNote ? fetchCreditNote(q) : fetchInvoice(q)), isNote ? 'Nota crédito' : 'Factura');
  } catch (err) {
    renderError(out, err.message);
  }
});

$('#btn-numberings').addEventListener('click', async () => {
  const out = $('#result-consultar');
  out.className = 'result';
  out.innerHTML = '<p>Consultando…</p>';
  try {
    const res = await api('/api/dataico/numberings/' + $('#numbering-module').value);
    out.className = 'result ' + (res.ok ? 'ok' : 'err');
    out.innerHTML = `<h3>Numeraciones (HTTP ${res.status})</h3><pre>${esc(JSON.stringify(res.data, null, 2))}</pre>`;
  } catch (err) {
    renderError(out, err.message);
  }
});

// Estado DIAN de la factura de referencia cargada ('' si se escribió el UUID a mano).
let noteRefStatus = '';

// Nota crédito: buscar factura de referencia y precargar sus ítems y retenciones.
async function lookupForCreditNote(q) {
  const f = $('#form-nota').elements;
  const box = $('#nota-invoice-summary');
  box.textContent = 'Consultando…';
  try {
    const res = await fetchInvoice(q);
    const inv = res.data?.invoice || res.data || {};
    if (!res.ok || !inv.uuid) {
      box.innerHTML = `<span class="error">No se encontró la factura (HTTP ${res.status}).</span> <details><summary>Respuesta</summary><pre>${esc(JSON.stringify(res.data, null, 2))}</pre></details>`;
      return;
    }
    f.invoice_id.value = inv.uuid;
    f.invoice_cufe.value = inv.cufe || '';
    noteRefStatus = inv.dian_status || '';
    const c = inv.customer || {};
    const name = c.company_name || [c.first_name, c.family_name].filter(Boolean).join(' ');
    box.innerHTML = `
      <dl class="kv">
        <dt>Factura</dt><dd>${esc(inv.number)}</dd>
        <dt>Fecha</dt><dd>${esc(inv.issue_date || '')}</dd>
        <dt>Cliente</dt><dd>${esc(name)} ${c.party_identification ? '(' + esc(c.party_identification) + ')' : ''}</dd>
        <dt>Estado DIAN</dt><dd>${esc(inv.dian_status || '')}</dd>
      </dl>
      ${noteRefStatus && noteRefStatus !== 'DIAN_ACEPTADO'
        ? '<p class="error">Esta factura no está aceptada por la DIAN; no se le puede hacer nota crédito.</p>'
        : '<p class="hint">Se cargaron los ítems y retenciones de la factura. Ajusta cantidades o quita los que no se acreditan.</p>'}`;
    const items = itemsFromInvoice(inv);
    if (items.length) noteItems.set(items);
    noteRet.set(inv.retentions);
  } catch (err) {
    box.innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

for (const name of ['invoice_id', 'invoice_cufe']) {
  $('#form-nota').elements[name].addEventListener('input', () => (noteRefStatus = ''));
}

$('#btn-lookup-nota').addEventListener('click', () => {
  const q = $('#form-nota').elements.lookup.value;
  if (q.trim()) lookupForCreditNote(q);
});

function startCreditNote(uuid) {
  showTab('nota');
  const f = $('#form-nota').elements;
  f.sin_factura_referenciada.checked = false;
  syncNoRef();
  f.lookup.value = uuid;
  lookupForCreditNote(uuid);
}

function syncNoRef() {
  const noRef = $('#form-nota').elements.sin_factura_referenciada.checked;
  $('#tab-nota .ref-only').hidden = noRef;
  $('#tab-nota .noref-only').hidden = !noRef;
}
$('#form-nota').elements.sin_factura_referenciada.addEventListener('change', syncNoRef);

/* ------------------------------------------------------------------ */
/* Historial                                                           */
/* ------------------------------------------------------------------ */

async function loadHistory() {
  const tbody = $('#history-table tbody');
  try {
    const rows = await api('/api/history');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="hint">Aún no has enviado documentos.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r, i) => `
      <tr>
        <td>${esc(new Date(r.at).toLocaleString('es-CO'))}</td>
        <td>${r.kind === 'factura' ? (r.correction ? 'Factura (corrección)' : 'Factura') : 'Nota crédito'}</td>
        <td>${esc(r.env)}</td>
        <td>${esc(r.number)}</td>
        <td>${esc(r.customer)}</td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.dian_status)}</td>
        <td>${r.pdf_url ? `<a href="${esc(r.pdf_url)}" target="_blank" rel="noopener">PDF</a>` : ''}
            ${r.xml_url ? `<a href="${esc(r.xml_url)}" target="_blank" rel="noopener">XML</a>` : ''}</td>
        <td>
          <button type="button" class="secondary small" data-detail="${i}">Detalle</button>
          ${r.kind === 'factura' && r.uuid && r.dian_status === 'DIAN_RECHAZADO' ? `<button type="button" class="small" data-fix="${i}">Corregir</button>` : ''}
          ${r.kind === 'factura' && r.uuid && r.dian_status !== 'DIAN_RECHAZADO' ? `<button type="button" class="secondary small" data-nc="${esc(r.uuid)}">Nota crédito</button>` : ''}
        </td>
      </tr>`).join('');
    $$('[data-nc]', tbody).forEach((b) => b.addEventListener('click', () => startCreditNote(b.dataset.nc)));
    $$('[data-fix]', tbody).forEach((b) => b.addEventListener('click', () => {
      const r = rows[Number(b.dataset.fix)];
      startCorrection(r.uuid, r.request);
    }));
    $$('[data-detail]', tbody).forEach((b) => b.addEventListener('click', () => {
      const r = rows[Number(b.dataset.detail)];
      $('#json-editor').value = JSON.stringify(r.response, null, 2);
      $('#json-error').textContent = '';
      previewKind = null;
      $('#json-send').hidden = true;
      dialog.showModal();
      dialog.addEventListener('close', () => ($('#json-send').hidden = false), { once: true });
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="error">${esc(err.message)}</td></tr>`;
  }
}
$('#btn-history').addEventListener('click', loadHistory);

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

function applyConfig(cfg) {
  config = cfg;
  const badge = $('#env-badge');
  badge.textContent = cfg.env;
  badge.classList.toggle('prod', cfg.env === 'PRODUCCION');

  const c = $('#form-config').elements;
  c.authToken.value = '';
  c.accountId.value = cfg.accountId;
  c.env.value = cfg.env;
  c.invoicePrefix.value = cfg.invoicePrefix;
  c.resolutionNumber.value = cfg.resolutionNumber;
  c.creditNotePrefix.value = cfg.creditNotePrefix;
  c.sendEmail.checked = cfg.sendEmail;
  $('#token-status').textContent = cfg.hasToken ? `Token guardado (${cfg.tokenHint}). Déjalo vacío para conservarlo.` : 'Aún no hay token guardado.';

  const fi = $('#form-factura').elements;
  fi.prefix.value = cfg.invoicePrefix;
  fi.resolution_number.value = cfg.resolutionNumber;
  fi.send_email.checked = cfg.sendEmail;
  const fn = $('#form-nota').elements;
  fn.prefix.value = cfg.creditNotePrefix;
  fn.send_email.checked = cfg.sendEmail;
}

$('#form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = e.target.elements;
  if (c.env.value === 'PRODUCCION' && config.env !== 'PRODUCCION' &&
      !confirm('En PRODUCCION los documentos se emiten de verdad ante la DIAN. ¿Cambiar a PRODUCCION?')) {
    return;
  }
  try {
    applyConfig(await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({
        authToken: c.authToken.value,
        accountId: c.accountId.value.trim(),
        env: c.env.value,
        invoicePrefix: c.invoicePrefix.value.trim(),
        resolutionNumber: c.resolutionNumber.value.trim(),
        creditNotePrefix: c.creditNotePrefix.value.trim(),
        sendEmail: c.sendEmail.checked,
      }),
    }));
    $('#token-status').textContent += ' Configuración guardada.';
  } catch (err) {
    alert(err.message);
  }
});

/* ------------------------------------------------------------------ */
/* Inicio                                                              */
/* ------------------------------------------------------------------ */

for (const name of ['issue_date', 'payment_date']) $('#form-factura').elements[name].value = today();
$('#form-nota').elements.issue_date.value = today();

api('/api/config').then((cfg) => {
  applyConfig(cfg);
  if (!cfg.hasToken || !cfg.accountId) showTab('config');
}).catch((err) => alert('No se pudo cargar la configuración: ' + err.message));
