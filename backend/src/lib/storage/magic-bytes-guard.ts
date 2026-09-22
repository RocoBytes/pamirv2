import { Transform, TransformCallback } from 'node:stream';

/** Cabecera de un PDF: los cinco primeros bytes de todo archivo válido. */
export const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');

export const INVALID_FILE_TYPE = 'INVALID_FILE_TYPE';

/**
 * Transform stream que aborta si el archivo no empieza con una firma dada.
 *
 * Complementa a la validación por extensión: un archivo llamado `manual.pdf`
 * puede contener cualquier cosa, y el nombre lo elige quien sube. Esto mira el
 * contenido real.
 *
 * Solo retiene los primeros bytes hasta poder decidir —nunca el archivo
 * entero— porque el contenedor es read_only y la memoria es el recurso
 * escaso: la misma razón por la que existe SizeGuard.
 *
 * El chequeo es ESTRICTO: la firma tiene que estar en el byte 0. Hay PDFs
 * generados por herramientas descuidadas que traen basura antes de la
 * cabecera y algunos lectores los toleran; acá no, porque estos documentos los
 * sube un admin del club y un rechazo se detecta y se corrige al instante. Si
 * alguna vez rebota un PDF legítimo, ampliar la búsqueda a los primeros 1024
 * bytes es el cambio mínimo.
 */
export class MagicBytesGuard extends Transform {
  private checked = false;
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly signature: Buffer = PDF_SIGNATURE) {
    super();
  }

  private fail(callback: TransformCallback): void {
    callback(Object.assign(new Error(INVALID_FILE_TYPE), { code: INVALID_FILE_TYPE }));
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    // Ya validado: a partir de acá es un paso directo, sin copiar ni retener.
    if (this.checked) {
      this.push(chunk);
      callback();
      return;
    }

    // Un chunk puede ser más corto que la firma (5 bytes), así que se acumula
    // hasta tener con qué decidir en vez de suponer que el primero alcanza.
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);

    if (this.pending.length < this.signature.length) {
      callback();
      return;
    }

    if (!this.pending.subarray(0, this.signature.length).equals(this.signature)) {
      this.fail(callback);
      return;
    }

    this.checked = true;
    const buffered = this.pending;
    this.pending = Buffer.alloc(0);
    this.push(buffered);
    callback();
  }

  _flush(callback: TransformCallback): void {
    // El archivo terminó sin llegar al largo de la firma: vacío o truncado.
    // Tampoco es un PDF, así que se rechaza en vez de dejarlo pasar.
    if (!this.checked) {
      this.fail(callback);
      return;
    }
    callback();
  }
}
