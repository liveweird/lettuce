// k6 scenario `notifications-bell`: the bell in the Shell header (components/NotificationsButton.tsx), mounted on
// EVERY page for every persona.
//   badge   the unread count the bell polls every 30 s: notifications?page=1&pageSize=1&wasSeen=false
//   drawer  the click: notifications?page=1&pageSize=50&sort=-timestamp, then page 2 while the total says there is one
// (the drawer also polls every 30 s while open; the mutations — seen/unseen/delete — are not part of a load.)
import { defineScenario, qs } from './lib/replay.js';

const def = {
  name: 'notifications-bell',
  personas: ['ceo', 'director', 'lead', 'ic', 'hr', 'admin'],
  screens: {
    badge: {
      endpoints: ['badge'],
      run(s) { s.get(`/api/v1/notifications?${qs({ page: 1, pageSize: 1, wasSeen: false })}`, 'badge'); },
    },
    drawer: {
      endpoints: ['list'],
      run(s) {
        const res = s.get(`/api/v1/notifications?${qs({ page: 1, pageSize: 50, sort: '-timestamp' })}`, 'list');
        if (res !== null && res.json().total > 50) s.get(`/api/v1/notifications?${qs({ page: 2, pageSize: 50, sort: '-timestamp' })}`, 'list');
      },
    },
  },
  personaScreens: {},
};
for (const p of def.personas) def.personaScreens[p] = ['badge', 'drawer'];

const sc = defineScenario(def);
export const options = sc.options;
export const setup = sc.setup;
export default sc.default;
export const handleSummary = sc.handleSummary;
