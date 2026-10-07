import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import crypto from 'node:crypto';
import { emailSettings } from './email.mjs';

export function configuration({ baseUrl, emailFrom='', emailCredKey='', container=false }) {
  let base;
  try { base=new URL(baseUrl); } catch { throw Error('Укажите полный HTTP/HTTPS-адрес сервиса'); }
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw Error('Адрес должен содержать только схему, имя и необязательный порт');
  const local=['127.0.0.1','localhost'].includes(base.hostname);
  if (!['http:','https:'].includes(base.protocol) || ((!local || container) && base.protocol !== 'https:')) throw Error('Для внешнего сервиса или контейнера требуется HTTPS');
  if ([emailFrom,emailCredKey].some(value=>/[\r\n]/.test(value))) throw Error('Параметры почты должны быть однострочными');
  const mail=emailSettings({EMAIL_FROM:emailFrom,EMAIL_CRED_KEY:emailCredKey});
  if (Boolean(emailFrom)!==Boolean(emailCredKey)) throw Error('Укажите оба параметра почты или оставьте оба пустыми');
  if ((!local || container) && !mail.configured) throw Error('Для внешнего сервиса настройте отправку писем');
  const port=local && base.protocol==='http:' ? Number(base.port || 80) : 43171;
  return {PORT:String(port),HOST:container || !local ? '0.0.0.0':'127.0.0.1',PUBLIC_BASE_URL:base.origin,EMAIL_FROM:emailFrom,EMAIL_CRED_KEY:emailCredKey,SMTP_HOST:'smtp.mail.ru',SMTP_PORT:'465',SMTP_SSL_TLS:'true',IMAP_URL:'imap.mail.ru',IMAP_PORT:'993',IMAP_SSL_TLS:'true',DISABLE_LOCAL_LOGIN:'1'};
}
export async function saveConfiguration(root,filename,values) {
  if (!['.env','.env.production'].includes(filename)) throw Error('Разрешён только файл настройки в корне сервиса');
  await fs.writeFile(path.join(root,filename),Object.entries(values).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{flag:'wx',mode:0o600});
}
export async function inspectConfiguration(root,{filename='.env',environment={}}={}) {
  if (!['.env','.env.production'].includes(filename)) throw Error('Недопустимый файл настройки');
  let saved={},exists=false;
  try { saved=parseEnv(await fs.readFile(path.join(root,filename),'utf8'));exists=true; } catch(e) { if(e.code!=='ENOENT') throw Error('Файл настройки недоступен'); }
  const env={...saved,...environment},checks=[],production=filename==='.env.production';
  const add=(key,ok,message)=>checks.push({key,ok,message});
  add('node',Number(process.versions.node.split('.')[0])>=22,'Node.js 22+');
  add('file',exists,exists?'Файл настройки существует':'Файл настройки ещё не создан');
  let credentials=false;
  try { credentials=emailSettings(env).configured;add('smtp',true,'Настройки SMTP корректны'); }
  catch { add('smtp',false,'Некорректные настройки SMTP или адрес отправителя'); }
  add('email-pair',Boolean(env.EMAIL_FROM)===Boolean(env.EMAIL_CRED_KEY),'Адрес отправителя и пароль приложения задаются парой');
  add('email',credentials,credentials?'Почтовые параметры заданы; доставка ещё требует проверки':'Отправка писем не настроена');
  try {
    const base=new URL(env.PUBLIC_BASE_URL || 'http://127.0.0.1:43171'),local=['127.0.0.1','localhost'].includes(base.hostname);
    if(production) add('production-https',base.protocol==='https:','Production требует HTTPS');
    add('origin',['http:','https:'].includes(base.protocol) && (local || base.protocol==='https:') && !base.username && !base.password && base.pathname==='/' && !base.search && !base.hash,'HTTP только на loopback, внешний адрес — HTTPS без пути');
    add('local-login',(!production && local) || env.DISABLE_LOCAL_LOGIN==='1','Локальный вход отключён для внешнего адреса');
    add('public-email',(!production && local) || credentials,'Для внешнего адреса параметры почты обязательны');
    add('host',!env.HOST || env.HOST==='127.0.0.1' || (base.protocol==='https:' && env.DISABLE_LOCAL_LOGIN==='1'),'Внешний bind требует HTTPS и отключённого локального входа');
  } catch { add('origin',false,'Некорректный адрес сервиса'); }
  const port=Number(env.PORT || 43171);add('port',Number.isInteger(port) && port>=1 && port<=65535,'Порт в диапазоне 1–65535');
  const directory=path.join(root,'.local');
  try {
    await fs.mkdir(directory,{recursive:true,mode:0o700});const probe=path.join(directory,'.doctor-'+crypto.randomUUID());
    await fs.writeFile(probe,'probe',{flag:'wx',mode:0o600});await fs.unlink(probe);add('storage',true,'Приватное хранилище доступно для записи');
  } catch { add('storage',false,'Приватное хранилище недоступно для записи'); }
  return {checks,ready:checks.filter(c=>!['file','email'].includes(c.key)).every(c=>c.ok),githubConfigured:false,emailConfigured:credentials};
}
