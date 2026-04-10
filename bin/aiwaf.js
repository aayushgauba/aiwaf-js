#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');
const blacklistManager = require('../lib/blacklistManager');
const exemptionStore = require('../lib/exemptionStore');
const geoStore = require('../lib/geoStore');
const requestLogStore = require('../lib/requestLogStore');
const dynamicKeywordStore = require('../lib/dynamicKeywordStore');

function print(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

async function clearBlacklist() {
  const deleted = await blacklistManager.clear();
  print({ ok: true, cleared: deleted });
}

async function clearRequestLogs() {
  const deleted = await requestLogStore.clear();
  print({ ok: true, cleared: deleted });
}

function runTrain() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'train.js')], {
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', code => process.exit(code || 0));
}

async function diagnoseIp(ip) {
  const blocked = await blacklistManager.isBlocked(ip);
  const exempt = await exemptionStore.isIpExempt(ip);
  print({ ip, blocked, exempt });
}

async function main() {
  const [, , cmd, subcmd, ...args] = process.argv;

  if (!cmd || ['help', '--help', '-h'].includes(cmd)) {
    print({
      usage: 'aiwaf <command> [subcommand] [args]',
      commands: [
        'list blacklist|exemptions|geo|request-logs',
        'list dynamic-keywords',
        'list model-info',
        'add ip-exemption <ip> [reason]',
        'add path-exemption <pathPrefix> [reason]',
        'remove ip-exemption <ip>',
        'remove path-exemption <pathPrefix>',
        'geo block <CC> [reason]',
        'geo unblock <CC>',
        'geo summary',
        'clear blacklist|request-logs',
        'clear dynamic-keywords',
        'train',
        'diagnose <ip>'
      ]
    });
    return;
  }

  if (cmd === 'train') return runTrain();

  if (cmd === 'list' && subcmd === 'blacklist') {
    const rows = await blacklistManager.getBlockedIPs();
    return print(rows);
  }

  if (cmd === 'list' && subcmd === 'exemptions') {
    const ips = await exemptionStore.listIps();
    const paths = await exemptionStore.listPaths();
    return print({ ip_exemptions: ips, path_exemptions: paths });
  }

  if (cmd === 'list' && subcmd === 'geo') {
    const rows = await geoStore.listBlockedCountries();
    return print(rows);
  }

  if (cmd === 'list' && subcmd === 'request-logs') {
    const limit = Number(args[0] || 100);
    const rows = await requestLogStore.recent(limit);
    return print(rows);
  }

  if (cmd === 'list' && subcmd === 'dynamic-keywords') {
    const limit = Number(args[0] || 100);
    const rows = await dynamicKeywordStore.list(limit);
    return print(rows);
  }

  if (cmd === 'list' && subcmd === 'model-info') {
    const modelStore = require('../lib/modelStore');
    const model = await modelStore.load(process.env);
    if (!model) return print({ loaded: false });
    return print({ loaded: true, metadata: model.metadata || null });
  }

  if (cmd === 'add' && subcmd === 'ip-exemption') {
    const [ip, ...reasonParts] = args;
    await exemptionStore.addIp(ip, reasonParts.join(' ') || 'manual');
    return print({ ok: true, ip });
  }

  if (cmd === 'add' && subcmd === 'path-exemption') {
    const [pathPrefix, ...reasonParts] = args;
    await exemptionStore.addPath(pathPrefix, reasonParts.join(' ') || 'manual');
    return print({ ok: true, pathPrefix });
  }

  if (cmd === 'remove' && subcmd === 'ip-exemption') {
    const [ip] = args;
    const deleted = await exemptionStore.removeIp(ip);
    return print({ ok: true, deleted });
  }

  if (cmd === 'remove' && subcmd === 'path-exemption') {
    const [pathPrefix] = args;
    const deleted = await exemptionStore.removePath(pathPrefix);
    return print({ ok: true, deleted });
  }

  if (cmd === 'geo' && subcmd === 'block') {
    const [countryCode, ...reasonParts] = args;
    await geoStore.addBlockedCountry(countryCode, reasonParts.join(' ') || 'manual');
    return print({ ok: true, countryCode });
  }

  if (cmd === 'geo' && subcmd === 'unblock') {
    const [countryCode] = args;
    const deleted = await geoStore.removeBlockedCountry(countryCode);
    return print({ ok: true, deleted });
  }

  if (cmd === 'geo' && subcmd === 'summary') {
    const rows = await requestLogStore.geoSummary(50);
    return print(rows);
  }

  if (cmd === 'clear' && subcmd === 'blacklist') {
    return clearBlacklist();
  }

  if (cmd === 'clear' && subcmd === 'request-logs') {
    return clearRequestLogs();
  }

  if (cmd === 'clear' && subcmd === 'dynamic-keywords') {
    const cleared = await dynamicKeywordStore.clear();
    return print({ ok: true, cleared });
  }

  if (cmd === 'diagnose') {
    const [ip] = [subcmd, ...args];
    return diagnoseIp(ip);
  }

  print({ error: 'unknown command', command: [cmd, subcmd, ...args].join(' ') });
  process.exitCode = 1;
}

main()
  .catch(err => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(1);
  })
  .finally(async () => {
    // no-op
  });
