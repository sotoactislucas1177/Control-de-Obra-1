"""
Cálculo del método del camino crítico (CPM) sobre una lista de tareas.

Incluye dos vistas:
- compute_cpm: cronograma proyectado (según duración planificada, contado en
  semanas desde el inicio del proyecto). Es el original, sin tocar.
- compute_cpm_revisado: cronograma revisado, que mezcla fechas reales (para
  tareas ya iniciadas o terminadas, que son un hecho fijo) con duraciones
  revisadas cargadas a mano o, si no se cargó ninguna, la duración
  originalmente planificada (para lo que todavía falta), y recalcula el
  camino crítico "hoy" en base a eso.
"""
import datetime


def _topological_order(tareas):
    """Devuelve (orden, sucesores, error). orden es None si hay un ciclo."""
    by_codigo = {t["codigo"]: t for t in tareas}
    codigos = list(by_codigo.keys())

    sucesores = {c: [] for c in codigos}
    for t in tareas:
        for p in (t.get("predecesora1"), t.get("predecesora2")):
            if p is not None and p in sucesores:
                sucesores[p].append(t["codigo"])

    grado_entrada = {c: 0 for c in codigos}
    for t in tareas:
        for p in (t.get("predecesora1"), t.get("predecesora2")):
            if p is not None and p in grado_entrada:
                grado_entrada[t["codigo"]] += 1

    pendientes = [c for c in codigos if grado_entrada[c] == 0]
    orden = []
    grado_restante = dict(grado_entrada)
    while pendientes:
        pendientes.sort()
        c = pendientes.pop(0)
        orden.append(c)
        for s in sucesores[c]:
            grado_restante[s] -= 1
            if grado_restante[s] == 0:
                pendientes.append(s)

    if len(orden) != len(codigos):
        return None, sucesores, (
            "Hay una dependencia circular entre tareas (una tarea depende, directa o "
            "indirectamente, de sí misma). Revisá las predecesoras."
        )
    return orden, sucesores, None


def compute_cpm(tareas, fecha_inicio_proyecto):
    """
    tareas: lista de dicts con codigo, nombre, duracion_semanas, predecesora1, predecesora2
    fecha_inicio_proyecto: date del inicio real del proyecto
    Devuelve la misma lista de tareas enriquecida con es, ef, ls, lf, holgura,
    critica, fecha_inicio, fecha_fin. También el total de semanas del proyecto.
    """
    by_codigo = {t["codigo"]: dict(t) for t in tareas}
    orden, sucesores, error = _topological_order(tareas)
    if error:
        return None, error

    for c in orden:
        t = by_codigo[c]
        preds = [p for p in (t.get("predecesora1"), t.get("predecesora2")) if p is not None and p in by_codigo]
        if not preds:
            es = 1
        else:
            es = max(by_codigo[p]["ef"] for p in preds) + 1
        ef = es + t["duracion_semanas"] - 1
        t["es"] = es
        t["ef"] = ef

    duracion_total = max(t["ef"] for t in by_codigo.values())

    for c in reversed(orden):
        t = by_codigo[c]
        sucs = sucesores[c]
        if not sucs:
            lf = duracion_total
        else:
            lf = min(by_codigo[s]["ls"] for s in sucs) - 1
        ls = lf - t["duracion_semanas"] + 1
        t["lf"] = lf
        t["ls"] = ls
        t["holgura"] = ls - t["es"]
        t["critica"] = t["holgura"] == 0

    for c in by_codigo:
        t = by_codigo[c]
        t["fecha_inicio"] = (fecha_inicio_proyecto + datetime.timedelta(weeks=t["es"] - 1)).isoformat()
        t["fecha_fin"] = (fecha_inicio_proyecto + datetime.timedelta(weeks=t["ef"]) - datetime.timedelta(days=1)).isoformat()

    resultado = [by_codigo[c] for c in by_codigo]
    resultado.sort(key=lambda t: t["codigo"])
    return {"tareas": resultado, "duracion_total_semanas": duracion_total}, None


