const money = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const pct = (n) => `${((n || 0) * 100).toFixed(1)}%`;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

// ---------------- Navegación ----------------
function setupNav() {
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      $$('.nav-item').forEach((i) => i.classList.remove('active'));
      $$('.view').forEach((v) => v.classList.remove('active'));
      item.classList.add('active');
      $(`#view-${item.dataset.view}`).classList.add('active');
      onViewShown(item.dataset.view);
    });
  });
}

function onViewShown(view) {
  if (view === 'dashboard') loadDashboard();
  if (view === 'compras') loadCompras();
  if (view === 'materiales') loadMateriales();
  if (view === 'rubros') loadRubros();
  if (view === 'computo') loadComputo();
  if (view === 'cronograma') loadCronograma();
  if (view === 'proyecto') loadProyecto();
}

// ---------------- Cómputo por ítem ----------------
let computoCache = [];

async function loadComputo() {
  const { items } = await api('/api/computo');
  computoCache = items;
  renderComputoLista(items);
}

function renderComputoLista(items) {
  const cont = $('#computo-lista');
  if (!items.length) {
    cont.innerHTML = '<p class="muted">Todavía no se importó el cómputo por ítem. Subilo desde "Panel general" → "Archivos fuente del proyecto".</p>';
    return;
  }
  cont.innerHTML = items.map((it) => `
    <div class="computo-item" data-codigo="${it.codigo}">
      <div class="computo-item-header">
        <div class="computo-item-titulo">
          <span class="computo-codigo">${it.codigo}</span>
          <span class="computo-desc">${it.descripcion}</span>
        </div>
        <div class="computo-meta">
          <span class="pill unidad">${it.unidad || ''}</span>
          <span class="computo-costo">${money(it.costo_costo)}</span>
          <span class="computo-caret">▾</span>
        </div>
      </div>
      <div class="computo-item-body"></div>
    </div>`).join('');

  $$('.computo-item-header').forEach((el) => {
    el.addEventListener('click', () => {
      const item = el.closest('.computo-item');
      const codigo = item.dataset.codigo;
      const body = item.querySelector('.computo-item-body');
      const abierto = item.classList.toggle('open');
      if (abierto && !body.dataset.rendered) {
        const found = computoCache.find((x) => x.codigo === codigo);
        body.innerHTML = renderComputoCategorias(found.categorias);
        body.dataset.rendered = '1';
      }
    });
  });
}

