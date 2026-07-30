"""
Cálculo del método del camino crítico (CPM) sobre una lista de tareas.
Reemplaza, en código real, las fórmulas frágiles de INDEX/MATCH/MINIFS
que usábamos en la planilla de Excel.
"""
import datetime


def compute_cpm(tareas, fecha_inicio_proyecto):
    """
    tareas: lista de dicts con codigo, nombre, duracion_semanas, predecesora1, predecesora2
    fecha_inicio_proyecto: date del inicio real del proyecto
    Devuelve la misma lista de tareas enriquecida con es, ef, ls, lf, holgura,
    critica, fecha_inicio, fecha_fin. También el total de semanas del proyecto.
    """
    by_codigo = {t["codigo"]: dict(t) for t in tareas}
    codigos = list(by_codigo.keys())

    # sucesores de cada tarea (para el pase hacia atrás)
    sucesores = {c: [] for c in codigos}
    for t in tareas:
        for p in (t.get("predecesora1"), t.get("predecesora2")):
            if p is not None and p in sucesores:
                sucesores[p].append(t["codigo"])

    # orden topológico (Kahn) según predecesoras
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
        # hay un ciclo de predecesoras (A depende de B y B depende de A) - no
        # se puede calcular un cronograma válido. Devolvemos sin CPM y avisamos.
        return None, "Hay una dependencia circular entre tareas (una tarea depende, directa o indirectamente, de sí misma). Revisá las predecesoras."

    # pase hacia adelante (Early Start / Early Finish), en orden topológico
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

    # pase hacia atrás (Late Start / Late Finish), en orden topológico inverso
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

    for c in codigos:
        t = by_codigo[c]
        t["fecha_inicio"] = (fecha_inicio_proyecto + datetime.timedelta(weeks=t["es"] - 1)).isoformat()
        t["fecha_fin"] = (fecha_inicio_proyecto + datetime.timedelta(weeks=t["ef"]) - datetime.timedelta(days=1)).isoformat()

    resultado = [by_codigo[c] for c in codigos]
    resultado.sort(key=lambda t: t["codigo"])
    return {"tareas": resultado, "duracion_total_semanas": duracion_total}, None
