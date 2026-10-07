import { story } from './helpers.js';
export default { title: 'Проектируемые возможности', id: 'target' };
export const Journey = { name: 'Source → изменение → Target → проверка', ...story('source-target') };
export const CheckFailed = { name: 'Ошибка проверки блокирует отправку', ...story('source-target', 'check-failed') };
export const Unverified = { name: 'Отправлено, результат не проверен', ...story('source-target', 'sent') };
export const Mismatch = { name: 'Результат не совпадает', ...story('source-target', 'mismatch') };
