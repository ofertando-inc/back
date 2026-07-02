import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Bootstraps the initial ROOT account (roots create every other account, so
// one must exist first). Idempotent: reuses the email if already present.
//
// Usage: npm run seed:root -- <email> <username> <password>
// Or via env: ROOT_EMAIL, ROOT_USERNAME, ROOT_PASSWORD.

const PASSWORD_SALT_ROUNDS = 12;

async function main(): Promise<void> {
  const email = process.argv[2]?.trim() ?? process.env.ROOT_EMAIL?.trim();
  const username = process.argv[3]?.trim() ?? process.env.ROOT_USERNAME?.trim();
  const password = process.argv[4] ?? process.env.ROOT_PASSWORD;

  if (!email || !username || !password) {
    console.error(
      'Usage: npm run seed:root -- <email> <username> <password>\n' +
        'Or set ROOT_EMAIL, ROOT_USERNAME and ROOT_PASSWORD in the environment.',
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('The root password must be at least 8 characters long.');
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
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.role === UserRole.ROOT) {
        console.log(`User ${email} is already ROOT — nothing to do.`);
        return;
      }
      await prisma.user.update({
        where: { email },
        data: { role: UserRole.ROOT },
      });
      console.log(`Promoted existing user ${email} to ROOT.`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    await prisma.user.create({
      data: { email, username, passwordHash, role: UserRole.ROOT },
    });
    console.log(`Created ROOT account ${email} (${username}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
