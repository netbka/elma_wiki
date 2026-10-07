import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { configuration,saveConfiguration } from '../lib/service-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),container=process.argv.includes('--production'),filename=container?'.env.production':'.env';

async function hiddenSecret() {
  stdout.write('Client Secret (ввод скрыт): ');
  const previous=stdin.isRaw;stdin.setRawMode(true);stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=()=>{stdin.off('data',receive);stdin.setRawMode(previous || false);stdin.pause();stdout.write('\n');};
    const receive=chunk=>{
      for(const char of chunk.toString('utf8')) {
        if(char==='\u0003') {finish();reject(Error('Настройка отменена'));return;}
        if(char==='\r' || char==='\n') {finish();resolve(value);return;}
        if(char==='\u007f' || char==='\b') value=value.slice(0,-1);
        else if(/^[A-Za-z0-9._-]$/.test(char)) value+=char;
      }
    };
    stdin.on('data',receive);
  });
}
try {
  if(!stdin.isTTY || !stdout.isTTY) throw Error('Запустите настройку в интерактивном терминале; секреты не передаются аргументами');
  try {await fs.access(new URL('../'+filename,import.meta.url));throw Error('Файл настройки уже существует. Отредактируйте его локально; автоматической перезаписи нет.');} catch(e) {if(e.code!=='ENOENT') throw e;}
  const rl=readline.createInterface({input:stdin,output:stdout});
  let baseUrl,clientId;
  try {
    baseUrl=(await rl.question('Адрес сервиса'+(container?' HTTPS':' [http://127.0.0.1:43171]')+': ')).trim() || (!container?'http://127.0.0.1:43171':'');
    const base=new URL(baseUrl);
    if(base.username || base.password || base.pathname!=='/' || base.search || base.hash) throw Error('Укажите только HTTP/HTTPS origin');
    console.log('Создайте OAuth App: https://github.com/settings/applications/new');
    console.log('Application name: E365 Wiki');
    console.log('Homepage URL: '+base.origin);
    console.log('Authorization callback URL: '+base.origin+'/auth/github/callback');
    console.log('Секрет хранится только в локальном файле настройки, исключённом из Git.');
    clientId=(await rl.question('Client ID (пусто — локальный режим): ')).trim();
  } finally {rl.close();}
  const clientSecret=clientId?await hiddenSecret():'';
  const values=configuration({baseUrl,clientId,clientSecret,container});
  await saveConfiguration(root,filename,values);
  console.log('Настройка сохранена. Выполните npm run doctor'+(container?' -- --production':'')+'.');
  console.log(container?'Запуск: docker compose --env-file .env.production up -d --build':'Перезапустите npm start; /auth/github запускает вход.');
} catch(e) {console.error(e.code==='EEXIST'?'Файл настройки уже существует':e instanceof TypeError?'Некорректный адрес':e.code?'Не удалось сохранить настройку':e.message);process.exitCode=1;}
