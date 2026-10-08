import { mountBugReporter } from '../../web/feedback/render.js';
import { bugFixture } from '../../web/feedback/fixtures.js';
function story(mode) {
  return mountBugReporter(bugFixture(mode), {
    context: () => ({ route: '/solutions', viewport: { width: 1280, height: 720, devicePixelRatio: 1 } }),
    capture: async () => { throw Error('Учебный пример: живой захват отключён. Вложения синтетические.'); },
    submit: async input => ({ id: input.id, status: 'published', issue: { number: 85, url: 'https://github.com/example/synthetic/issues/85' } }),
    retry: async id => ({ id, status: 'unknown', message: 'Синтетический неизвестный результат. Отправка не повторяется.' })
  });
}
export default { id: 'bug-reports', title: 'Решение/Сообщить об ошибке', parameters: { layout: 'fullscreen' } };
export const Ready = { render: () => story('ready') };
export const Attachments = { render: () => story('attachments') };
export const Limit = { render: () => story('limit') };
export const CaptureError = { render: () => story('capture-error') };
export const Published = { render: () => story('published') };
export const Unknown = { render: () => story('unknown') };
export const Failed = { render: () => story('failed') };
export const Unconfigured = { render: () => story('unconfigured') };
