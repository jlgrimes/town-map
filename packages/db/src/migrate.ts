import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./index.js";

const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

async function migrate() {
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(`${migrationsDirectory}/${file}`, "utf8");
    await getPool().query(sql);
    console.info(`Applied ${file}`);
  }
  await closePool();
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
