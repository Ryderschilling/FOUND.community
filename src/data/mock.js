// ─────────────────────────────────────────
// Mock data — replace with Supabase API calls
// ─────────────────────────────────────────

export const CURRENT_USER = {
  id: 'user-ryder',
  name: 'Ryder Schilling',
  initials: 'RS',
  avatarColor: ['#5A7A4A', '#3D6B5E'],
  lifeStage: { id: 'young-pro', label: 'Young Professional', icon: 'briefcase-outline', iconColor: '#4A6FA5' },
  location: '30A, Florida',
  distance: null,
  church: { id: 'bayside', name: 'Bayside Church', distance: '0.8 mi' },
  interests: [
    { id: 'coffee',   label: 'Coffee',      icon: 'cafe-outline',           iconColor: '#A8793A' },
    { id: 'bible',    label: 'Bible Study',  icon: 'book-outline',           iconColor: '#5A7A4A' },
    { id: 'sports',   label: 'Sports',       icon: 'football-outline',       iconColor: '#4A8A6A' },
    { id: 'service',  label: 'Service',      icon: 'heart-circle-outline',   iconColor: '#C0795A' },
    { id: 'outdoors', label: 'Outdoors',     icon: 'leaf-outline',           iconColor: '#5A8A6A' },
  ],
  matchCount: 14,
  connectionCount: 3,
  groupCount: 2,
};

export const LIFE_STAGES = [
  { id: 'student',         label: 'Student',                      icon: 'school-outline',          iconColor: '#4A6FA5' },
  { id: 'single',          label: 'Single',                       icon: 'person-outline',          iconColor: '#4A6FA5' },
  { id: 'married-no-kids', label: 'Married — No Kids',            icon: 'heart-outline',           iconColor: '#C0795A' },
  { id: 'married-babies',  label: 'Married w/ Babies (0–2)',      icon: 'happy-outline',           iconColor: '#7A5AA8' },
  { id: 'married-young',   label: 'Married w/ Young Kids (2–12)', icon: 'people-outline',          iconColor: '#5A7A4A' },
  { id: 'married-teens',   label: 'Married w/ Teens (14–18)',     icon: 'bicycle-outline',         iconColor: '#A8793A' },
  { id: 'married-mixed',   label: 'Married w/ Mixed Ages',        icon: 'people-circle-outline',   iconColor: '#4A8A6A' },
  { id: 'empty-nester',    label: 'Empty Nester',                 icon: 'home-outline',            iconColor: '#5A8A6A' },
  { id: 'grandparent',     label: 'Grandparent',                  icon: 'sunny-outline',           iconColor: '#C0795A' },
];

// Life stages where school-type question is relevant
export const HAS_KIDS_STAGES = ['married-babies', 'married-young', 'married-teens', 'married-mixed'];

export const ACTIVITIES = [
  { id: 'surfing',     label: 'Surfing',              icon: 'water-outline',            iconColor: '#4A6FA5' },
  { id: 'skating',     label: 'Skating',              icon: 'body-outline',             iconColor: '#7A5AA8' },
  { id: 'beach',       label: 'Beach / Lake / River', icon: 'sunny-outline',            iconColor: '#A8793A' },
  { id: 'music',       label: 'Playing Music',        icon: 'musical-notes-outline',    iconColor: '#7A5AA8' },
  { id: 'sports',      label: 'Sports',               icon: 'football-outline',         iconColor: '#4A8A6A' },
  { id: 'camping',     label: 'Camping',              icon: 'bonfire-outline',          iconColor: '#A8793A' },
  { id: 'hiking',      label: 'Hiking',               icon: 'leaf-outline',             iconColor: '#5A8A6A' },
  { id: 'fitness',     label: 'Working Out',          icon: 'barbell-outline',          iconColor: '#C0795A' },
  { id: 'playgrounds', label: 'Playgrounds / MDO',    icon: 'happy-outline',            iconColor: '#4A6FA5' },
  { id: 'hunting',     label: 'Hunting / Fishing',    icon: 'fish-outline',             iconColor: '#5A7A4A' },
  { id: 'dining',      label: 'Dinner Out',           icon: 'restaurant-outline',       iconColor: '#C0795A' },
  { id: 'concerts',    label: 'Concerts',             icon: 'musical-note-outline',     iconColor: '#7A5AA8' },
  { id: 'shopping',    label: 'Mall / Shopping',      icon: 'bag-outline',              iconColor: '#A8793A' },
  { id: 'coffee',           label: 'Coffee',              icon: 'cafe-outline',         iconColor: '#A8793A' },
  { id: 'golf',             label: 'Golf',                icon: 'golf-outline',         iconColor: '#5A7A4A' },
  { id: 'tennis-pickleball',label: 'Tennis / Pickleball', icon: 'tennisball-outline',   iconColor: '#4A6FA5' },
];

