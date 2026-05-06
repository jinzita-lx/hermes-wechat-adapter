import { config, validateConfig } from './config.js';
import { ensureFileDirs } from './files.js';
import { checkHermes } from './hermes.js';
import { providerReadinessSummary } from './ingress.js';

const missing = validateConfig();
if (missing.length) {
  console.error(`Missing required config: ${missing.join(', ')}`);
  process.exit(1);
}

await ensureFileDirs();
console.log('Adapter config looks complete.');
console.log(`Listen: ${config.host}:${config.port}`);
console.log(`Hermes API: ${config.hermesApiBaseUrl}`);
console.log(`Bridge mode: ${config.bridgeMode}`);
console.log(`Default provider: ${config.defaultProvider}`);
console.log('Providers:', JSON.stringify(providerReadinessSummary(config)));

try {
  const health = await checkHermes();
  console.log('Hermes health:', health);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
