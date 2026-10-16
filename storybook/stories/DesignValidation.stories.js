import { story } from './helpers.js';
// UX-09 design validation materials. Synthetic stories only; answers stay in the local review panel and are never #59/#41 evidence.
export default { title: 'Проверка понятности UX-09', id: 'design-validation' };
export const Journey = { name: 'Подготовка и весь порядок проверки', ...story('design-validation') };
export const FiveSecond = { name: 'Пять секунд: о решении', ...story('design-validation', 'five-second-about') };
export const FiveSecondReview = { name: 'Пять секунд: что изменилось', ...story('design-validation', 'five-second-review-summary') };
export const Labels = { name: 'Названия: рассмотрение версии', ...story('design-validation', 'labels-review') };
export const CardSort = { name: 'Сортировка карточек по вкладкам', ...story('design-validation', 'card-sort') };
export const Decide = { name: 'Итог: оставить или заменить', ...story('design-validation', 'decide') };