function renderComputoCategorias(categorias) {
  return categorias.map((c) => `
    <div class="computo-categoria">
      <div class="computo-categoria-nombre">${c.codigo} — ${c.nombre}</div>
      <div class="table-wrap">
        <table class="computo-tabla">
          <thead><tr><th>Material</th><th>Unidad</th><th>Cant.</th><th>Precio unit.</th><th>Parcial</th></tr></thead>
          <tbody>
            ${c.materiales.map((m) => `
              <tr>
                <td>${m.descripcion}</td>
                <td>${m.unidad}</td>
                <td>${m.cantidad}</td>
                <td>${money(m.precio_unitario)}</td>
                <td>${money(m.parcial)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`).join('');
}

function setupBuscadorComputo() {
  $('#buscador-computo').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtrados = computoCache.filter((it) =>
      it.descripcion.toLowerCase().includes(q) || it.codigo.toLowerCase().includes(q));
    renderComputoLista(filtrados);
  });
}

// ---------------- Gráficos (canvas nativo, sin librerías externas) ----------------
function niceNumber(val) {
  if (val <= 0) return 1;
  const exp = Math.floor(Math.log10(val));
  const base = Math.pow(10, exp);
  const frac = val / base;
  let niceFrac;
  if (frac <= 1) niceFrac = 1;
  else if (frac <= 2) niceFrac = 2;
  else if (frac <= 5) niceFrac = 5;
  else niceFrac = 10;
  return niceFrac * base;
}

function formatCompact(v) {
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
}

function setupCanvasSize(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth || 400;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return { ctx, cssWidth, cssHeight };
}

function drawBarChart(canvas, { labels, datasets }) {
  if (!labels.length) {
    const { ctx, cssWidth, cssHeight } = setupCanvasSize(canvas, 220);
    ctx.fillStyle = '#9AA5B8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Todavía no hay datos para graficar.', cssWidth / 2, cssHeight / 2);
    return;
  }
  const { ctx, cssWidth, cssHeight } = setupCanvasSize(canvas, 260);
  const padding = { top: 28, right: 12, bottom: 34, left: 56 };
  const chartW = cssWidth - padding.left - padding.right;
  const chartH = cssHeight - padding.top - padding.bottom;

  const allValues = datasets.flatMap((d) => d.data);
  const maxVal = Math.max(1, ...allValues);
  const niceMax = niceNumber(maxVal);

  ctx.strokeStyle = '#E4E8F1';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#6B7280';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const v = (niceMax / ySteps) * i;
    const y = padding.top + chartH - (v / niceMax) * chartH;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();
    ctx.fillText(formatCompact(v), padding.left - 8, y);
  }

  const groupCount = labels.length;
  const groupWidth = chartW / groupCount;
  const barsPerGroup = datasets.length;
  const groupPadding = groupWidth * 0.18;
  const barWidth = (groupWidth - groupPadding * 2) / barsPerGroup;

  labels.forEach((label, gi) => {
    const groupX = padding.left + gi * groupWidth + groupPadding;
    datasets.forEach((ds, di) => {
      const val = ds.data[gi] || 0;
      const barH = (val / niceMax) * chartH;
      const x = groupX + di * barWidth;
      const y = padding.top + chartH - barH;
      ctx.fillStyle = ds.backgroundColor;
      ctx.fillRect(x, y, Math.max(1, barWidth - 3), barH);
    });
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '10px sans-serif';
    const centerX = padding.left + gi * groupWidth + groupWidth / 2;
    let text = label;
    if (ctx.measureText(text).width > groupWidth) {
      while (text.length > 3 && ctx.measureText(text + '…').width > groupWidth) {
        text = text.slice(0, -1);
      }
      text += '…';
    }
    ctx.fillText(text, centerX, padding.top + chartH + 8);
  });

  if (datasets.length > 1) {
    let lx = padding.left;
    const ly = 8;
    datasets.forEach((ds) => {
      ctx.fillStyle = ds.backgroundColor;
      ctx.fillRect(lx, ly, 10, 10);
      ctx.fillStyle = '#333';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '11px sans-serif';
      ctx.fillText(ds.label, lx + 14, ly + 5);
      lx += ctx.measureText(ds.label).width + 40;
    });
  }
}

function drawHorizontalBarChart(canvas, { labels, data, colors }) {
  if (!labels.length) {
    const { ctx, cssWidth, cssHeight } = setupCanvasSize(canvas, 220);
    ctx.fillStyle = '#9AA5B8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Todavía no cargaste compras.', cssWidth / 2, cssHeight / 2);
    return;
  }
  const rowHeight = 28;
  const cssHeight = Math.max(140, labels.length * rowHeight + 20);
  const { ctx, cssWidth } = setupCanvasSize(canvas, cssHeight);

  const labelWidth = Math.min(160, cssWidth * 0.38);
  const chartW = cssWidth - labelWidth - 16;
  const maxAbs = Math.max(1, ...data.map((v) => Math.abs(v)));
  const zeroX = labelWidth + chartW / 2;
  const scale = (chartW / 2) / maxAbs;

  labels.forEach((label, i) => {
    const y = 10 + i * rowHeight;
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    let text = label;
    while (text.length > 3 && ctx.measureText(text).width > labelWidth - 10) {
      text = text.slice(0, -1);
    }
    ctx.fillText(text, labelWidth - 8, y + (rowHeight - 10) / 2);

    const val = data[i];
    const barW = Math.abs(val) * scale;
    const x = val >= 0 ? zeroX : zeroX - barW;
    ctx.fillStyle = colors[i];
    ctx.fillRect(x, y, barW, rowHeight - 10);
  });

  ctx.strokeStyle = '#B8C0D4';
  ctx.beginPath();
  ctx.moveTo(zeroX, 0);
  ctx.lineTo(zeroX, cssHeight);
  ctx.stroke();
}

// ---------------- Dashboard ----------------
async function loadDashboard() {
  const resumen = await api('/api/resumen');
  const kpis = [
    { label: 'Proyectado (materiales)', value: money(resumen.total_proyectado_materiales) },
    { label: 'Gastado hasta hoy', value: money(resumen.total_gastado) },
    { label: 'Diferencia', value: money(resumen.diferencia), cls: resumen.diferencia > 0 ? 'negative' : 'positive' },
    { label: 'Compras cargadas', value: resumen.cantidad_compras },
  ];
  $('#kpi-grid').innerHTML = kpis.map((k) => `
    <div class="kpi-card ${k.cls || ''}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
    </div>`).join('');

  const cats = resumen.por_categoria;
  drawBarChart($('#chart-categoria'), {
    labels: cats.map((c) => c.categoria),
    datasets: [
      { label: 'Proyectado', data: cats.map((c) => c.proyectado), backgroundColor: '#2E5597' },
      { label: 'Gastado', data: cats.map((c) => c.gastado), backgroundColor: '#4C8DFF' },
    ],
  });

  const top = [...resumen.detalle_materiales]
    .sort((a, b) => Math.abs(b.diferencia_monto) - Math.abs(a.diferencia_monto))
    .slice(0, 8)
    .filter((m) => m.monto_gastado > 0);

  const tituloDesvio = $('#chart-desvio').closest('.card').querySelector('h3');
  tituloDesvio.textContent = top.length === 0
    ? 'Materiales con mayor desvío (todavía no cargaste compras)'
    : 'Materiales con mayor desvío';

  drawHorizontalBarChart($('#chart-desvio'), {
    labels: top.map((m) => m.descripcion.slice(0, 22)),
    data: top.map((m) => m.diferencia_monto),
    colors: top.map((m) => (m.diferencia_monto > 0 ? '#D64545' : '#1F9D6B')),
  });

  loadArchivos();
}

// ---------------- Archivos fuente ----------------
function formatFecha(iso) {
  if (!iso) return 'nunca';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatTamano(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function loadArchivos() {
  const { archivos } = await api('/api/archivos');
  const grid = $('#archivos-grid');
  grid.innerHTML = archivos.map((a) => `
    <div class="archivo-card" data-nombre="${a.nombre}">
      <div class="archivo-nombre">${a.nombre}</div>
      <div class="archivo-meta">Actualizado: ${formatFecha(a.actualizado_en)} · ${formatTamano(a.tamano)}</div>
      <div class="archivo-actions">
        <span class="archivo-ver" data-nombre="${a.nombre}">Ver contenido</span>
        <label class="upload-btn">
          Reemplazar archivo
          <input type="file" accept=".txt,.TXT" data-nombre="${a.nombre}">
        </label>
      </div>
      <pre class="archivo-preview"></pre>
      <div class="archivo-avisos"></div>
    </div>`).join('');

  $$('.archivo-ver').forEach((el) => {
    el.addEventListener('click', async () => {
      const card = el.closest('.archivo-card');
      const pre = card.querySelector('.archivo-preview');
      if (pre.style.display === 'block') {
        pre.style.display = 'none';
        el.textContent = 'Ver contenido';
        return;
      }
      const data = await api(`/api/archivos/${encodeURIComponent(el.dataset.nombre)}`);
      pre.textContent = data.contenido;
      pre.style.display = 'block';
      el.textContent = 'Ocultar contenido';
    });
  });

  $$('.archivo-actions input[type="file"]').forEach((input) => {
    input.addEventListener('change', () => handleArchivoUpload(input));
  });
}

function handleArchivoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const nombre = input.dataset.nombre;
  const card = input.closest('.archivo-card');
  const avisos = card.querySelector('.archivo-avisos');
  avisos.textContent = 'Procesando...';
  avisos.style.color = 'var(--muted)';

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const resultado = await api(`/api/archivos/${encodeURIComponent(nombre)}`, {
        method: 'POST',
        body: JSON.stringify({ contenido: reader.result }),
      });
      let msg = 'Archivo actualizado.';
      if (resultado.rubros_importados != null) msg += ` ${resultado.rubros_importados} rubros importados.`;
      if (resultado.materiales_importados != null) msg += ` ${resultado.materiales_importados} materiales importados.`;
      if (resultado.avisos && resultado.avisos.length) msg += ' ⚠ ' + resultado.avisos.join(' ⚠ ');
      avisos.textContent = msg;
      avisos.style.color = resultado.avisos && resultado.avisos.length ? 'var(--amber)' : 'var(--green)';
      loadDashboard();
    } catch (err) {
      avisos.textContent = err.message;
      avisos.style.color = 'var(--red)';
    }
  };
  reader.readAsText(file, 'windows-1252');
}

// ---------------- Compras ----------------
async function loadCompras() {
  const [{ materiales }, { compras }] = await Promise.all([api('/api/materiales'), api('/api/compras')]);

  $('#lista-materiales').innerHTML = materiales.map((m) =>
    `<option value="${m.codigo}">${m.descripcion} (${m.unidad})</option>`).join('');

  $('#tabla-compras tbody').innerHTML = compras.map((c) => `
    <tr>
      <td>${c.fecha || ''}</td>
      <td>${c.material_descripcion || c.material_codigo}</td>
      <td>${c.cantidad}</td>
      <td>${money(c.costo_total)}</td>
      <td>${c.lugar_compra || ''}</td>
      <td>${c.factura_numero || ''}</td>
      <td><span class="link-action danger" data-id="${c.id}">Eliminar</span></td>
    </tr>`).join('');

  $$('#tabla-compras .link-action').forEach((el) => {
    el.addEventListener('click', async () => {
      await api(`/api/compras/${el.dataset.id}`, { method: 'DELETE' });
      loadCompras();
    });
  });
}

function setupFormCompra() {
  $('#form-compra').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#form-compra-msg');
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api('/api/compras', { method: 'POST', body: JSON.stringify(payload) });
      msg.textContent = 'Compra guardada.';
      msg.className = 'form-msg ok';
      e.target.reset();
      loadCompras();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg error';
    }
  });
}

// ---------------- Materiales ----------------
let materialesCache = [];

async function loadMateriales() {
  const { materiales } = await api('/api/materiales');
  materialesCache = materiales;
  renderMateriales(materiales);
}

function renderMateriales(materiales) {
  $('#tabla-materiales tbody').innerHTML = materiales.map((m) => `
    <tr>
      <td>${m.codigo}</td>
      <td>${m.descripcion}</td>
      <td>${m.unidad}</td>
      <td><span class="pill ${m.categoria.toLowerCase().replace(/ /g, '-')}">${m.categoria}</span></td>
      <td>${money(m.precio_unitario)}</td>
      <td>${m.cantidad_proyectada}</td>
      <td>${money(m.monto_proyectado)}</td>
    </tr>`).join('');
}

function setupBuscadorMateriales() {
  $('#buscador-materiales').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderMateriales(materialesCache.filter((m) =>
      m.descripcion.toLowerCase().includes(q) || String(m.codigo).toLowerCase().includes(q)));
  });
}

// ---------------- Rubros ----------------
let rubrosCache = [];

async function loadRubros() {
  const { rubros } = await api('/api/rubros');
  rubrosCache = rubros;
  $('#tabla-rubros tbody').innerHTML = rubros.map((r) => `
    <tr>
      <td>${r.codigo}</td>
      <td>${r.descripcion}</td>
      <td>${money(r.monto_presupuestado)}</td>
      <td>${money(r.materiales)}</td>
      <td>${money(r.mano_obra)}</td>
      <td>${money(r.subcontratos)}</td>
      <td>${pct(r.pct_incidencia)}</td>
      <td><span class="link-action" data-codigo="${r.codigo}">Editar</span></td>
    </tr>`).join('');

  $$('#tabla-rubros .link-action').forEach((el) => {
    el.addEventListener('click', () => {
      const r = rubrosCache.find((x) => String(x.codigo) === el.dataset.codigo);
      if (r) fillFormRubro(r);
    });
  });
}

function fillFormRubro(r) {
  const form = $('#form-rubro');
  form.codigo.value = r.codigo;
  form.descripcion.value = r.descripcion;
  form.monto_presupuestado.value = r.monto_presupuestado;
  form.materiales.value = r.materiales;
  form.mano_obra.value = r.mano_obra;
  form.subcontratos.value = r.subcontratos;
  $('#rubro-form-title').textContent = `Editando rubro ${r.codigo}`;
  $('#rubro-edit-card').style.display = 'block';
}

function setupFormRubro() {
  $('#form-rubro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#form-rubro-msg');
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    const codigo = payload.codigo;
    try {
      await api(`/api/rubros/${codigo}`, { method: 'PUT', body: JSON.stringify(payload) });
      msg.textContent = 'Rubro actualizado. El Cronograma se sincronizó solo.';
      msg.className = 'form-msg ok';
      loadRubros();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg error';
    }
  });
  $('#btn-cancelar-rubro').addEventListener('click', () => {
    $('#rubro-edit-card').style.display = 'none';
  });
}

function setupGenerarTareasDesdeRubros() {
  const btn = $('#btn-generar-tareas');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const msg = $('#rubros-sync-msg');
    btn.disabled = true;
    msg.textContent = 'Sincronizando...';
    msg.className = 'form-msg';
    try {
      const data = await api('/api/cronograma/generar-desde-rubros', { method: 'POST' });
      msg.textContent = `Listo: ${data.tareas_creadas} creada(s), ${data.tareas_actualizadas} actualizada(s), ${data.tareas_eliminadas} eliminada(s).`;
      msg.className = 'form-msg ok';
      tareasCache = data.tareas;
      if ($('#view-cronograma').classList.contains('active')) {
        renderGanttSimple($('#gantt-target'), data.tareas);
      }
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------- Cronograma (HTML/CSS propio, sin librerías externas) ----------------
let tareasCache = [];

function sumarDiasISO(fechaISO, dias) {
  const d = new Date(fechaISO);
  return new Date(d.getTime() + dias * 86400000).toISOString().slice(0, 10);
}

function renderGanttSimple(target, tareas) {
  target.innerHTML = '';
  if (!tareas.length) {
    target.innerHTML = '<p class="muted">Todavía no cargaste tareas.</p>';
    return;
  }

  const starts = tareas.map((t) => new Date(t.fecha_inicio));
  const ends = tareas.map((t) => new Date(t.fecha_fin));
  const minDate = new Date(Math.min(...starts));
  const maxDate = new Date(Math.max(...ends));
  const totalDays = Math.max(1, (maxDate - minDate) / 86400000);

  const wrap = document.createElement('div');
  wrap.className = 'gantt-simple';

  const header = document.createElement('div');
  header.className = 'gantt-header-row';
  header.innerHTML = `
    <div class="gantt-label"></div>
    <div class="gantt-track">
      <span class="gantt-fecha-inicio">${minDate.toLocaleDateString('es-AR')}</span>
      <span class="gantt-fecha-fin">${maxDate.toLocaleDateString('es-AR')}</span>
    </div>`;
  wrap.appendChild(header);

  tareas.forEach((t) => {
    const start = new Date(t.fecha_inicio);
    const end = new Date(t.fecha_fin);
    const offsetPct = ((start - minDate) / 86400000 / totalDays) * 100;
    const widthPct = Math.max(1.5, ((end - start) / 86400000 / totalDays) * 100);

    const row = document.createElement('div');
    row.className = 'gantt-row';
    row.innerHTML = `
      <div class="gantt-label" title="${t.nombre}">${t.codigo} — ${t.nombre}</div>
      <div class="gantt-track"></div>`;
    const track = row.querySelector('.gantt-track');

    const bar = document.createElement('div');
    bar.className = `gantt-bar arrastrable ${t.critica ? 'critica' : 'normal'}`;
    bar.style.left = offsetPct + '%';
    bar.style.width = widthPct + '%';
    bar.title = `${t.nombre}: ${t.fecha_inicio} → ${t.fecha_fin}${t.critica ? ' (crítica)' : ''}`;
    track.appendChild(bar);

    const handleR = document.createElement('div');
    handleR.className = 'gantt-resize-handle right';
    bar.appendChild(handleR);

    const pxPerDay = () => track.getBoundingClientRect().width / totalDays;

    handleR.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const ppd = pxPerDay();
      handleR.setPointerCapture(e.pointerId);
      const onMove = (ev) => {
        const deltaDays = Math.round((ev.clientX - startX) / ppd);
        const nuevoWidthPct = Math.max(1.5, widthPct + (deltaDays / totalDays) * 100);
        bar.style.width = nuevoWidthPct + '%';
      };
      const onUp = async (ev) => {
        handleR.removeEventListener('pointermove', onMove);
        handleR.removeEventListener('pointerup', onUp);
        const deltaDays = Math.round((ev.clientX - startX) / ppd);
        if (deltaDays === 0) return;
        const nuevaDuracion = Math.max(0.5, Math.round(((t.duracion_semanas * 7 + deltaDays) / 3.5)) * 0.5);
        try {
          await api(`/api/cronograma/${t.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              nombre: t.nombre,
              duracion_semanas: nuevaDuracion,
              predecesora1: t.predecesora1,
              predecesora2: t.predecesora2,
            }),
          });
        } catch (err) {
          alert(err.message);
        }
        loadCronograma();
      };
      handleR.addEventListener('pointermove', onMove);
      handleR.addEventListener('pointerup', onUp);
    });

    bar.addEventListener('click', (e) => {
      if (e.target !== bar) return;
      const found = tareasCache.find((x) => x.id === t.id);
      if (found) fillFormTarea(found);
    });

    wrap.appendChild(row);
  });

  target.appendChild(wrap);
}

