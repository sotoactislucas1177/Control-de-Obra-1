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
  if (view === 'cronograma') loadCronograma();
  if (view === 'proyecto') loadProyecto();
}

// ---------------- Dashboard ----------------
let chartCategoria, chartDesvio;

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
  if (chartCategoria) chartCategoria.destroy();
  chartCategoria = new Chart($('#chart-categoria'), {
    type: 'bar',
    data: {
      labels: cats.map((c) => c.categoria),
      datasets: [
        { label: 'Proyectado', data: cats.map((c) => c.proyectado), backgroundColor: '#2E5597' },
        { label: 'Gastado', data: cats.map((c) => c.gastado), backgroundColor: '#4C8DFF' },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
  });

  const top = [...resumen.detalle_materiales]
    .sort((a, b) => Math.abs(b.diferencia_monto) - Math.abs(a.diferencia_monto))
    .slice(0, 8)
    .filter((m) => m.monto_gastado > 0);

  if (chartDesvio) chartDesvio.destroy();
  chartDesvio = new Chart($('#chart-desvio'), {
    type: 'bar',
    data: {
      labels: top.map((m) => m.descripcion.slice(0, 22)),
      datasets: [{ label: 'Desvío ($)', data: top.map((m) => m.diferencia_monto),
        backgroundColor: top.map((m) => (m.diferencia_monto > 0 ? '#D64545' : '#1F9D6B')) }],
    },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } },
  });

  if (top.length === 0) {
    $('#chart-desvio').closest('.card').querySelector('h3').textContent =
      'Materiales con mayor desvío (todavía no cargaste compras)';
  }
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
async function loadRubros() {
  const { rubros } = await api('/api/rubros');
  $('#tabla-rubros tbody').innerHTML = rubros.map((r) => `
    <tr>
      <td>${r.codigo}</td>
      <td>${r.descripcion}</td>
      <td>${money(r.monto_presupuestado)}</td>
      <td>${money(r.materiales)}</td>
      <td>${money(r.mano_obra)}</td>
      <td>${money(r.subcontratos)}</td>
      <td>${pct(r.pct_incidencia)}</td>
    </tr>`).join('');
}

// ---------------- Cronograma / Gantt ----------------
let ganttInstance = null;
let tareasCache = [];

async function loadCronograma() {
  let data;
  try {
    data = await api('/api/cronograma');
  } catch (err) {
    $('#gantt-target').innerHTML = `<p class="form-msg error">${err.message}</p>`;
    return;
  }
  tareasCache = data.tareas;

  const tasks = data.tareas.map((t) => ({
    id: String(t.id),
    name: `${t.codigo} — ${t.nombre}`,
    start: t.fecha_inicio,
    end: t.fecha_fin,
    progress: 0,
    custom_class: t.critica ? 'bar-critica' : 'bar-normal',
  }));

  $('#gantt-target').innerHTML = '';
  if (tasks.length > 0) {
    ganttInstance = new Gantt('#gantt-target', tasks, {
      view_mode: 'Week',
      on_click: (task) => {
        const t = tareasCache.find((x) => String(x.id) === task.id);
        if (t) fillFormTarea(t);
      },
    });
  }
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
  setupFormTarea();
  setupFormProyecto();
  loadProyecto();
  loadDashboard();
});
