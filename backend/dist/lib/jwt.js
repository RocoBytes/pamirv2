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
