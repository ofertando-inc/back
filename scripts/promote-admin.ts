import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim();

  if (!email) {
    console.error(
      'Usage: npm run promote-admin -- <email>\n' +
        'Example: npm run promote-admin -- admin@example.com',
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (check your .env file)');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(databaseUrl),
  });

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }

    if (user.role === UserRole.ADMIN) {
      console.log(`User ${email} is already ADMIN — nothing to do.`);
      return;
    }

    await prisma.user.update({
      where: { email },
      data: { role: UserRole.ADMIN },
    });

    console.log(`Promoted ${email} to ADMIN.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
