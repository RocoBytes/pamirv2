import { Transform, TransformCallback } from 'node:stream';

/**
 * Transform stream que aborta si el número de bytes supera maxBytes.
 * Garantiza que nunca cargamos el archivo completo en RAM antes de rechazarlo.
 * Migrado sin cambios de comportamiento desde el adaptador de subida anterior
 * (Drive, ya eliminado).
 */
export class SizeGuard extends Transform {
  private bytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.bytes += chunk.length;

    if (this.bytes > this.maxBytes) {
      callback(Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE' }));
      return;
    }

    this.push(chunk);
    callback();
  }
}
