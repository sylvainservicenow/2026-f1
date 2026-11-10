import {navLayoutContext} from '@servicenow/aiux/aiux-components-nav';
import {i18n} from '@servicenow/aiux/aiux-services';
import {AppTheme} from './theme.js';

export default {
  appTheme: AppTheme,
  applicationLayout: 'aiux-nav-layout',

  setup(ctx) {
    const items = [
      {
        icon: 'dashboard-dial',
        title: i18n.getMessage('Command Center'),
        action: {type: 'navigate', path: '/command-center'}
      },
      {
        icon: 'triangle-exclamation',
        title: i18n.getMessage('Incident Response'),
        action: {type: 'navigate', path: '/incident-response'}
      },
      {
        icon: 'broadcast-tower',
        title: i18n.getMessage('Race Operations'),
        action: {type: 'navigate', path: '/race-operations'}
      },
      {
        icon: 'flag',
        title: i18n.getMessage('Race Control'),
        action: {type: 'navigate', path: '/race-control'}
      },
      {
        icon: 'activity',
        title: i18n.getMessage('Live Telemetry'),
        action: {type: 'navigate', path: '/live-telemetry'}
      },
      {
        icon: 'ai-sparkle',
        title: i18n.getMessage('AI Race Intelligence'),
        action: {type: 'navigate', path: '/ai-race-intelligence'}
      },
      {
        icon: 'wrench',
        title: i18n.getMessage('Team Operations'),
        action: {type: 'navigate', path: '/team-operations'}
      },
      {
        icon: 'shield-check',
        title: i18n.getMessage('Safety & Compliance'),
        action: {type: 'navigate', path: '/safety-compliance'}
      },
      {
        icon: 'chart-bar-vertical',
        title: i18n.getMessage('Performance Analytics'),
        action: {type: 'navigate', path: '/performance-analytics'}
      },
      {
        icon: 'clipboard-check',
        title: i18n.getMessage('Post-Race Review'),
        action: {type: 'navigate', path: '/post-race-review'}
      }
    ];

    const activeRoute = ctx.app?.routes?.find(r => r.active);
    const itemsWithActive = items.map(item => ({
      ...item,
      ...(item.action?.path === activeRoute?.route && {active: true})
    }));

    const current = navLayoutContext.get();
    navLayoutContext.set({
      ...current,
      appTitle: i18n.getMessage('2026-F1'),
      features: {
        menus: false,
        logo: true,
        userSession: false,
        notifications: false,
        themeToggle: false,
        densityPicker: false,
        unifiedExperience: false,
        profile: true,
        helpPanel: true
      },
      items: itemsWithActive,
      defaultLogoFull: 'servicenow',
      defaultLogoIcon: 'servicenow'
    });
  },

  teardown() {
    navLayoutContext.set({
      items: [],
      defaultLogoFull: null,
      defaultLogoIcon: null
    });
  }
};