async function loadCronograma() {
  let data;
  try {
    data = await api('/api/cronograma');
  } catch (err) {
    $('#gantt-target').innerHTML = `<p class="form-msg error">${err.message}</p>`;
    return;
  }
  tareasCache = data.tareas;
  renderGanttSimple($('#gantt-target'), data.tareas);
}

// ---------------- Cronograma real ----------------
let tareasRealCache = [];

async function loadCronogramaReal() {
  let data;
  try {
    data = await api('/api/cronograma/real');
  } catch (err) {
    $('#gantt-real-target').innerHTML = `<p class="form-msg error">${err.message}</p>`;
    return;
  }
  tareasRealCache = data.tareas;

  const fechasReales = tareasRealCache.flatMap((t) => [t.fecha_inicio_real, t.fecha_fin_real]).filter(Boolean);
  let minDate, maxDate;
  if (fechasReales.length) {
    minDate = new Date(Math.min(...fechasReales.map((f) => new Date(f))) - 7 * 86400000);
    maxDate = new Date(Math.max(...fechasReales.map((f) => new Date(f))) + 14 * 86400000);
  } else if (tareasCache.length) {
    minDate = new Date(Math.min(...tareasCache.map((t) => new Date(t.fecha_inicio))));
    maxDate = new Date(Math.max(...tareasCache.map((t) => new Date(t.fecha_fin))));
  } else {
    minDate = new Date(data.fecha_inicio_proyecto || new Date());
    maxDate = new Date(minDate.getTime() + 180 * 86400000);
  }
  renderGanttReal($('#gantt-real-target'), tareasRealCache, minDate, maxDate);
}

