#!/usr/bin/env node

const { runDefaultComparison } = require('./attack-suite');

async function run() {
  await runDefaultComparison();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
