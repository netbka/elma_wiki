import { mountManagedWorkspace } from '../../web/managed/render.js';
import { solutionComposerFixture, composerNextActionFixture } from '../../web/managed/composer-fixtures.js';

// Same production renderer as /solutions?view=compose; synthetic candidates and a synthetic stand only.
function story(mode) {
  const { model, data, candidates } = solutionComposerFixture(mode);
  const explain = async () => { throw Error('Учебный пример: выберите следующее состояние в меню. Данные не сохраняются.'); };
  let lost = mode === 'lost-response';
  const deliveryClient = {
    createConnection: explain, removeConnection: explain, createBridge: explain, removeBridge: explain, probeConnection: explain,
    load: async () => { if (mode === 'delivery-load-error') throw Error('Учебная ошибка загрузки доставки'); return structuredClone(data); },
    refresh: async () => structuredClone(candidates.approved),
    act: async () => {
      if (lost) { lost = false; throw Object.assign(Error('Ответ не получен. Обновите состояние доставки перед продолжением.'), { requiresRefresh: true }); }
      return explain();
    }
  };
  const root = mountManagedWorkspace(model, { composed: { deliveryClient, change: explain },
    navigate: () => { root.querySelector('[role=status]').textContent = 'Учебная навигация: выберите нужное состояние в меню Storybook.'; } });
  return root;
}
function next(mode) { return mountManagedWorkspace(composerNextActionFixture(mode), { navigate: () => {} }); }
export default { id: 'solution-composer', title: 'Решение/Сборка конфигурации', parameters: { layout: 'fullscreen' } };
export const BuildBlocked = { render: () => story('build-blocked'), parameters: { docs: { description: { story:
  'Нативная сборка недоступна: контракт E1 закреплён, но исполнителя нет (netbka/elma365#60). Кнопка сборки заблокирована, недостающие части названы. Рабочей сборка не изображается.' } } } };
export const List = { render: () => story('list') };
export const AwaitingApproval = { render: () => story('awaiting-approval') };
export const Approved = { render: () => story('approved') };
export const Stale = { render: () => story('stale') };
export const Missing = { render: () => story('missing') };
export const DeliveryPrepared = { render: () => story('delivery-prepared') };
export const PartialOutcome = { render: () => story('partial-outcome'), parameters: { docs: { description: { story:
  'Часть единиц установки применена, часть нет: повтор операции запрещён, допустимо только чтение результата.' } } } };
export const UnknownOutcome = { render: () => story('unknown-outcome') };
export const Verified = { render: () => story('verified') };
export const VerificationFailed = { render: () => story('verification-failed') };
export const Failed = { render: () => story('failed') };
export const LoadError = { render: () => story('load-error') };
export const DeliveryLoadError = { render: () => story('delivery-load-error') };
export const LostResponse = { render: () => story('lost-response') };
export const NextCompare = { render: () => next('compare') };
export const NextResolve = { render: () => next('resolve') };
export const NextUnknownBase = { render: () => next('unknown-base') };
export const NextBuildBlocked = { render: () => next('build-blocked') };
export const NextReviewBuild = { render: () => next('review-build') };
export const NextVerify = { render: () => next('verify') };