function renderGanttReal(target, tareas, minDate, maxDate) {
  target.innerHTML = '';
  if (!tareas.length) {
    target.innerHTML = '<p class="muted">Todavía no cargaste tareas (hacelo desde la vista Proyectado).</p>';
    return;
  }
  const totalDays = Math.max(1, (maxDate - minDate) / 86400000);

  const wrap = document.createElement('div');
  wrap.className = 'gantt-simple';

  const header = document.createElement('div');
  header.className = 'gantt-header-row';
  header.innerHTML = `
    <div class="gantt-label"></div>
    <div class="gantt-track">
      <span class="gantt-fecha-inicio">${minDate.toLocaleDateString('es-AR')}</span>
      <span class="gantt-fecha-fin">${maxDate.toLocaleDateString('es-AR')}</span>
    </div>`;
  wrap.appendChild(header);

  tareas.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'gantt-row';
    row.innerHTML = `<div class="gantt-label" title="${t.nombre}">${t.codigo} — ${t.nombre}</div><div class="gantt-track"></div>`;
    const track = row.querySelector('.gantt-track');

    if (t.fecha_inicio_real && t.fecha_fin_real) {
      dibujarBarraReal(track, t, minDate, totalDays);
    } else {
      track.classList.add('vacio');
      track.innerHTML = '<span class="gantt-track-hint">Sin iniciar — hacé clic para marcar el inicio</span>';
      track.addEventListener('click', async (e) => {
        const rect = track.getBoundingClientRect();
        const pxPerDay = rect.width / totalDays;
        const diasOffset = Math.round((e.clientX - rect.left) / pxPerDay);
        const inicio = sumarDiasISO(minDate.toISOString().slice(0, 10), diasOffset);
        const fin = sumarDiasISO(inicio, 6);
        try {
          await api(`/api/cronograma/${t.id}/real`, {
            method: 'PUT',
            body: JSON.stringify({ fecha_inicio_real: inicio, fecha_fin_real: fin }),
          });
          loadCronogramaReal();
        } catch (err) {
          alert(err.message);
        }
      });
    }
    wrap.appendChild(row);
  });

  target.appendChild(wrap);
}

