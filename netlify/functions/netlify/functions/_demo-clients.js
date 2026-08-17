// Static stand-in data for demo logins (see DEMO_ACCOUNTS in _data.js), used
// only when the tenant has no live stores in Supabase yet. Mirrors the shape
// computeDashboard returns so the dashboard renders identically either way.

const DEMO_CLIENTS = {
  'SUP-042': {
    staffName: 'Kagiso T.',
    repStoreCount: 4,
    compliance: '94%',
    completedPlanned: '141/150',
    storesCovered: '29/30',
    oosIssues: '2',
    stores: [
      { name: 'Supa Quick Randburg', code: 'SPQ-011', region: 'Jhb North', lastVisit: 'Today', status: 'On track' },
      { name: 'Supa Quick Boksburg', code: 'SPQ-210', region: 'Ekurhuleni', lastVisit: 'Yesterday', status: 'On track' },
      { name: 'Supa Quick Centurion', code: 'SPQ-330', region: 'Pretoria', lastVisit: '3 days ago', status: 'On track' },
      { name: 'Supa Quick Vereeniging', code: 'SPQ-441', region: 'Vaal', lastVisit: '6 days ago', status: 'Due' },
    ],
    leaderboard: [
      { rank: 1, name: 'Kagiso T.', score: '97%' },
      { rank: 2, name: 'Willem P.', score: '93%' },
      { rank: 3, name: 'Tumi R.', score: '90%' },
    ],
  },
};

// Served to a demo check-in (see visits.js) so the rep screen always has a
// checklist, even before the tenant has imported its own questionnaire.
const DEMO_QUESTIONNAIRE = {
  id: 'demo-questionnaire',
  name: 'Standard visit',
  questions: [
    { id: 'q1', type: 'boolean', label: 'Fitment bay signage in place', required: true },
    { id: 'q2', type: 'boolean', label: 'Promotional pricing displayed correctly', required: true },
    { id: 'q3', type: 'photo', label: 'Photo — forecourt display', required: true },
    { id: 'q4', type: 'choice', label: 'Stock availability', options: ['Full', 'Partial', 'Out of stock'] },
    { id: 'q5', type: 'number', label: 'Tyres on display' },
    { id: 'q6', type: 'text', label: 'Manager comment' },
  ],
};

const DEMO_SNAG_QUESTIONNAIRE = {
  id: 'demo-snag',
  name: 'Snag Report',
  questions: [
    { id: 's1', type: 'text', label: 'What is the snag?', required: true },
    { id: 's2', type: 'photo', label: 'Photo of the snag', required: true },
    { id: 's3', type: 'choice', label: 'Severity', options: ['Low', 'Medium', 'High'] },
    { id: 's4', type: 'boolean', label: 'Store manager notified' },
  ],
};

module.exports = { DEMO_CLIENTS, DEMO_QUESTIONNAIRE, DEMO_SNAG_QUESTIONNAIRE };
