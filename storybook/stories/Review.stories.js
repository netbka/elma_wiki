import { story } from './helpers.js';
export default { title: 'Рецензия', id: 'review' };
export const Journey = { name: 'Комментарии → отклонение → повторная проверка', ...story('feature-review') };
export const Rejected = { name: 'Отклонённый сценарий', ...story('feature-review', 'rejected') };