function dibujarBarraReal(track, t, minDate, totalDays) {
  const start = new Date(t.fecha_inicio_real);
  const end = new Date(t.fecha_fin_real);
  const offsetPct = ((start - minDate) / 86400000 / totalDays) * 100;
  const widthPct = Math.max(1.5, ((end - start) / 86400000 / totalDays) * 100);

  const bar = document.createElement('div');
  bar.className = 'gantt-bar normal arrastrable';
  bar.style.left = offsetPct + '%';
  bar.style.width = widthPct + '%';
  bar.title = `${t.nombre}: ${t.fecha_inicio_real} → ${t.fecha_fin_real}`;

  const handleL = document.createElement('div');
  handleL.className = 'gantt-resize-handle left';
  const handleR = document.createElement('div');
  handleR.className = 'gantt-resize-handle right';
  bar.appendChild(handleL);
  bar.appendChild(handleR);
  track.appendChild(bar);

  const pxPerDay = () => track.getBoundingClientRect().width / totalDays;

  bar.addEventListener('pointerdown', (e) => {
    if (e.target !== bar) return;
    e.preventDefault();
    const startX = e.clientX;
    const ppd = pxPerDay();
    bar.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const deltaDays = Math.round((ev.clientX - startX) / ppd);
      bar.style.left = (offsetPct + (deltaDays / totalDays) * 100) + '%';
    };
    const onUp = async (ev) => {
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      const deltaDays = Math.round((ev.clientX - startX) / ppd);
      if (deltaDays === 0) return;
      const nuevoInicio = sumarDiasISO(t.fecha_inicio_real, deltaDays);
      const nuevoFin = sumarDiasISO(t.fecha_fin_real, deltaDays);
      try {
        await api(`/api/cronograma/${t.id}/real`, {
          method: 'PUT',
          body: JSON.stringify({ fecha_inicio_real: nuevoInicio, fecha_fin_real: nuevoFin }),
        });
      } catch (err) {
        alert(err.message);
      }
      loadCronogramaReal();
    };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
  });

  handleR.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const ppd = pxPerDay();
    handleR.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const deltaDays = Math.round((ev.clientX - startX) / ppd);
      const nuevoWidthPct = Math.max(1.5, widthPct + (deltaDays / totalDays) * 100);
      bar.style.width = nuevoWidthPct + '%';
    };
    const onUp = async (ev) => {
      handleR.removeEventListener('pointermove', onMove);
      handleR.removeEventListener('pointerup', onUp);
      const deltaDays = Math.round((ev.clientX - startX) / ppd);
      if (deltaDays === 0) return;
      let nuevoFin = sumarDiasISO(t.fecha_fin_real, deltaDays);
      if (nuevoFin <= t.fecha_inicio_real) nuevoFin = sumarDiasISO(t.fecha_inicio_real, 1);
      try {
        await api(`/api/cronograma/${t.id}/real`, {
          method: 'PUT',
          body: JSON.stringify({ fecha_fin_real: nuevoFin }),
        });
      } catch (err) {
        alert(err.message);
      }
      loadCronogramaReal();
    };
    handleR.addEventListener('pointermove', onMove);
    handleR.addEventListener('pointerup', onUp);
  });

  handleL.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const ppd = pxPerDay();
    handleL.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const deltaDays = Math.round((ev.clientX - startX) / ppd);
      bar.style.left = (offsetPct + (deltaDays / totalDays) * 100) + '%';
      bar.style.width = Math.max(1.5, widthPct - (deltaDays / totalDays) * 100) + '%';
    };
    const onUp = async (ev) => {
      handleL.removeEventListener('pointermove', onMove);
      handleL.removeEventListener('pointerup', onUp);
      const deltaDays = Math.round((ev.clientX - startX) / ppd);
      if (deltaDays === 0) return;
      let nuevoInicio = sumarDiasISO(t.fecha_inicio_real, deltaDays);
      if (nuevoInicio >= t.fecha_fin_real) nuevoInicio = sumarDiasISO(t.fecha_fin_real, -1);
      try {
        await api(`/api/cronograma/${t.id}/real`, {
          method: 'PUT',
          body: JSON.stringify({ fecha_inicio_real: nuevoInicio }),
        });
      } catch (err) {
        alert(err.message);
      }
      loadCronogramaReal();
    };
    handleL.addEventListener('pointermove', onMove);
    handleL.addEventListener('pointerup', onUp);
  });
}

