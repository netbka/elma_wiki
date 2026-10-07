import { story } from './helpers.js';
export default { title: 'Сценарии ELMA', id: 'elma' };
export const Approval = { name: 'Согласование без повторной задачи', ...story('approval') };
export const Rework = { name: 'Доработка требует нового согласования', ...story('approval', 'rework') };
export const Correspondence = { name: 'Тематика исходящего во входящем', ...story('correspondence') };
export const Cleared = { name: 'Очистка устаревшего значения', ...story('correspondence', 'cleared') };
