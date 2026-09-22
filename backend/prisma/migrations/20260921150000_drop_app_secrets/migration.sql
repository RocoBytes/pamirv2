-- Bridge fase 6: los archivos pasan a Google Cloud Storage y Google Drive
-- queda eliminado. AppSecret solo existía para el refresh token de Google
-- (google-credentials.ts, ya borrado) y no tiene ningún otro uso — se elimina
-- por completo. Ninguna columna de archivo (*_file_url) cambia de
-- nullability: ya eran opcionales, para sostener las filas legadas de Drive.

-- DropTable
DROP TABLE "app_secrets";
