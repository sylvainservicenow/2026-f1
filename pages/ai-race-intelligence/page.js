import {css, isServer} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {placeholderView} from '../../components/placeholder-view.js';

@customElement('x-snc-2026-f1-ai-race-intelligence-page')
export default class AiRaceIntelligencePage extends AIUXElement {
  static styles = css`
    :host {
      display: block;
    }
  `;

  get _content() {
    return {
      icon: 'ai-sparkle',
      title: i18n.getMessage('AI Race Intelligence'),
      description: i18n.getMessage('AI-assisted insights and recommendations that help race control decide faster.')
    };
  }

  firstUpdated() {
    if (isServer) return;
    document.title = this._content.title;
  }

  render() {
    return placeholderView(this._content);
  }
}
