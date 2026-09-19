#!/usr/bin/env node
"use strict";

const { syncRootReadmes } = require("./lib/userscripts");

try {
  const changed = syncRootReadmes(process.cwd());
  console.log(changed.length > 0
    ? `Updated ${changed.join(", ")}.`
    : "Root README script lists are already current.");
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
