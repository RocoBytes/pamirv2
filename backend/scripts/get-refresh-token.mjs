/**
 * Script de UN SOLO USO para obtener el refresh token de OAuth 2.0.
 *
 * Uso:
 *   node scripts/get-refresh-token.mjs
 *
 * Requiere que las variables de entorno estén seteadas o que las edites aquí:
 *   GOOGLE_CLIENT_ID=...
 *   GOOGLE_CLIENT_SECRET=...
 *
 * Al correr, abrirá una URL en consola. Visítala, autoriza el acceso con
 * madridnawrathsusana@gmail.com, y pega el code que aparece en la pantalla.
 */

import { createInterface } from 'node:readline'
import { google } from 'googleapis'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Error: Define GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el entorno o edita este script.',
  )
  process.exit(1)
}

const REDIRECT_URI = 'http://localhost'

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // Fuerza a Google a devolver siempre el refresh_token
  scope: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/gmail.send',
  ],
})

console.log('\n──────────────────────────────────────────────────────')
console.log('1. Abre esta URL en tu navegador:')
console.log('\n' + authUrl + '\n')
console.log('2. Inicia sesión con seguridad.acp.cl@gmail.com')
console.log('3. Acepta los permisos')
console.log('4. El navegador intentará abrir http://localhost/?code=XXX...')
console.log('   (dará error de conexión — eso es normal)')
console.log('5. Copia el valor del parámetro "code" de la URL de la barra del navegador')
console.log('──────────────────────────────────────────────────────\n')

const rl = createInterface({ input: process.stdin, output: process.stdout })
rl.question('Pega el código (solo el valor de "code=...") aquí y presiona Enter: ', async (code) => {
  rl.close()
  try {
    const { tokens } = await oauth2Client.getToken(code.trim())
    console.log('\n✅ ¡Éxito! Agrega esto a tu backend/.env:\n')
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log('\n(El access_token expira, el refresh_token es permanente)\n')
  } catch (err) {
    console.error('Error al obtener tokens:', err.message)
    process.exit(1)
  }
})
