// Categorías de la biblioteca de documentos del club. Fuente única consumida
// tanto por la vista pública (DocumentosPage) como por el formulario de gestión
// del admin (AdminPanel), para que el <select> y la vista nunca se desincronicen.
// Debe mantenerse en sync con DOCUMENTO_CATEGORIAS del backend
// (backend/src/controllers/documentos.controller.ts).
export const CATEGORIA_LABELS: Record<string, string> = {
  AVISO_EXPEDICION: 'Formularios de Aviso de Expedición — Retenes de Carabineros',
  MATRIZ_RIESGO: 'Matriz de Riesgo 3x3',
  CHECKLIST: 'Check-lists de Salidas',
  GLOSARIO: 'Glosario',
  LIBROS: 'Libros y Manuales',
  OTRO: 'Otros',
}

export const CATEGORIA_ORDEN = Object.keys(CATEGORIA_LABELS)
