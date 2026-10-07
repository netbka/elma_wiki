import nodemailer from 'nodemailer';
import { normalizeEmail } from './auth.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function loginEmail({ key, expires, baseUrl }) {
  const url = new URL('/login', baseUrl).href;
  const deadline = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(expires) + ' (UTC)';
  const subject = 'Ваш ключ для входа в E365 Wiki';
  const text = `E365 Wiki\n\nВаш одноразовый ключ для входа:\n${key}\n\nОткройте ${url} и введите адрес почты и ключ.\nКлюч действует 72 часа, до ${deadline}, и используется один раз. После входа сессия действует 72 часа.\nПовторная отправка отменяет предыдущий ключ. Никому не сообщайте ключ.\nЕсли вы не запрашивали вход, просто проигнорируйте это письмо.`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 12px;background:#f3f5fa;color:#19243b;font-family:Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">Ваш одноразовый ключ для входа. Действует 72 часа.</div>
<table role="presentation" style="width:100%;max-width:560px;margin:auto;border-collapse:collapse"><tr><td style="padding:24px 32px;background:#19243b;border-radius:16px 16px 0 0;color:#fff;font-size:22px;font-weight:bold">E365 <span style="color:#b6c5e2;font-weight:normal">/ Wiki</span></td></tr>
<tr><td style="padding:32px;background:#fff;border-radius:0 0 16px 16px">
<p style="margin:0 0 12px;color:#516ac8;font-size:12px;letter-spacing:2px">БЕЗОПАСНЫЙ ВХОД</p>
<h1 style="font-size:26px;margin:0 0 16px">Ваш ключ для входа</h1>
<p style="font-size:16px;line-height:1.6">Введите этот ключ на странице входа в E365 Wiki, чтобы открыть свои проекты.</p>
<div style="margin:24px 0;padding:20px 12px;background:#eef2ff;border:1px solid #d6defa;border-radius:12px;text-align:center;font-family:monospace;font-size:22px;font-weight:bold;letter-spacing:1px">${escape(key)}</div>
<p style="font-size:14px;line-height:1.6"><strong>Действует 72 часа</strong> — до ${escape(deadline)}.<br>Ключ одноразовый. После входа сессия действует 72 часа.</p>
<p style="margin:24px 0"><a href="${escape(url)}" style="display:inline-block;padding:14px 24px;background:#3858d6;border-radius:8px;color:#fff;text-decoration:none;font-weight:bold">Перейти ко входу</a></p>
<p style="font-size:13px;line-height:1.6;color:#657089">Повторная отправка отменяет предыдущий ключ. Никому не сообщайте его. Если вы не запрашивали вход, просто проигнорируйте письмо.</p>
</td></tr><tr><td style="padding:24px;text-align:center;font-size:12px;color:#657089">Карта конфигурации для разработчиков<br>Это автоматическое письмо. Отвечать на него не нужно.</td></tr></table></body></html>`;
  return { subject, text, html };
}

export function emailSettings(env = process.env) {
  const from = env.EMAIL_FROM || '', password = env.EMAIL_CRED_KEY || '';
  const host = env.SMTP_HOST || 'smtp.mail.ru', port = Number(env.SMTP_PORT || 465), secure = (env.SMTP_SSL_TLS || 'true') === 'true';
  if (from) normalizeEmail(from);
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !['true', 'false'].includes(env.SMTP_SSL_TLS || 'true')) throw Error('Некорректные настройки SMTP');
  return { from, password, host, port, secure, configured: !!(from && password) };
}

export function createEmailSender(env = process.env) {
  const settings = emailSettings(env);
  if (!settings.configured) return undefined;
  const transport = nodemailer.createTransport({ host: settings.host, port: settings.port, secure: settings.secure, requireTLS: !settings.secure,
    auth: { user: settings.from, pass: settings.password }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true });
  return async message => {
    const result = await transport.sendMail({ from: { name: 'E365 Wiki', address: settings.from }, to: message.email, ...loginEmail(message) });
    if (!result.accepted?.length || result.rejected?.length) throw Error('Письмо не принято почтовым сервером');
  };
}
