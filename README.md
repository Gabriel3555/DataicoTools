# Facturas Dataico

Aplicación local y sin dependencias para crear **facturas electrónicas** y **notas crédito** con la API v2 de Dataico.

## Uso

```bash
node server.js        # o: npm start
```

Abre http://localhost:3000 y, en **Configuración**, ingresa:

- **Auth-token / Llave API**: en Dataico, *Opciones → Configuración → Llaves API* (o el Auth Token de la cuenta).
- **Dataico Account ID**: el UUID que aparece en *Opciones → Configuración*.
- **Ambiente**: `PRUEBAS` o `PRODUCCION`. En PRODUCCION la app pide confirmación antes de cada envío a la DIAN.

También puedes pasarlos por variables de entorno (tienen prioridad sobre lo guardado):

```bash
DATAICO_AUTH_TOKEN=... DATAICO_ACCOUNT_ID=... DATAICO_ENV=PRUEBAS PORT=3000 node server.js
```

Las credenciales y el historial se guardan en `data/` (excluido en `.gitignore`). El token nunca se envía al navegador. El servidor solo escucha en `127.0.0.1`.

## Funciones

- **Nueva factura**: numeración (prefijo, resolución, consecutivo), fechas, forma y medio de pago, orden de venta / pedido (`order_reference`) y orden de compra (se envía como primera línea de `notes`), cliente (con atajo de *consumidor final*), ítems con descuento e IVA, retenciones (`retentions`: retefuente, ReteIVA, ReteICA), anticipo (`prepayments`) y totales con neto a pagar. Antes de crear la factura revisa que el número no exista ya en Dataico (pasa cuando alguien facturó desde la plataforma).
- **Corregir factura rechazada**: si la DIAN la rechaza, se muestran los `dian_messages` y el botón *Corregir y reenviar* carga la factura en el formulario y la reenvía con `PUT /invoices/{uuid}`, conservando el número.
- **Nota crédito**: busca la factura por número o UUID, carga sus ítems y referencia la factura con `invoice_id` (o `invoice_cufe`). Copia las retenciones de la factura y no deja continuar si la factura no está `DIAN_ACEPTADO`. También permite notas crédito **sin factura referenciada** (`sin_factura_referenciada: true` + cliente completo).
- **Ver / editar JSON**: muestra el cuerpo exacto que se enviará y deja modificarlo antes de enviarlo.
- **Consultar**: factura o nota crédito por número (`?number=`) o UUID, y numeraciones de la cuenta por módulo.
- **Historial**: todo lo enviado, con enlaces a PDF/XML y un botón para crear una nota crédito desde una factura.

## Endpoints usados

Base: `https://api.dataico.com/direct/dataico_api/v2`, cabecera `Auth-token`.

| Acción | Método y ruta |
|---|---|
| Crear factura | `POST /invoices` (`{ actions, invoice }`) |
| Consultar factura | `GET /invoices?number=SETP990000001` o `GET /invoices/{uuid}` |
| Corregir factura rechazada | `PUT /invoices/{uuid}` (`{ actions, invoice }`) |
| Crear nota crédito | `POST /credit_notes` (`{ actions, credit_note }`) |
| Consultar nota crédito | `GET /credit_notes?number=NC1` o `GET /credit_notes/{uuid}` |
| Numeraciones | `GET /numberings/{invoice\|credit-note\|debit-note\|support-doc}` |

## Qué está confirmado y qué hay que validar

La documentación pública de Dataico confirma las rutas, la cabecera `Auth-token`, los campos `env`, `dataico_account_id`, `numbering.flexible`, `invoice_id` / `invoice_cufe` y `sin_factura_referenciada`. Los ejemplos JSON completos están en archivos de Google Drive que requieren iniciar sesión, por lo que **no se pudieron revisar**.

Los demás nombres de campo y valores (`issue_date` en `dd/MM/yyyy`, `payment_means`, `payment_means_type`, `invoice_type_code`, campos del `customer`, `tax_level_code`, `regimen`, códigos de `reason` de la nota crédito, formato de `number`) siguen la estructura habitual de la API v2 de Dataico. La mayoría de esos nombres los confirmamos al revisar el modelo que usa **Softix** (otro programa que ya factura con Dataico): `issue_date`/`payment_date` en `dd/MM/yyyy`, `invoice_type_code` (`FACTURA_VENTA`), `payment_means_type` (`DEBITO`/`CREDITO`), `payment_means` (`CASH`, `CREDIT_CARD`, `DEBIT_CARD`, `BANK_TRANSFER`…), `order_reference` (texto), `notes` (lista de textos), `numbering { resolution_number, prefix, flexible }`, `customer { email, phone, party_type, party_identification, party_identification_type, tax_level_code, regimen, department, city, address_line, country_code, company_name, first_name, family_name }`, `items[] { sku, measuring_unit, quantity, description, price, discount_rate, original_price, taxes[] }` y en nota crédito `invoice_id` + `reason` (`ANULACION`). Softix usa `order_reference` para la **orden de pedido** (`OP` + número de venta).

Un registro de 604 facturas que Softix envió a PRODUCCION (`JSONRIPS.json`) confirma además: `number` va sin prefijo (el prefijo va en `numbering`), los ítems sin IVA no llevan `taxes`, `discount_rate` se omite cuando es 0, los ítems con 100 % de descuento llevan `original_price`, los departamentos y ciudades van con código DANE (`68` / `001`) y el tipo de documento extranjero es `DE`.

Haz una primera prueba en **PRUEBAS** y, si Dataico rechaza algún campo, corrígelo con **Ver / editar JSON** o ajusta `buildInvoice` / `buildCreditNote` en `public/app.js`. Los campos de tipo lista (medio de pago, responsabilidad de IVA, régimen) aceptan valores escritos a mano.
