import { z } from 'zod';

// Reglas de validación compartidas por el controlador de auth y el CLI de
// creación de usuarios (backend/src/scripts/create-user.ts), para que ambos
// exijan exactamente los mismos requisitos sobre email, contraseña y nombre.
export const SALT_ROUNDS = 12;

export const emailField = z.string().trim().email('Formato de email inválido').max(254);
export const passwordField = z.string()
  .min(8, 'Mínimo 8 caracteres')
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, 'La contraseña es demasiado larga');
export const nameField = z.string().trim().min(1, 'El nombre es requerido').max(100, 'Máximo 100 caracteres');
