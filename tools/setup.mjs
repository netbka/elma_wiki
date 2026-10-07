import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { configuration,saveConfiguration } from '../lib/service-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),container=process.argv.includes('--production'),filename=container?'.env.production':'.env';
async function hiddenSecret(label) {
  stdout.write(label+' (ввод скрыт): ');
  const previous=stdin.isRaw;stdin.setRawMode(true);stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=()=>{stdin.off('data',receive);stdin.setRawMode(previous || false);stdin.pause();stdout.write('\n');};
    const receive=chunk=>{
      for(const char of chunk.toString('utf8')) {
        if(char==='\u0003') {finish();reject(Error('Настройка отменена'));return;}
        if(char==='\r' || char==='\n') {finish();resolve(value);return;}
        if(char==='\u007f' || char==='\b') value=value.slice(0,-1);
        else if(!/[\x00-\x1f\x7f]/.test(char)) value+=char;
      }
    };
    stdin.on('data',receive);
  });
}
try {
  if(!stdin.isTTY || !stdout.isTTY) throw Error('Запустите настройку в интерактивном терминале; секреты не передаются аргументами');
  try {await fs.access(new URL('../'+filename,import.meta.url));throw Error('Файл настройки уже существует. Отредактируйте его локально; автоматической перезаписи нет.');} catch(e) {if(e.code!=='ENOENT') throw e;}
  const rl=readline.createInterface({input:stdin,output:stdout});let baseUrl,emailFrom='',vkApiBase='',vkDomain='',vkBotName='',provider;
  try {
    baseUrl=(await rl.question('Адрес сервиса'+(container?' HTTPS':' [http://127.0.0.1:43171]')+': ')).trim() || (!container?'http://127.0.0.1:43171':'');
    provider=(await rl.question('Способ входа: vk / email [vk]: ')).trim() || 'vk';
    if (!['vk','email'].includes(provider)) throw Error('Выберите vk или email');
    if(provider==='vk') {
      console.log('Используйте настройки существующего бота входа SvoiBot. Второй poller не запускается.');
      vkApiBase=(await rl.question('VK_API_BASE: ')).trim();
      vkDomain=(await rl.question('PORTAL_EMAIL_DOMAIN — домен логинов VK Teams: ')).trim();
      vkBotName=(await rl.question('VK_BOT_AUTH_NAME — имя бота: ')).trim();
    } else {
      console.log('Создайте пароль приложения в настройках почты Mail.ru. Секрет остаётся в приватном файле вне Git.');
      emailFrom=(await rl.question('EMAIL_FROM — адрес отправителя (пусто — настроить позже): ')).trim();
    }
  } finally {rl.close();}
  const emailCredKey=emailFrom?await hiddenSecret('EMAIL_CRED_KEY — пароль приложения'):'';
  const vkBotToken=provider==='vk'?await hiddenSecret('VK_BOT_AUTH_TOKEN — токен бота SvoiBot'):'';
  await saveConfiguration(root,filename,configuration({baseUrl,emailFrom,emailCredKey,vkBotToken,vkApiBase,vkDomain,vkBotName,container}));
  console.log('Настройка сохранена. Выполните npm run doctor'+(container?' -- --production':'')+'.');
  console.log(container?'Запуск: docker compose --env-file .env.production up -d --build':'Перезапустите npm start; /login открывает настроенный способ входа.');
} catch(e) {console.error(e.code==='EEXIST'?'Файл настройки уже существует':e instanceof TypeError?'Некорректный адрес':e.code?'Не удалось сохранить настройку':e.message);process.exitCode=1;}