// Kept for backward compat with existing match cards that reference interests
export const INTERESTS = ACTIVITIES;

export const FAMILY_VALUES = [
  { id: 'no-alcohol',     label: 'No Alcohol',             icon: 'wine-outline',                iconColor: '#C0795A' },
  { id: 'no-cussing',     label: 'No Cussing',             icon: 'chatbubble-outline',           iconColor: '#A8793A' },
  { id: 'no-smoking',     label: 'No Smoking',             icon: 'ban-outline',                  iconColor: '#4A6FA5' },
  { id: 'healthy-eating', label: 'Eating Healthy',         icon: 'nutrition-outline',            iconColor: '#5A7A4A' },
  { id: 'family-worship', label: 'Family Worship',         icon: 'book-outline',                 iconColor: '#5A7A4A' },
  { id: 'limit-phones',   label: 'Limit Phones for Kids',  icon: 'phone-portrait-outline',       iconColor: '#4A6FA5' },
];

export const DENOMINATIONS = [
  { id: 'non-denom',        label: 'Non-Denominational',      icon: 'infinite-outline',             iconColor: '#1A1A1A' },
  { id: 'baptist',          label: 'Baptist',                  icon: 'book-outline',                 iconColor: '#1A1A1A' },
  { id: 'methodist',        label: 'Methodist',                icon: 'heart-outline',                iconColor: '#1A1A1A' },
  { id: 'presbyterian',     label: 'Presbyterian',             icon: 'library-outline',              iconColor: '#1A1A1A' },
  { id: 'lutheran',         label: 'Lutheran',                 icon: 'leaf-outline',                 iconColor: '#1A1A1A' },
  { id: 'catholic',         label: 'Catholic',                 icon: 'business-outline',             iconColor: '#1A1A1A' },
  { id: 'anglican',         label: 'Anglican / Episcopal',     icon: 'navigate-outline',             iconColor: '#1A1A1A' },
  { id: 'pentecostal',      label: 'Pentecostal / Charismatic',icon: 'flame-outline',               iconColor: '#1A1A1A' },
  { id: 'assemblies',       label: 'Assemblies of God',        icon: 'people-outline',               iconColor: '#1A1A1A' },
  { id: 'church-of-christ', label: 'Church of Christ',         icon: 'home-outline',                 iconColor: '#1A1A1A' },
  { id: 'reformed',         label: 'Reformed / Calvinist',     icon: 'shield-outline',               iconColor: '#1A1A1A' },
  { id: 'evangelical',      label: 'Evangelical Free',         icon: 'star-outline',                 iconColor: '#1A1A1A' },
  { id: 'other',            label: 'Other',                    icon: 'ellipsis-horizontal-outline',  iconColor: '#1A1A1A' },
];

export const SCHOOL_TYPES = [
  { id: 'public',     label: 'Public School',      icon: 'school-outline',    iconColor: '#4A6FA5' },
  { id: 'private',    label: 'Private School',     icon: 'business-outline',  iconColor: '#A8793A' },
  { id: 'christian',  label: 'Christian School',   icon: 'book-outline',      iconColor: '#5A7A4A' },
  { id: 'classical',  label: 'Classical Christian',icon: 'library-outline',   iconColor: '#7A5AA8' },
  { id: 'homeschool', label: 'Homeschool',          icon: 'home-outline',      iconColor: '#C0795A' },
];

export const LOVE_LANGUAGES = [
  { id: 'acts-of-service', label: 'Acts of Service',       icon: 'hammer-outline',                 iconColor: '#5A7A4A' },
  { id: 'receiving-gifts', label: 'Receiving Gifts',       icon: 'gift-outline',                   iconColor: '#A8793A' },
  { id: 'quality-time',    label: 'Quality Time',          icon: 'time-outline',                   iconColor: '#4A6FA5' },
  { id: 'words',           label: 'Words of Affirmation',  icon: 'chatbubble-ellipses-outline',    iconColor: '#7A5AA8' },
  { id: 'physical-touch',  label: 'Physical Touch',        icon: 'hand-left-outline',              iconColor: '#C0795A' },
];

