import { Transform } from 'node:stream';
/** Cabeceras conocidas, por los primeros bytes de cada formato. */
export const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
export const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/**
 * Un GPX es XML, y ahí la variación legítima es real: puede abrir con la
 * declaración XML o directamente con la etiqueta raíz.
 */
export const XML_SIGNATURES = [
    Buffer.from('<?xml', 'ascii'),
    Buffer.from('<gpx', 'ascii'),
    Buffer.from('<GPX', 'ascii'),
];
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
export const INVALID_FILE_TYPE = 'INVALID_FILE_TYPE';
/**
 * Ventana que se inspecciona en modo tolerante: alcanza para un BOM, algunos
 * saltos de línea y la firma más larga, y acota cuánto se retiene en memoria.
 */
const PROBE_BYTES = 64;
/**
 * Transform stream que aborta si el contenido no empieza con una cabecera
 * conocida.
 *
 * Complementa a la validación por extensión: el nombre lo elige quien sube, así
 * que `manual.pdf` puede contener cualquier cosa. Esto mira los bytes reales.
 *
 * Solo retiene los primeros bytes hasta poder decidir —nunca el archivo
 * entero— porque el contenedor es read_only y la memoria es el recurso escaso:
 * la misma razón por la que existe SizeGuard. Como corta antes de que nada
 * llegue al bucket, tampoco queda un objeto huérfano que limpiar.
 */
export class MagicBytesGuard extends Transform {
    checked = false;
    pending = Buffer.alloc(0);
    signatures;
    tolerant;
    needed;
    constructor(options = { signatures: [PDF_SIGNATURE] }) {
        super();
        this.signatures = options.signatures;
        this.tolerant = options.allowLeadingWhitespace ?? false;
        const longest = Math.max(...this.signatures.map((s) => s.length));
        this.needed = this.tolerant ? PROBE_BYTES : longest;
    }
    fail(callback) {
        callback(Object.assign(new Error(INVALID_FILE_TYPE), { code: INVALID_FILE_TYPE }));
    }
    /** Primer byte con contenido, salteando BOM y (si aplica) espacios. */
    contentStart(buffer) {
        let offset = buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM) ? UTF8_BOM.length : 0;
        if (this.tolerant) {
            while (offset < buffer.length && /\s/.test(String.fromCharCode(buffer[offset])))
                offset++;
        }
        return offset;
    }
    matches(buffer) {
        const offset = this.contentStart(buffer);
        return this.signatures.some((signature) => buffer.subarray(offset, offset + signature.length).equals(signature));
    }
    _transform(chunk, _encoding, callback) {
        // Ya validado: de acá en más es un paso directo, sin copiar ni retener.
        if (this.checked) {
            this.push(chunk);
            callback();
            return;
        }
        // Un chunk puede ser más corto que la firma —un stream puede entregar la
        // cabecera byte a byte—, así que se acumula hasta tener con qué decidir en
        // vez de suponer que el primero alcanza.
        this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
        if (this.pending.length < this.needed) {
            callback();
            return;
        }
        if (!this.matches(this.pending)) {
            this.fail(callback);
            return;
        }
        this.checked = true;
        const buffered = this.pending;
        this.pending = Buffer.alloc(0);
        this.push(buffered);
        callback();
    }
    _flush(callback) {
        if (this.checked) {
            callback();
            return;
        }
        // El archivo terminó antes de llenar la ventana. Igual puede ser válido
        // (un JPEG diminuto ya se identifica con tres bytes), así que se decide
        // con lo que haya en vez de rechazar por corto.
        if (this.pending.length > 0 && this.matches(this.pending)) {
            this.checked = true;
            this.push(this.pending);
            this.pending = Buffer.alloc(0);
            callback();
            return;
        }
        // Vacío, truncado o con otra cabecera: no es ninguno de los formatos.
        this.fail(callback);
    }
}
