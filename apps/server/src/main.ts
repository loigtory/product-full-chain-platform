import { createApplication } from './composition/create-application.js';

const { database, experienceConfig, server } = createApplication(process.env);
const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? '3001');

if (
  host !== '127.0.0.1' ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65_535
) {
  throw new Error('LOCAL_SERVER_CONFIG_INVALID');
}

const shutdown = async () => {
  await server.close();
  await database?.destroy();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await server.listen({ host, port });
  console.log(
    `PFC_SERVER_READY http://${host}:${port} mode=${experienceConfig.enabled ? 'experience' : 'standard'} schema=${experienceConfig.schemaName}`,
  );
} catch (error) {
  server.log.error(error);
  await database?.destroy();
  process.exitCode = 1;
}
