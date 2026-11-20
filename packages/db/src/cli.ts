import { createPgDb, createPgliteDb } from "./driver";
import { migrate } from "./migrate";
import { seed } from "./seed";

async function main() {
  const cmd = process.argv[2];
  const db = process.env.DATABASE_URL ? await createPgDb(process.env.DATABASE_URL) : await createPgliteDb(process.env.PGLITE_DIR ?? "../../.data/pglite");
  try {
    if (cmd === "migrate" || cmd === "seed") {
      const ran = await migrate(db);
      console.log(ran.length ? `Applied migrations:\n  ${ran.join("\n  ")}` : "Database is up to date.");
    }
    if (cmd === "seed") {
      const pw = process.env.SEED_PASSWORD;
      if (!pw) throw new Error("Set SEED_PASSWORD (min 10 chars) to seed demo users");
      const r = await seed(db, { password: pw });
      console.log(r.created ? `Seeded demo organisation ${r.organizationId}. Users: owner@ / admin@ / analyst@ / viewer@tuck.example` : "Demo data already present.");
    }
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
