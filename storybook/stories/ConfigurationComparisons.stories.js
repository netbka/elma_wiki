import { mountSourceComparisons, mountInstalledComparison } from '../../web/managed/comparisons.js';
import { comparisonFixture, comparisonRedrawFixture } from '../../web/managed/comparison-fixtures.js';
import { mountDelivery } from '../../web/releases/delivery.js';
export default { id: 'configuration-comparisons', title: 'Решение/Сравнение версий', parameters: { layout: 'fullscreen' } };
function comparisonStory(mode) {
  const fixture = comparisonFixture(mode), root = document.createElement('div'); root.className = 'managed-content';
  root.append(mountSourceComparisons({ history: fixture.sourceHistory }), mountInstalledComparison(fixture)); return root;
}
export const Compared = { render: () => comparisonStory('compared') };
export const FirstCapture = { render: () => comparisonStory('first-capture') };
export const SourceAmbiguous = { render: () => comparisonStory('source-ambiguous') };
export const UnknownBase = { render: () => comparisonStory('unknown-base') };
export const Drifted = { render: () => comparisonStory('drifted') };
export const UnresolvedOutcome = { render: () => comparisonStory('unresolved-outcome') };
export const Reconciled = { render: () => comparisonStory('reconciled') };
export const Stale = { render: () => comparisonStory('stale') };
export const ObservationFailed = { render: () => comparisonStory('observation-failed') };
export const LoadError = { render: () => comparisonStory('load-error') };
export const ResponseLost = { render: () => comparisonStory('response-lost') };
export const VerifiedAfterComparison = { render: () => comparisonStory('verified-after-comparison') };
export const PanelRedraw = { render: () => mountDelivery(comparisonRedrawFixture()) };