export const COMMUNITY_GOALS = [
  { id: 'couple-friends',  label: 'Couple Friends',         icon: 'people-outline',           iconColor: '#C0795A' },
  { id: 'family-community',label: 'Family Community',       icon: 'home-outline',             iconColor: '#5A7A4A' },
  { id: 'mentorship',      label: 'Mentorship',             icon: 'trending-up-outline',      iconColor: '#4A6FA5' },
  { id: 'bible-study',     label: 'Bible Study',            icon: 'book-outline',             iconColor: '#5A7A4A' },
  { id: 'activity-partners',label: 'Activity Partners',     icon: 'bicycle-outline',          iconColor: '#4A8A6A' },
  { id: 'prayer',          label: 'Prayer Community',       icon: 'heart-outline',            iconColor: '#C0795A' },
  { id: 'accountability',  label: 'Accountability',         icon: 'shield-outline',           iconColor: '#7A5AA8' },
  { id: 'church-connect',  label: 'Church Connections',     icon: 'business-outline',         iconColor: '#A8793A' },
  { id: 'mom-friends',     label: 'Mom Friends',            icon: 'happy-outline',            iconColor: '#4A6FA5' },
  { id: 'networking',      label: 'Business Networking',    icon: 'briefcase-outline',        iconColor: '#A8793A' },
  { id: 'young-adult',     label: 'Young Adult Community',  icon: 'people-circle-outline',    iconColor: '#5A8A6A' },
];

export const NEARBY_CHURCHES = [
  { id: 'bayside',    name: 'Bayside Church',            distance: '0.8 mi', members: 340 },
  { id: 'seacoast',   name: 'Seacoast Community Church', distance: '1.4 mi', members: 890 },
  { id: 'calvary',    name: 'Calvary Chapel',            distance: '2.1 mi', members: 210 },
  { id: 'crosspoint', name: 'CrossPoint Church',         distance: '3.2 mi', members: 560 },
];

export const MATCHES = [
  {
    id: 'match-1',
    name: 'Jake Mitchell',
    initials: 'JM',
    avatarColor: ['#4A6FA5', '#2D4E8A'],
    matchScore: 94,
    lifeStage: 'Young Professional',
    distance: '0.6 mi',
    church: 'Bayside Church',
    interests: [
      { id: 'coffee',  label: 'Coffee',      icon: 'cafe-outline',         iconColor: '#A8793A' },
      { id: 'sports',  label: 'Sports',       icon: 'football-outline',     iconColor: '#4A8A6A' },
      { id: 'bible',   label: 'Bible Study',  icon: 'book-outline',         iconColor: '#5A7A4A' },
      { id: 'service', label: 'Service',      icon: 'heart-circle-outline', iconColor: '#C0795A' },
    ],
    connected: false,
  },
  {
    id: 'match-2',
    name: 'Andrew & Claire',
    initials: 'AC',
    avatarColor: ['#5A8A6A', '#3D6B55'],
    matchScore: 89,
    lifeStage: 'Newlywed',
    distance: '1.2 mi',
    church: 'Seacoast Community Church',
    interests: [
      { id: 'outdoors', label: 'Outdoors',    icon: 'leaf-outline',       iconColor: '#5A8A6A' },
      { id: 'hosting',  label: 'Hosting',     icon: 'restaurant-outline', iconColor: '#C0795A' },
      { id: 'bible',    label: 'Bible Study', icon: 'book-outline',       iconColor: '#5A7A4A' },
    ],
    connected: false,
  },
  {
    id: 'match-3',
    name: 'Sarah R.',
    initials: 'SR',
    avatarColor: ['#C0795A', '#A0593A'],
    matchScore: 85,
    lifeStage: 'College Student',
    distance: '0.3 mi',
    church: 'Calvary Chapel',
    interests: [
      { id: 'worship', label: 'Worship',  icon: 'musical-notes-outline', iconColor: '#7A5AA8' },
      { id: 'coffee',  label: 'Coffee',   icon: 'cafe-outline',          iconColor: '#A8793A' },
      { id: 'service', label: 'Outreach', icon: 'heart-circle-outline',  iconColor: '#C0795A' },
    ],
    connected: false,
  },
  {
    id: 'match-4',
    name: 'Marcus & Tanya',
    initials: 'MT',
    avatarColor: ['#7A5AA8', '#5A3A88'],
    matchScore: 81,
    lifeStage: 'Parent with Young Kids',
    distance: '1.8 mi',
    church: 'Bayside Church',
    interests: [
      { id: 'parenting', label: 'Parenting',   icon: 'happy-outline',       iconColor: '#4A6FA5' },
      { id: 'hosting',   label: 'Hosting',     icon: 'restaurant-outline',  iconColor: '#C0795A' },
      { id: 'bible',     label: 'Bible Study', icon: 'book-outline',        iconColor: '#5A7A4A' },
    ],
    connected: false,
  },
  {
    id: 'match-5',
    name: 'Tyler Brooks',
    initials: 'TB',
    avatarColor: ['#A8793A', '#886020'],
    matchScore: 78,
    lifeStage: 'Young Professional',
    distance: '2.4 mi',
    church: 'CrossPoint Church',
    interests: [
      { id: 'sports',   label: 'Sports',   icon: 'football-outline',     iconColor: '#4A8A6A' },
      { id: 'outdoors', label: 'Outdoors', icon: 'leaf-outline',         iconColor: '#5A8A6A' },
      { id: 'service',  label: 'Service',  icon: 'heart-circle-outline', iconColor: '#C0795A' },
    ],
    connected: false,
  },
];

