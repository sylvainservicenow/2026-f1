import {html} from 'lit';
import {icon} from '@servicenow/aiux/aiux-directive-icon';
import {i18n} from '@servicenow/aiux/aiux-services';

/**
 * Shared, presentation-only "coming soon" template for navigation entries with no functionality yet.
 * Each placeholder page extends AIUXElement itself (required for page discovery) and renders this.
 * @param {{icon: string, title: string, description: string}} c
 */
export function placeholderView(c) {
  return html`
    <section class="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center" aria-labelledby="ph-title">
      <div class="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-base-200 text-text-secondary">
        ${icon({name: c.icon, size: 'xl'})}
      </div>
      <span class="aiux-badge aiux-badge-soft aiux-badge-info mb-3">${i18n.getMessage('Coming soon')}</span>
      <h1 id="ph-title" class="mb-2 break-words text-2xl font-semibold text-text-primary">${c.title}</h1>
      <p class="max-w-md text-sm leading-relaxed text-text-secondary">${c.description}</p>
    </section>
  `;
}
