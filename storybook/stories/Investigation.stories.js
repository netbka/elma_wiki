import { story } from './helpers.js';
export default { title: 'Исследование', id: 'investigation' };
export const Journey = { name: 'От потребности до критериев приёмки', ...story('investigation') };
export const Unknown = { name: 'Неподтверждённое правило', ...story('investigation', 'unknown') };
