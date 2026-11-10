import {css, isServer} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {placeholderView} from '../../components/placeholder-view.js';

@customElement('x-snc-2026-f1-team-operations-page')
export default class TeamOperationsPage extends AIUXElement {
  static styles = css`
    :host {
      display: block;
    }
  `;

  get _content() {
    return {
      icon: 'wrench',
      title: i18n.getMessage('Team Operations'),
      description: i18n.getMessage('Manage garages, crews, equipment and requests for each team in the paddock.')
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
