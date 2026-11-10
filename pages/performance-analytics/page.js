import {css, isServer} from 'lit';
import {customElement} from 'lit/decorators.js';
import {AIUXElement} from '@servicenow/aiux/aiux-components-core';
import {i18n} from '@servicenow/aiux/aiux-services';
import {placeholderView} from '../../components/placeholder-view.js';

@customElement('x-snc-2026-f1-performance-analytics-page')
export default class PerformanceAnalyticsPage extends AIUXElement {
  static styles = css`
    :host {
      display: block;
    }
  `;

  get _content() {
    return {
      icon: 'chart-bar-vertical',
      title: i18n.getMessage('Performance Analytics'),
      description: i18n.getMessage('Analyse lap times, response times and operational performance across sessions.')
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
