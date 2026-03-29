require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'portfolio_intelligence',
  password: 'Anna1018$',
  port: 5432,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Connecting with Prisma + pg adapter...');
  const result = await prisma.$queryRaw`SELECT 1 as test`;
  console.log('Success:', result);
  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});