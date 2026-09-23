// Generación de códigos QR, siempre en el cliente y siempre con la librería
// `qrcode` (nunca un servicio remoto de terceros: el valor codificado —un
// link de invitación— nunca debería viajar a un dominio ajeno solo para
// dibujarse). `qrcode` pesa lo suyo, así que se importa perezosamente: nada
// de esto entra al chunk principal, solo se descarga cuando una pantalla
// realmente necesita dibujar un QR (ver QrCode.tsx).
import type * as QRCodeNamespace from 'qrcode'

type QRCodeModule = typeof QRCodeNamespace

let qrcodeModulePromise: Promise<QRCodeModule> | undefined

function loadQrcode(): Promise<QRCodeModule> {
  qrcodeModulePromise ??= import('qrcode')
  return qrcodeModulePromise
}

export interface RenderQrOptions {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  margin?: number
}

// 'M' (recupera ~15% dañado) y margen 2 son el balance de siempre para un QR
// que se muestra en pantalla o se imprime chico: 'H' agranda el símbolo sin
// necesidad (acá no hay logo superpuesto que justifique más redundancia).
const DEFAULT_ERROR_CORRECTION: NonNullable<RenderQrOptions['errorCorrectionLevel']> = 'M'
const DEFAULT_MARGIN = 2

/** SVG (como string) del QR de `value`. */
export async function renderQrSvg(value: string, opts: RenderQrOptions = {}): Promise<string> {
  const QRCode = await loadQrcode()
  return QRCode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: opts.errorCorrectionLevel ?? DEFAULT_ERROR_CORRECTION,
    margin: opts.margin ?? DEFAULT_MARGIN,
  })
}

/** Data URL `image/png` del QR de `value`, cuadrado de `size` px de lado. */
export async function renderQrPngDataUrl(
  value: string,
  size = 1024,
  opts: RenderQrOptions = {},
): Promise<string> {
  const QRCode = await loadQrcode()
  return QRCode.toDataURL(value, {
    type: 'image/png',
    width: size,
    errorCorrectionLevel: opts.errorCorrectionLevel ?? DEFAULT_ERROR_CORRECTION,
    margin: opts.margin ?? DEFAULT_MARGIN,
  })
}

/**
 * Un SVG como data URL codificada con `encodeURIComponent` (no base64): más
 * liviana y evita el paso por `btoa`, que rompe con los caracteres no-Latin1
 * que puede traer un SVG (aunque el de `qrcode` no debería tener ninguno).
 * Pensado para el `src` de un <img> — nunca para `dangerouslySetInnerHTML`.
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// Sin acentos/mayúsculas/espacios ni ningún otro caracter fuera de [a-z0-9-]:
// mismo criterio que SLUG_PATTERN en club-brand.ts, para que el nombre de
// archivo descargado sea válido en cualquier sistema operativo.
function sanitizeForFileName(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'club'
}

function formatDateStamp(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

/** `riala-qr-<slug-saneado>-YYYYMMDD.<ext>`, para el botón "Descargar". */
export function buildQrFileName(slug: string, date: Date, ext: 'svg' | 'png'): string {
  return `riala-qr-${sanitizeForFileName(slug)}-${formatDateStamp(date)}.${ext}`
}