export const GROUPS = {
  joined: [
    {
      id: 'group-1',
      name: 'Tuesday Night Bible Study',
      description: 'Weekly at Bayside Church — All welcome',
      icon: 'book-outline',
      iconColor: '#5A7A4A',
      iconBg: '#EDF3EA',
      members: 14,
      schedule: 'Tuesdays 7pm',
      joined: true,
    },
    {
      id: 'group-2',
      name: "30A Men's Soccer",
      description: 'Saturday morning pickup games',
      icon: 'football-outline',
      iconColor: '#5A8A6A',
      iconBg: '#EAF3EE',
      members: 22,
      schedule: 'Saturdays 8am',
      joined: true,
    },
  ],
  suggested: [
    {
      id: 'group-3',
      name: 'Young Professionals Coffee',
      description: 'Bi-weekly meetup, rotating spots',
      icon: 'cafe-outline',
      iconColor: '#A8793A',
      iconBg: '#F5F0E8',
      members: 18,
      schedule: 'Thursdays 7:30am',
      joined: false,
    },
    {
      id: 'group-4',
      name: 'Outdoor Adventures',
      description: 'Hikes, kayaking, beach bonfires',
      icon: 'leaf-outline',
      iconColor: '#C0795A',
      iconBg: '#F5EDE8',
      members: 31,
      schedule: 'Monthly',
      joined: false,
    },
    {
      id: 'group-5',
      name: 'Serve 30A',
      description: 'Community service & outreach projects',
      icon: 'heart-circle-outline',
      iconColor: '#4A6FA5',
      iconBg: '#EAF0F8',
      members: 45,
      schedule: 'Bi-monthly',
      joined: false,
    },
    {
      id: 'group-6',
      name: 'Young Families Network',
      description: 'Playdates, parent support, couples nights',
      icon: 'people-outline',
      iconColor: '#7A5AA8',
      iconBg: '#F0ECF8',
      members: 27,
      schedule: 'Flexible',
      joined: false,
    },
  ],
};

export const MESSAGES = [
  {
    id: 'msg-1',
    name: 'Jake Mitchell',
    initials: 'JM',
    avatarColor: ['#4A6FA5', '#2D4E8A'],
    preview: 'Hey! Want to grab coffee Thursday morning?',
    time: '2m ago',
    unread: 1,
    online: true,
    isGroup: false,
  },
  {
    id: 'msg-2',
    name: 'Andrew & Claire',
    initials: 'AC',
    avatarColor: ['#5A8A6A', '#3D6B55'],
    preview: "We're hosting dinner Friday if you're free!",
    time: '1h ago',
    unread: 2,
    online: false,
    isGroup: false,
  },
  {
    id: 'msg-3',
    name: 'Tuesday Night Bible Study',
    initials: 'BS',
    groupIcon: 'book-outline',
    groupIconColor: '#5A7A4A',
    avatarColor: null,
    preview: 'Ryan: See everyone at 7 tonight!',
    time: '3h ago',
    unread: 0,
    online: false,
    isGroup: true,
  },
  {
    id: 'msg-4',
    name: 'Sarah R.',
    initials: 'SR',
    avatarColor: ['#C0795A', '#A0593A'],
    preview: 'Connected with you! Excited to meet.',
    time: 'Yesterday',
    unread: 0,
    online: false,
    isGroup: false,
  },
  {
    id: 'msg-5',
    name: "30A Men's Soccer",
    initials: 'SC',
    groupIcon: 'football-outline',
    groupIconColor: '#5A8A6A',
    avatarColor: null,
    preview: 'Game is ON for Saturday! Bring water.',
    time: '2d ago',
    unread: 0,
    online: false,
    isGroup: true,
  },
];
