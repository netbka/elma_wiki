import { flowById } from '../../web/flows/catalog.js';
import { mountFlow, mountCatalog } from '../../web/flows/render.js';
import { mountReview } from '../../web/flows/review.js';
const options = () => ({ reviewMount: typeof __ELMA_REVIEW_ENABLED__ !== 'undefined' && __ELMA_REVIEW_ENABLED__ ? mountReview : undefined });
export const story = (flowId, initial) => ({ render: () => mountFlow({ flow: flowById(flowId), initial, ...options() }) });
export const catalog = () => mountCatalog(options());
