import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { getTenantStore } from './tenant-context.js';
import { scopeArgs } from './scope-args.js';

// Aislamiento multi-club aplicado UNA SOLA VEZ, acá, como middleware de query
// del cliente — no en cada uno de los ~133 sitios de llamada `prisma.<modelo>.
// <operacion>` repartidos por controllers/services/scripts. `$allOperations`
// nunca referencia al cliente base (`client`) para evitar recursión: solo lee
// el contexto vigente (AsyncLocalStorage) y delega la decisión a la función
// pura scopeArgs. `$transaction` (interactivo o en arreglo) hereda esta misma
// extensión, así que `tx.<modelo>.<operacion>` dentro de una transacción queda
// igual de aislado.
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  const adapter = new PrismaPg(connectionString);
  const client = new PrismaClient({ adapter });

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scopedArgs = scopeArgs({
            model,
            operation,
            args: args as Record<string, unknown> | undefined,
            store: getTenantStore(),
          });
          return query(scopedArgs as typeof args);
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

// Singleton pattern: previene saturar el límite de 5 conexiones de Neon free tier
// durante los hot-reloads de ts-node-dev (globalThis persiste entre recargas del módulo).
const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