// ---------------- Cronograma revisado (camino crítico recalculado) ----------------
let tareasRevisadoCache = [];

async function loadCronogramaRevisado() {
  let data;
  try {
    data = await api('/api/cronograma/revisado');
  } catch (err) {
    $('#gantt-revisado-target').innerHTML = `<p class="form-msg error">${err.message}</p>`;
    $('#revisado-resumen').innerHTML = '';
    return;
  }
  tareasRevisadoCache = data.tareas;
  renderResumenRevisado(data);
  renderGanttRevisado($('#gantt-revisado-target'), data.tareas);
}

function renderResumenRevisado(data) {
  const cont = $('#revisado-resumen');
  if (!data.fecha_fin_proyecto_original) {
    cont.innerHTML = '';
    return;
  }
  const original = new Date(data.fecha_fin_proyecto_original);
  const revisada = new Date(data.fecha_fin_proyecto_revisada);
  const diffDias = Math.round((revisada - original) / 86400000);
  let etiqueta = 'Sin cambios';
  let clase = '';
  if (diffDias > 0) { etiqueta = `+${diffDias} días de atraso`; clase = 'atraso'; }
  else if (diffDias < 0) { etiqueta = `${Math.abs(diffDias)} días de adelanto`; clase = 'adelanto'; }

  cont.innerHTML = `
    <div>
      <div class="resumen-label">Fin proyectado originalmente</div>
      <div class="resumen-valor">${original.toLocaleDateString('es-AR')}</div>
    </div>
    <div>
      <div class="resumen-label">Fin revisado hoy</div>
      <div class="resumen-valor">${revisada.toLocaleDateString('es-AR')}</div>
    </div>
    <div>
      <div class="resumen-label">Diferencia</div>
      <div class="resumen-valor ${clase}">${etiqueta}</div>
    </div>`;
}

