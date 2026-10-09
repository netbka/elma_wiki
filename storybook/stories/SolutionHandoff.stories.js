import { mountManagedWorkspace } from '../../web/managed/render.js';
import { solutionHandoffFixture } from '../../web/managed/handoff-fixtures.js';
import { solutionDeliveryFixture } from '../../web/managed/handoff-delivery-fixtures.js';

function story(mode) {
  const explain = async () => { throw Object.assign(Error('Учебный пример: выберите следующее состояние в меню. Данные не сохраняются.'), { requiresRefresh: mode === 'lost-response' }); };
  return mountManagedWorkspace(solutionHandoffFixture(mode), { handoff: { create: explain, change: explain, preview: async () => ({ text: '{"synthetic":true}', truncated: false }), download: explain, open: explain } });
}
export default { id: 'solution-handoff', title: 'Решение/Передача принятой версии', parameters: { layout: 'fullscreen' } };
export const Create = { render: () => story('create') };
export const Blocked = { render: () => story('blocked') };
export const Review = { render: () => story('review') };
export const Ready = { render: () => story('ready') };
export const Candidate = { render: () => story('candidate') };
export const Prepared = { render: () => story('prepared') };
export const Stale = { render: () => story('stale') };
export const Loading = { render: () => story('loading') };
export const LoadError = { render: () => story('load-error') };
export const LostResponse = { render: () => story('lost-response') };

function deliveryStory(state) {
  const { model, data, connection } = solutionDeliveryFixture(state);
  const explain = async () => { throw Error('Синтетическое состояние: выберите другую story.'); };
  let lost = state === 'lost-response';
  const client = {
    createConnection: explain, removeConnection: explain, createBridge: explain, removeBridge: explain,
    load: async () => { if (state === 'load-error') throw Error('Учебная ошибка загрузки доставки'); return structuredClone(data); },
    refresh: async () => model.handoff,
    probeConnection: async () => { connection.probe.ok = true; },
    act: async (id, input) => {
      if (lost) { lost = false; throw Object.assign(Error('Ответ не получен. Обновите состояние доставки перед продолжением.'), { requiresRefresh: true }); }
      if (state !== 'journey') return explain();
      if (input.action === 'prepare') {
        data.attempts = solutionDeliveryFixture('prepared').data.attempts;
      } else {
        const attempt = data.attempts.at(-1);
        attempt.state = { confirm: 'deployed-unverified', verify: 'verified', cancel: 'cancelled' }[input.action];
        attempt.verificationCurrent = input.action === 'verify';
        if (input.action === 'verify') attempt.evidence.comparison = { policy: 'exact-solution-inventory-v1', match: true, compared: 3, missing: [], different: [], unexpected: [] };
        attempt.history.push({ at: '2026-10-09T12:01:00Z', state: attempt.state, note: 'Учебный переход' });
      }
      return model.handoff;
    }
  };
  return mountManagedWorkspace(model, { handoff: { change: explain, preview: async () => ({ text: '{"synthetic":true}' }), download: explain, open: explain, deliveryClient: client } });
}
export const DeliveryUnavailable = { render: () => deliveryStory('unavailable') };
export const DeliveryReady = { render: () => deliveryStory('ready') };
export const DeliveryConnectionUnavailable = { render: () => deliveryStory('connection-unavailable') };
export const DeliveryPrepared = { render: () => deliveryStory('prepared') };
export const DeliveryDeploying = { render: () => deliveryStory('deploying') };
export const DeliveryUnverified = { render: () => deliveryStory('deployed-unverified') };
export const DeliveryVerified = { render: () => deliveryStory('verified') };
export const DeliveryMismatch = { render: () => deliveryStory('verification-failed') };
export const DeliveryVerificationError = { render: () => deliveryStory('verification-error') };
export const DeliveryUnknown = { render: () => deliveryStory('unknown-outcome') };
export const DeliveryFailed = { render: () => deliveryStory('failed') };
export const DeliveryBlocked = { render: () => deliveryStory('blocked') };
export const DeliveryCancelled = { render: () => deliveryStory('cancelled') };
export const DeliveryStale = { render: () => deliveryStory('stale') };
export const DeliveryLoadError = { render: () => deliveryStory('load-error') };
export const DeliveryLostResponse = { render: () => deliveryStory('lost-response') };
export const DeliveryJourney = { render: () => deliveryStory('journey') };
