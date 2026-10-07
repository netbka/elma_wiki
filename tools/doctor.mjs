import { fileURLToPath } from 'node:url';
import { inspectConfiguration } from '../lib/service-config.mjs';
try {
  const production=process.argv.includes('--production');
  const report=await inspectConfiguration(fileURLToPath(new URL('../',import.meta.url)),{filename:production?'.env.production':'.env',environment:process.env});
  for(const check of report.checks) console.log(`${check.ok?'OK':'ВНИМАНИЕ'} ${check.key}: ${check.message}`);
  console.log(report.ready?'Базовые параметры готовы. HTTPS, proxy и настоящий OAuth проверяются отдельно.':'Исправьте параметры перед внешним запуском.');
  if(!report.ready) process.exitCode=1;
} catch {console.error('Проверка настройки не завершена; значения конфигурации не выводятся.');process.exitCode=1;}