def compute_cpm_revisado(tareas, fecha_inicio_proyecto):
    """
    Cronograma revisado: para cada tarea usa, en este orden de prioridad,
    1) fechas reales (si la tarea ya se inició/terminó, son un hecho fijo),
    2) una duración revisada cargada a mano (si la tarea todavía no terminó
       pero se sabe que va a durar distinto de lo planificado),
    3) la duración originalmente planificada.
    Con eso recalcula fechas y camino crítico "hoy", combinando lo que ya
    pasó realmente con una proyección de lo que falta.
    """
    by_codigo = {t["codigo"]: dict(t) for t in tareas}
    orden, sucesores, error = _topological_order(tareas)
    if error:
        return None, error

    def _parse(d):
        return datetime.date.fromisoformat(d) if d else None

    # pase hacia adelante: fecha de inicio/fin "efectiva" de cada tarea
    for c in orden:
        t = by_codigo[c]
        preds = [p for p in (t.get("predecesora1"), t.get("predecesora2")) if p is not None and p in by_codigo]
        inicio_real = _parse(t.get("fecha_inicio_real"))
        fin_real = _parse(t.get("fecha_fin_real"))

        if inicio_real:
            inicio_efectivo = inicio_real
        elif preds:
            inicio_efectivo = max(by_codigo[p]["fin_efectivo"] for p in preds) + datetime.timedelta(days=1)
        else:
            inicio_efectivo = fecha_inicio_proyecto

        if inicio_real and fin_real:
            fin_efectivo = fin_real
            duracion_dias = (fin_efectivo - inicio_efectivo).days + 1
            if duracion_dias < 1:
                duracion_dias = 1
        else:
            semanas = t.get("duracion_revisada_semanas") or t["duracion_semanas"]
            duracion_dias = max(1, round(semanas * 7))
            fin_efectivo = inicio_efectivo + datetime.timedelta(days=duracion_dias - 1)

        t["inicio_efectivo"] = inicio_efectivo
        t["fin_efectivo"] = fin_efectivo
        t["duracion_efectiva_dias"] = duracion_dias
        t["completada"] = bool(inicio_real and fin_real)

    fecha_fin_proyecto = max(t["fin_efectivo"] for t in by_codigo.values())

    # pase hacia atrás: fecha límite de cada tarea sin atrasar el final del proyecto
    for c in reversed(orden):
        t = by_codigo[c]
        sucs = sucesores[c]
        if not sucs:
            fin_tardio = fecha_fin_proyecto
        else:
            fin_tardio = min(by_codigo[s]["inicio_tardio"] for s in sucs) - datetime.timedelta(days=1)
        inicio_tardio = fin_tardio - datetime.timedelta(days=t["duracion_efectiva_dias"] - 1)
        t["fin_tardio"] = fin_tardio
        t["inicio_tardio"] = inicio_tardio
        t["holgura_dias"] = (inicio_tardio - t["inicio_efectivo"]).days
        t["critica"] = t["holgura_dias"] <= 0

    resultado = []
    for c in by_codigo:
        t = by_codigo[c]
        resultado.append({
            "id": t.get("id"),
            "codigo": t["codigo"],
            "nombre": t["nombre"],
            "duracion_semanas": t["duracion_semanas"],
            "duracion_revisada_semanas": t.get("duracion_revisada_semanas"),
            "predecesora1": t.get("predecesora1"),
            "predecesora2": t.get("predecesora2"),
            "fecha_inicio_real": t.get("fecha_inicio_real"),
            "fecha_fin_real": t.get("fecha_fin_real"),
            "fecha_inicio_revisada": t["inicio_efectivo"].isoformat(),
            "fecha_fin_revisada": t["fin_efectivo"].isoformat(),
            "duracion_efectiva_semanas": round(t["duracion_efectiva_dias"] / 7, 2),
            "holgura_dias": t["holgura_dias"],
            "critica": t["critica"],
            "completada": t["completada"],
        })
    resultado.sort(key=lambda t: t["codigo"])

    return {
        "tareas": resultado,
        "fecha_fin_proyecto_revisada": fecha_fin_proyecto.isoformat(),
    }, None
