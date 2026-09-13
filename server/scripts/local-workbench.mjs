import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { targetFromArgs } = require('../src/local/ops-config');
const { fault } = require('../src/local/profile');
try {
  const [command, ...args] = process.argv.slice(2);
  const idAt = args.indexOf('--backup-id');
  let id;
  if (idAt >= 0) {
    if (command !== 'restore-check' || idAt !== args.length - 2)
      throw fault('LOCAL_ARGUMENTS_INVALID');
    id = args.splice(idAt, 2)[1];
  }
  const target = targetFromArgs(args);
  let result;
  if (command === 'preflight')
    result = await require('../src/local/preflight').preflight(target);
  else if (command === 'initialize')
    result = await require('../src/local/initialize').initialize(target);
  else if (command === 'backup')
    result = await require('../src/local/backup').backup(target);
  else if (command === 'restore-check')
    result = await require('../src/local/restore-check').restoreCheck(
      target,
      id,
    );
  else if (['status', 'stop'].includes(command))
    result = await require('../src/local/lifecycle')[command](target);
  else if (command === 'start') {
    const lifecycle = require('../src/local/lifecycle'),
      running = await lifecycle.start(target);
    console.log(JSON.stringify(running.info));
    process.once('SIGINT', () => {
      void lifecycle.stop(target);
    });
    process.once('SIGTERM', () => {
      void lifecycle.stop(target);
    });
    await running.exit;
    result = { status: 'STOPPED' };
  } else throw fault('LOCAL_COMMAND_INVALID', 400);
  console.log(JSON.stringify(result));
  if (result.status === 'BLOCKED') process.exitCode = 1;
} catch (e) {
  console.error(
    JSON.stringify({
      status: 'BLOCKED',
      code: /^[A-Z_0-9]+$/.test(e.code || '')
        ? e.code
        : 'LOCAL_OPERATION_FAILED',
    }),
  );
  process.exitCode = 1;
}
