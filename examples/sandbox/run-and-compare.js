#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');
const { runDefaultComparison } = require('./attack-suite');

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd });
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function run() {
  console.log('Running full test suite for all frameworks (normal + attacks)...');
  await runDefaultComparison();
  
  console.log('\n\nGenerating comparison report...');
  const sandboxDir = __dirname;
  await runCommand('node', ['compare-results-modes.js'], sandboxDir);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
