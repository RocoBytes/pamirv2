import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = '7d';
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET env var is required');
}
export function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
}
export function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}
// El valor crudo, para quien necesite derivar OTRA clave a partir de él (ver
// lib/codigos-qr.ts, que deriva una clave de cifrado AES por HKDF — nunca
// reutiliza JWT_SECRET directamente como clave de cifrado). Una función en
// vez de exportar la constante: así el tipo devuelto es `string`, no
// `string | undefined` (el guard de arriba ya garantizó que existe).
export function requireJwtSecret() {
    return JWT_SECRET;
}
