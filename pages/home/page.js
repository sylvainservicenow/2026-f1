import {html, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import './components/aiux-feature-card.js';

@customElement('x-snc-2026-f1-home-page')
export default class HomePage extends AIUXElement {
  // Layout, color, and spacing all come from DaisyUI components + Tailwind
  // utilities below; `static styles` is reserved for `:host` only.
  static styles = css`
    :host {
      display: block;
    }
  `;

  render() {
    return html`
      <div class="mx-auto max-w-6xl">
        <section
          class="mb-8 grid grid-cols-1 gap-4 border-b border-neutral-300 pb-6 lg:grid-cols-3"
        >
          <div class="aiux-card bg-surface-primary lg:col-span-2">
            <div class="aiux-card-body">
              <p
                class="font-mono text-xs uppercase tracking-wide text-primary-900"
              >
                ${i18n.getMessage('AIUX starter application')}
              </p>
              <h1 class="text-3xl font-bold text-text-primary">
                ${i18n.getMessage('Build ServiceNow experiences faster.')}
              </h1>
              <p class="text-sm leading-relaxed text-text-secondary">
                ${i18n.getMessage(
                  "We've scaffolded a basic two-page application to accelerate your development."
                )}
              </p>
              <div class="aiux-card-actions mt-2">
                <a class="aiux-btn aiux-btn-primary" href="./incidents">
                  ${i18n.getMessage('View incident list')}
                </a>
                <a class="aiux-btn aiux-btn-outline" href="./home">
                  ${i18n.getMessage('Start from home')}
                </a>
              </div>
            </div>
          </div>

          <aside class="aiux-card bg-surface-primary">
            <div class="aiux-card-body justify-between">
              <div>
                <p
                  class="font-mono text-xs uppercase tracking-wide text-primary-900"
                >
                  ${i18n.getMessage('Sample widget')}
                </p>
                <h2 class="aiux-card-title text-text-primary">
                  ${i18n.getMessage('Hello world widget')}
                </h2>
                <p class="text-sm leading-relaxed text-text-secondary">
                  ${i18n.getMessage(
                    'A minimal AIUX widget with a server script, included as a starting point for custom widgets.'
                  )}
                </p>
              </div>
              <code
                class="aiux-badge aiux-badge-ghost mt-4 w-fit font-mono text-xs"
              >
                widgets/aiux-hello-world
              </code>
            </div>
          </aside>
        </section>

        <ul class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <li>
            <aiux-feature-card
              index="01"
              title=${i18n.getMessage('Documentation')}
              description=${i18n.getMessage(
                'Explore the AIUX docs for components, APIs, and guides to build your ServiceNow experience.'
              )}
              href=""
              linkLabel=${i18n.getMessage('Learn')}
            ></aiux-feature-card>
          </li>
          <li>
            <aiux-feature-card
              index="02"
              title=${i18n.getMessage('AI-ready out of the box')}
              description=${i18n.getMessage(
                'Start building with AIUX agent skills and linting rules already configured — your AI coding agent understands your project conventions from the start.'
              )}
              linkLabel=${i18n.getMessage('Build')}
            ></aiux-feature-card>
          </li>
          <li>
            <aiux-feature-card
              index="03"
              title=${i18n.getMessage('Deploy to ServiceNow')}
              description=${i18n.getMessage(
                "When you're ready, push your experience to a ServiceNow instance with a single command using the built-in deploy pipeline."
              )}
              linkLabel=${i18n.getMessage('Deploy')}
            ></aiux-feature-card>
          </li>
        </ul>
      </div>
    `;
  }
}
