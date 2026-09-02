import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

for (const name of ["events.schema.json", "resume.schema.json", "active.schema.json"]) {
  const file = path.join(root, "schemas", name);
  const schema = JSON.parse(fs.readFileSync(file, "utf8"));
  ajv.compile(schema);
}

process.stdout.write(JSON.stringify({ waymark: 1, kind: "schema-check", ok: true }) + "\n");
