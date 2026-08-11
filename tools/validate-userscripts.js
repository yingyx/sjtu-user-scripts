#!/usr/bin/env node
"use strict";

const { validateRepository } = require("./lib/userscripts");

const root = process.cwd();
const result = validateRepository(root);
if (result.errors.length > 0) {
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  console.error(`\nValidation failed with ${result.errors.length} error(s).`);
  process.exit(1);
}
for (const script of result.scripts) console.log(`Validated ${script.id} v${script.version}`);
console.log(`Validation passed for ${result.scripts.length} userscript(s).`);