function renderGanttRevisado(target, tareas) {
  target.innerHTML = '';
  if (!tareas.length) {
    target.innerHTML = '<p class="muted">Todavía no cargaste tareas.</p>';
    return;
  }
  const starts = tareas.map((t) => new Date(t.fecha_inicio_revisada));
  const ends = tareas.map((t) => new Date(t.fecha_fin_revisada));
  const minDate = new Date(Math.min(...starts));
  const maxDate = new Date(Math.max(...ends));
  const totalDays = Math.max(1, (maxDate - minDate) / 86400000);

  const wrap = document.createElement('div');
  wrap.className = 'gantt-simple';

  const header = document.createElement('div');
  header.className = 'gantt-header-row';
  header.innerHTML = `
    <div class="gantt-label"></div>
    <div class="gantt-track">
      <span class="gantt-fecha-inicio">${minDate.toLocaleDateString('es-AR')}</span>
      <span class="gantt-fecha-fin">${maxDate.toLocaleDateString('es-AR')}</span>
    </div>`;
  wrap.appendChild(header);

  tareas.forEach((t) => {
    const start = new Date(t.fecha_inicio_revisada);
    const end = new Date(t.fecha_fin_revisada);
    const offsetPct = ((start - minDate) / 86400000 / totalDays) * 100;
    const widthPct = Math.max(1.5, ((end - start) / 86400000 / totalDays) * 100);

    const row = document.createElement('div');
    row.className = 'gantt-row';
    row.innerHTML = `<div class="gantt-label" title="${t.nombre}">${t.codigo} — ${t.nombre}</div><div class="gantt-track"></div>`;
    const track = row.querySelector('.gantt-track');

    const bar = document.createElement('div');
    bar.className = `gantt-bar ${t.critica ? 'critica' : 'normal'} ${t.completada ? 'completada' : ''}`;
    bar.style.left = offsetPct + '%';
    bar.style.width = widthPct + '%';
    bar.title = `${t.nombre}: ${t.fecha_inicio_revisada} → ${t.fecha_fin_revisada}${t.critica ? ' (crítica)' : ''}${t.completada ? ' (completada)' : ''}`;
    track.appendChild(bar);

    if (!t.completada) {
      const handleR = document.createElement('div');
      handleR.className = 'gantt-resize-handle right';
      bar.appendChild(handleR);

      const pxPerDay = () => track.getBoundingClientRect().width / totalDays;
      handleR.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const ppd = pxPerDay();
        handleR.setPointerCapture(e.pointerId);
        const onMove = (ev) => {
          const deltaDays = Math.round((ev.clientX - startX) / ppd);
          const nuevoWidthPct = Math.max(1.5, widthPct + (deltaDays / totalDays) * 100);
          bar.style.width = nuevoWidthPct + '%';
        };
        const onUp = async (ev) => {
          handleR.removeEventListener('pointermove', onMove);
          handleR.removeEventListener('pointerup', onUp);
          const deltaDays = Math.round((ev.clientX - startX) / ppd);
          if (deltaDays === 0) return;
          const duracionActual = t.duracion_revisada_semanas || t.duracion_semanas;
          const nuevaDuracion = Math.max(0.5, Math.round(((duracionActual * 7 + deltaDays) / 3.5)) * 0.5);
          try {
            await api(`/api/cronograma/${t.id}/revisado`, {
              method: 'PUT',
              body: JSON.stringify({ duracion_revisada_semanas: nuevaDuracion }),
            });
          } catch (err) {
            alert(err.message);
          }
          loadCronogramaRevisado();
        };
        handleR.addEventListener('pointermove', onMove);
        handleR.addEventListener('pointerup', onUp);
      });
    }

    wrap.appendChild(row);
  });

  target.appendChild(wrap);
}

