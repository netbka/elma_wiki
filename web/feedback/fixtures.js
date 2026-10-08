export function bugFixture(mode = 'ready') {
  const config = { open: true, repository: 'example/synthetic', title: 'Синтетический отчёт: кнопка перекрывает текст', text: 'При ширине окна 390 пикселей кнопка закрывает часть строки. Ожидается читаемый текст.' };
  if (['attachments', 'limit'].includes(mode)) {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#172033'; ctx.font = '32px sans-serif'; ctx.fillText('Синтетический снимок окна · 1280 × 720', 40, 70); ctx.strokeRect(40, 110, 1200, 540);
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), character => character.charCodeAt(0));
    config.files = Array.from({ length: mode === 'limit' ? 5 : 1 }, (_, i) => new File([bytes], `synthetic-window-${i + 1}.png`, { type: 'image/png' }));
  }
  if (mode === 'capture-error') config.message = 'Снимок отменён. Можно повторить или приложить файл.';
  if (['published', 'unknown', 'failed', 'unconfigured'].includes(mode)) config.result = {
    id: '00000000-0000-4000-8000-000000000085', status: mode,
    ...(mode === 'published' ? { issue: { number: 85, url: 'https://github.com/example/synthetic/issues/85' } } : {}),
    message: mode === 'unknown' ? 'Ответ GitHub не получен. Вложения сохранены; проверьте результат без повторной отправки.' : mode === 'failed' ? 'GitHub не принял отчёт. Вложения сохранены; можно повторить.' : mode === 'unconfigured' ? 'Отчёт сохранён. Отправка в GitHub ещё не настроена.' : null
  };
  return config;
}
