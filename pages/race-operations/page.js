import {css, isServer} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {placeholderView} from '../../components/placeholder-view.js';

@customElement('x-snc-2026-f1-race-operations-page')
export default class RaceOperationsPage extends AIUXElement {
  static styles = css`
    :host {
      display: block;
    }
  `;

  get _content() {
    return {
      icon: 'broadcast-tower',
      title: i18n.getMessage('Race Operations'),
      description: i18n.getMessage('Plan and run the race schedule, sessions and communications between race direction and teams.')
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