function setupSubtabsCronograma() {
  $$('.subtab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.subtab').forEach((x) => x.classList.remove('active'));
      $$('.subview').forEach((x) => x.classList.remove('active'));
      tab.classList.add('active');
      $(`#sub-${tab.dataset.subview}`).classList.add('active');
      if (tab.dataset.subview === 'proyectado') loadCronograma();
      if (tab.dataset.subview === 'real') loadCronogramaReal();
      if (tab.dataset.subview === 'revisado') loadCronogramaRevisado();
    });
  });
}

function fillFormTarea(t) {
  const form = $('#form-tarea');
  form.id.value = t.id;
  form.codigo.value = t.codigo;
  form.nombre.value = t.nombre;
  form.duracion_semanas.value = t.duracion_semanas;
  form.predecesora1.value = t.predecesora1 ?? '';
  form.predecesora2.value = t.predecesora2 ?? '';
  $('#tarea-form-title').textContent = `Editando tarea ${t.codigo}`;
  $('#btn-cancelar-tarea').style.display = 'inline-block';
  $('#btn-borrar-tarea').style.display = 'inline-block';
}

function resetFormTarea() {
  $('#form-tarea').reset();
  $('#form-tarea').id.value = '';
  $('#tarea-form-title').textContent = 'Agregar tarea';
  $('#btn-cancelar-tarea').style.display = 'none';
  $('#btn-borrar-tarea').style.display = 'none';
}

function setupFormTarea() {
  $('#form-tarea').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#form-tarea-msg');
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    const id = payload.id;
    delete payload.id;
    payload.predecesora1 = payload.predecesora1 || null;
    payload.predecesora2 = payload.predecesora2 || null;
    try {
      if (id) {
        await api(`/api/cronograma/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/cronograma', { method: 'POST', body: JSON.stringify(payload) });
      }
      msg.textContent = 'Guardado.';
      msg.className = 'form-msg ok';
      resetFormTarea();
      loadCronograma();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg error';
    }
  });

  $('#btn-cancelar-tarea').addEventListener('click', resetFormTarea);

  $('#btn-borrar-tarea').addEventListener('click', async () => {
    const id = $('#form-tarea').id.value;
    if (!id) return;
    await api(`/api/cronograma/${id}`, { method: 'DELETE' });
    resetFormTarea();
    loadCronograma();
  });
}

// ---------------- Proyecto ----------------
async function loadProyecto() {
  const proyecto = await api('/api/proyecto');
  const form = $('#form-proyecto');
  Object.keys(proyecto).forEach((k) => {
    if (form[k]) form[k].value = proyecto[k] ?? '';
  });
  $('#brand-project').textContent = proyecto.nombre || 'Proyecto';
}

function setupFormProyecto() {
  $('#form-proyecto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#form-proyecto-msg');
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api('/api/proyecto', { method: 'POST', body: JSON.stringify(payload) });
      msg.textContent = 'Datos actualizados.';
      msg.className = 'form-msg ok';
      $('#brand-project').textContent = payload.nombre || 'Proyecto';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg error';
    }
  });
}

// ---------------- Init ----------------
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupFormCompra();
  setupBuscadorMateriales();
  setupBuscadorComputo();
  setupSubtabsCronograma();
  setupFormTarea();
  setupFormRubro();
  setupGenerarTareasDesdeRubros();
  setupFormProyecto();
  loadProyecto();
  loadDashboard();
});

window.addEventListener('resize', () => {
  const dashboardActive = $('#view-dashboard').classList.contains('active');
  if (dashboardActive) loadDashboard();
});
