import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main(): Promise<void> {
  // A single admin account for the ops console (grant admin scopes in your IAM/claims).
  await db.user.upsert({
    where: { phone: '+2348000000000' },
    update: {},
    create: { phone: '+2348000000000', role: 'ADMIN', name: 'Rydafirst Admin' },
  });
  // eslint-disable-next-line no-console
  console.log('Seed complete: admin user ensured.');
}

main().finally(() => db.$disconnect());
