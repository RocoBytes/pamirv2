import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectStorageProvider, parseGcsCredentials, type SelectStorageProviderParams } from './get-file-storage.js';

const base: SelectStorageProviderParams = {
  storageProvider: undefined,
  gcsBucket: undefined,
  gcsProjectId: undefined,
  gcsCredentialsJson: undefined,
  nodeEnv: 'development',
};

describe('selectStorageProvider', () => {
  it('sin nada definido, resuelve a memory fuera de producción', () => {
    assert.equal(selectStorageProvider(base), 'memory');
  });

  it('con GCS_BUCKET (y el resto de variables gcs) resuelve a gcs aunque no haya STORAGE_PROVIDER', () => {
    const resolved = selectStorageProvider({
      ...base,
      gcsBucket: 'b',
      gcsProjectId: 'p',
      gcsCredentialsJson: 'creds',
    });
    assert.equal(resolved, 'gcs');
  });

  it('STORAGE_PROVIDER explícito manda sobre la inferencia', () => {
    const resolved = selectStorageProvider({
      ...base,
      storageProvider: 'memory',
      gcsBucket: 'b',
      gcsProjectId: 'p',
      gcsCredentialsJson: 'creds',
    });
    assert.equal(resolved, 'memory');
  });

  it('rechaza un STORAGE_PROVIDER desconocido', () => {
    assert.throws(() => selectStorageProvider({ ...base, storageProvider: 's3' }));
  });

  it('gcs sin GCS_PROJECT_ID/GCS_CREDENTIALS_JSON lanza nombrando las variables faltantes', () => {
    assert.throws(
      () => selectStorageProvider({ ...base, storageProvider: 'gcs', gcsBucket: 'b' }),
      /GCS_PROJECT_ID.*GCS_CREDENTIALS_JSON|GCS_CREDENTIALS_JSON.*GCS_PROJECT_ID/,
    );
  });

  it('memory en producción lanza (los archivos desaparecerían al reiniciar)', () => {
    assert.throws(() => selectStorageProvider({ ...base, nodeEnv: 'production' }));
  });

  it('gcs en producción con todas las variables no lanza', () => {
    assert.doesNotThrow(() =>
      selectStorageProvider({
        ...base,
        nodeEnv: 'production',
        gcsBucket: 'b',
        gcsProjectId: 'p',
        gcsCredentialsJson: 'creds',
      }),
    );
  });
});

describe('parseGcsCredentials', () => {
  function encode(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString('base64');
  }

  it('decodifica client_email/private_key desde un JSON válido en base64', () => {
    const result = parseGcsCredentials(encode({ client_email: 'sa@example.com', private_key: 'clave' }));
    assert.deepEqual(result, { client_email: 'sa@example.com', private_key: 'clave' });
  });

  it('rechaza un base64 que no decodifica a JSON', () => {
    assert.throws(() => parseGcsCredentials('no-es-json-valido'));
  });

  it('rechaza cuando falta client_email o private_key', () => {
    assert.throws(() => parseGcsCredentials(encode({ private_key: 'clave' })));
    assert.throws(() => parseGcsCredentials(encode({ client_email: 'sa@example.com' })));
  });

  it('el mensaje de error nunca incluye el contenido recibido', () => {
    const secreto = 'super-secreto-que-no-debe-aparecer';
    try {
      parseGcsCredentials(Buffer.from(secreto).toString('base64'));
      assert.fail('se esperaba que lanzara');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.equal(message.includes(secreto), false);
    }
  });
});
