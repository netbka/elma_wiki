import { mountManagedWorkspace } from '../../web/managed/render.js';
import { solutionComposerFixture, composerNextActionFixture, buildFlowModes, buildResponseFixtures } from '../../web/managed/composer-fixtures.js';

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
  // Build then freeze, answered by the synthetic route responses of this mode.
  const [built, frozen] = buildFlowModes[mode] || [];
  const answer = key => { const value = buildResponseFixtures[key]; if (value instanceof Error) throw value; return structuredClone(value); };
  const build = async () => answer(built);
  const freeze = async () => { if (frozen) answer(frozen); root.querySelector('[role=status]').textContent = 'Учебная навигация: сборка зафиксирована; откройте состояние «Ожидает решения» в меню Storybook.'; };
  const root = mountManagedWorkspace(model, { composed: { deliveryClient, change: explain, ...(built ? { build, freeze } : {}) },
    navigate: () => { root.querySelector('[role=status]').textContent = 'Учебная навигация: выберите нужное состояние в меню Storybook.'; } });
  return root;
}
function next(mode) { return mountManagedWorkspace(composerNextActionFixture(mode), { navigate: () => {} }); }
export default { id: 'solution-composer', title: 'Решение/Сборка конфигурации', parameters: { layout: 'fullscreen' } };
export const BuildBlocked = { render: () => story('build-blocked'), parameters: { docs: { description: { story:
  'Нативная сборка недоступна: контракт E1 закреплён, но исполнителя нет (netbka/elma365#60). Кнопка сборки заблокирована, недостающие части названы. Рабочей сборка не изображается.' } } } };
export const BuildGates = { render: () => story('build-gates'), parameters: { docs: { description: { story:
  'Условия сборки: каждое условие со своим состоянием и каждой причиной блокировки. Учебный пример: зависимость по кругу, неизвестный вид объекта, платный модуль без подтверждения лицензии и устаревший профиль Target.' } } } };
export const EligibilityLoadError = { render: () => story('eligibility-load-error') };
export const BuildReady = { render: () => story('build-ready'), parameters: { docs: { description: { story:
  'Сборщик доступен, все условия подтверждены. «Собрать конфигурацию» собирает последнюю принятую версию; проверенная сборка ждёт «Зафиксировать сборку», и только зафиксированные байты попадают в список. Ответы сервера учебные.' } } } };
export const BuildNoMerge = { render: () => story('build-no-merge'), parameters: { docs: { description: { story:
  'Последнее изменение принято без сравнения трёх версий: собирать нечего, кнопка заблокирована и объяснено, что сделать.' } } } };
export const BuildRefused = { render: () => story('build-refused') };
export const BuildFailed = { render: () => story('build-failed') };
export const BuildStale = { render: () => story('build-stale') };
export const BuildNotAccepted = { render: () => story('build-not-accepted') };
export const BuildLost = { render: () => story('build-lost') };
export const FreezeStale = { render: () => story('freeze-stale') };
export const List = { render: () => story('list') };
export const AwaitingApproval = { render: () => story('awaiting-approval') };
export const Approved = { render: () => story('approved') };
export const NativePending = { render: () => story('native-pending'), parameters: { docs: { description: { story:
  'Синтетическая модель нативного кандидата без подтверждения установки: происхождение не подменяется учебным, выпуск не разрешён.' } } } };
export const UnknownEvidence = { render: () => story('unknown-evidence') };
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
