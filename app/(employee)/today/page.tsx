export default function TodayPage() {
  return <main className="shell"><section className="hero"><p className="eyebrow">OPERACIÓN · TEPEXI</p><h1>Hoy en Café Épico</h1><p className="muted">La pantalla de empleado prioriza apertura, calidad, faltantes y entrega de turno.</p></section>
    <section className="grid">
      <article className="card"><span className="pill">APERTURA</span><div className="metric">0 / 12</div><p>Completa primero las tareas críticas para estar operativos a las 7:30.</p><button>Continuar apertura</button></article>
      <article className="card"><span className="pill">ESPRESSO QC</span><div className="metric">22–35 s</div><p>Registra dosis, yield, tiempo y evaluación sensorial.</p><p className="status-warn">Pendiente de control de apertura</p></article>
      <article className="card"><span className="pill">INVENTARIO</span><div className="metric">—</div><p>Faltantes, conteos y FIFO se conectarán al inventario operativo.</p></article>
      <article className="card"><span className="pill">ENTREGA</span><div className="metric">16:00</div><p>Barra abastecida, limpia, incidencias, faltantes y corte de turno.</p></article>
    </section>
  </main>;
}
