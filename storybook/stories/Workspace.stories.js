import { story } from './helpers.js';
export default { title: 'Система/Рабочая копия', id: 'workspace' };
export const Journey = { name: 'Исследование → изменение → Check → восстановление', ...story('workspace') };
export const Conflict = { name: 'Конфликт вкладок сохраняет локальный текст', ...story('workspace', 'conflict') };
