import {css, isServer} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {placeholderView} from '../../components/placeholder-view.js';

@customElement('x-snc-2026-f1-incident-response-page')
export default class IncidentResponsePage extends AIUXElement {
  static styles = css`
    :host {
      display: block;
    }
  `;

  get _content() {
    return {
      icon: 'triangle-exclamation',
      title: i18n.getMessage('Incident Response'),
      description: i18n.getMessage('Coordinate marshals, medical and recovery teams across track and paddock incidents, with tasks and approvals.')
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
