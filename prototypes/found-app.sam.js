// Sam's single-file React Native prototype — received 2026-05-12
// Self-contained demo: welcome → signup → onboarding → main app (matches, groups, messages, profile)

import React, { useMemo, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  StatusBar,
} from 'react-native';

const COLORS = {
  bg: '#F8F6F3',
  card: '#FFFFFF',
  ink: '#111111',
  muted: '#74706A',
  line: '#E8E1D8',
  sand: '#EFE9E1',
  olive: '#7A846A',
  charcoal: '#2E2E2E',
};

const SAMPLE_USERS = [
  {
    id: '1',
    name: 'Jake & Hannah',
    city: 'Pensacola, FL',
    church: 'Local Church',
    stage: 'Married with young kids',
    interests: ['Beach Days', 'Bible Study', 'Coffee Shops', 'Hospitality'],
    lookingFor: ['Family Community', 'Couple Friends', 'Prayer Community'],
    bio: 'We love hosting dinners, beach days, and growing deeper in our faith with other families.',
  },
  {
    id: '2',
    name: 'Megan Roberts',
    city: 'Gulf Breeze, FL',
    church: 'Looking for a church',
    stage: 'Single',
    interests: ['Coffee Shops', 'Women\u2019s Group', 'Serving', 'Fitness'],
    lookingFor: ['Church Connections', 'Prayer Community', 'Activity Partners'],
    bio: 'New to the area and hoping to meet genuine Christian friends who want to do life together.',
  },
  {
    id: '3',
    name: 'Chris & Lauren',
    city: 'Pensacola, FL',
    church: 'Community Church',
    stage: 'Married with babies',
    interests: ['Playgrounds', 'Dinner', 'Beach Days', 'Bible Study'],
    lookingFor: ['Family Community', 'Couple Friends', 'Mentorship'],
    bio: 'Young parents looking for friends in the same season of life.',
  },
];

const GROUPS = [
  { id: 'g1', name: 'Young Families of Pensacola', members: 42, detail: 'Park days, dinners, and family discipleship.' },
  { id: 'g2', name: 'Surf & Scripture', members: 18, detail: 'Morning surf, prayer, and encouragement.' },
  { id: 'g3', name: 'Young Married Couples', members: 31, detail: 'Monthly dinners and Bible-centered community.' },
  { id: 'g4', name: 'New to Town', members: 64, detail: 'For Christians looking to build roots in a new city.' },
];

const QUESTION_FLOW = [
  {
    key: 'stage',
    title: 'What life stage are you in?',
    multi: false,
    options: ['Single', 'Married', 'Married with babies', 'Married with young kids', 'Married with teenagers', 'Empty Nesters'],
  },
  {
    key: 'interests',
    title: 'What activities do you enjoy most?',
    multi: true,
    options: ['Beach Days', 'Surfing', 'Bible Study', 'Coffee Shops', 'Fishing', 'Hiking', 'Serving', 'Fitness', 'Playgrounds', 'Dinner'],
  },
  {
    key: 'lookingFor',
    title: 'What are you hoping to find?',
    multi: true,
    options: ['Couple Friends', 'Family Community', 'Mentorship', 'Prayer Community', 'Activity Partners', 'Church Connections', 'Mom Friends', 'Men\u2019s Group'],
  },
  {
    key: 'personality',
    title: 'How would you describe yourself?',
    multi: false,
    options: ['Outgoing', 'Somewhere in the middle', 'Pretty shy until I know someone'],
  },
];

export default function App() {
  const [screen, setScreen] = useState('welcome');
  const [tab, setTab] = useState('Home');
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({ name: '', city: '', state: '', from: '', church: '' });
  const [answers, setAnswers] = useState({});
  const [selectedUser, setSelectedUser] = useState(null);
  const [connected, setConnected] = useState([]);

  const matches = useMemo(() => {
    return SAMPLE_USERS.map((user) => {
      const sharedInterests = user.interests.filter((item) => answers.interests?.includes(item));
      const sharedGoals = user.lookingFor.filter((item) => answers.lookingFor?.includes(item));
      const score = sharedInterests.length + sharedGoals.length + (answers.stage && user.stage.includes(answers.stage) ? 1 : 0);
      return { ...user, score, sharedInterests, sharedGoals };
    }).sort((a, b) => b.score - a.score);
  }, [answers]);

  const startApp = () => setScreen('signup');

  const toggleAnswer = (question, option) => {
    setAnswers((current) => {
      if (!question.multi) return { ...current, [question.key]: option };
      const existing = current[question.key] || [];
      return existing.includes(option)
        ? { ...current, [question.key]: existing.filter((item) => item !== option) }
        : { ...current, [question.key]: [...existing, option] };
    });
  };

  const finishQuestion = () => {
    if (step < QUESTION_FLOW.length - 1) setStep(step + 1);
    else {
      setScreen('app');
      setTab('Matches');
    }
  };

  if (screen === 'welcome') {
    return (
      <Shell>
        <View style={styles.hero}>
          <Text style={styles.logo}>FOUND</Text>
          <Text style={styles.kicker}>Find Community.</Text>
          <Text style={styles.heroTitle}>Real Christian community starts here.</Text>
          <Text style={styles.body}>Meet like-minded Christians nearby who share your faith, life stage, interests, and desire to go deeper.</Text>
        </View>
        <PrimaryButton label="Get Started" onPress={startApp} />
        <Text style={styles.smallCenter}>We all need people to run with.</Text>
      </Shell>
    );
  }

  if (screen === 'signup') {
    return (
      <Shell>
        <View>
          <Text style={styles.eyebrow}>Create Profile</Text>
          <Text style={styles.title}>Tell us the basics.</Text>
          <Input placeholder="Your name" value={profile.name} onChangeText={(name) => setProfile({ ...profile, name })} />
          <Input placeholder="City" value={profile.city} onChangeText={(city) => setProfile({ ...profile, city })} />
          <Input placeholder="State" value={profile.state} onChangeText={(state) => setProfile({ ...profile, state })} />
          <Input placeholder="Where are you from?" value={profile.from} onChangeText={(from) => setProfile({ ...profile, from })} />
          <Input placeholder="Church name, optional" value={profile.church} onChangeText={(church) => setProfile({ ...profile, church })} />
        </View>
        <PrimaryButton label="Continue" onPress={() => setScreen('questions')} />
      </Shell>
    );
  }

  if (screen === 'questions') {
    const question = QUESTION_FLOW[step];
    const currentValue = answers[question.key];
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.questionScreen}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.questionScrollContent}>
            <Text style={styles.eyebrow}>Question {step + 1} of {QUESTION_FLOW.length}</Text>
            <Text style={styles.title}>{question.title}</Text>
            <View style={styles.optionsWrap}>
              {question.options.map((option) => {
                const selected = question.multi ? currentValue?.includes(option) : currentValue === option;
                return (
                  <Pressable key={option} style={[styles.option, selected && styles.optionSelected]} onPress={() => toggleAnswer(question, option)}>
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          <View style={styles.stickyButtonWrap}>
            <PrimaryButton label={step === QUESTION_FLOW.length - 1 ? 'Find My Community' : 'Continue'} onPress={finishQuestion} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (selectedUser) {
    return (
      <Shell showBack onBack={() => setSelectedUser(null)}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.avatarLarge}><Text style={styles.avatarText}>{selectedUser.name[0]}</Text></View>
          <Text style={styles.title}>{selectedUser.name}</Text>
          <Text style={styles.muted}>{selectedUser.city} \u2022 {selectedUser.church}</Text>
          <Text style={styles.body}>{selectedUser.bio}</Text>
          <Text style={styles.sectionTitle}>Life Stage</Text>
          <Chip label={selectedUser.stage} />
          <Text style={styles.sectionTitle}>Shared Interests</Text>
          <ChipRow items={selectedUser.sharedInterests.length ? selectedUser.sharedInterests : selectedUser.interests} />
          <Text style={styles.sectionTitle}>Looking For</Text>
          <ChipRow items={selectedUser.lookingFor} />
        </ScrollView>
        <PrimaryButton label={connected.includes(selectedUser.id) ? 'Connection Sent' : 'Invite to Connect'} onPress={() => setConnected([...new Set([...connected, selectedUser.id])])} />
      </Shell>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.appHeader}>
        <Text style={styles.appLogo}>FOUND</Text>
        <Text style={styles.headerSub}>Real. Christian. Community.</Text>
      </View>
      <View style={styles.appBody}>{renderTab()}</View>
      <BottomNav tab={tab} setTab={setTab} />
    </SafeAreaView>
  );

  function renderTab() {
    if (tab === 'Home') {
      return (
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Welcome{profile.name ? `, ${profile.name.split(' ')[0]}` : ''}.</Text>
          <Text style={styles.body}>Here are people, groups, and conversations that may help you find your people.</Text>
          <FeatureCard title="People you may run with" body="Your closest matches are ready." onPress={() => setTab('Matches')} />
          <FeatureCard title="Suggested groups" body="Find community around your life stage and interests." onPress={() => setTab('Groups')} />
          <FeatureCard title="Start a conversation" body="Use simple prompts to break the ice." onPress={() => setTab('Messages')} />
        </ScrollView>
      );
    }
    if (tab === 'Matches') {
      return (
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>People you may run with</Text>
          <Text style={styles.body}>Matched by life stage, interests, goals, and location.</Text>
          {matches.map((user) => (
            <MatchCard key={user.id} user={user} onPress={() => setSelectedUser(user)} connected={connected.includes(user.id)} />
          ))}
        </ScrollView>
      );
    }
    if (tab === 'Groups') {
      return (
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Groups</Text>
          <Text style={styles.body}>Join nearby groups built around real life and shared faith.</Text>
          {GROUPS.map((group) => (
            <View key={group.id} style={styles.card}>
              <Text style={styles.cardTitle}>{group.name}</Text>
              <Text style={styles.muted}>{group.members} members nearby</Text>
              <Text style={styles.cardBody}>{group.detail}</Text>
              <Pressable style={styles.smallButton}><Text style={styles.smallButtonText}>Join Group</Text></Pressable>
            </View>
          ))}
        </ScrollView>
      );
    }
    if (tab === 'Messages') {
      return (
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Messages</Text>
          <View style={styles.messageCard}>
            <Text style={styles.cardTitle}>Jake &amp; Hannah</Text>
            <Text style={styles.cardBody}>Hey! Looks like we're both young families and enjoy beach days. Want to grab coffee or meet at the park sometime?</Text>
          </View>
          <View style={styles.messageCardAlt}>
            <Text style={styles.cardTitle}>Suggested opener</Text>
            <Text style={styles.cardBody}>"Hey, looks like we're both looking for deeper Christian community. Would love to connect sometime."</Text>
          </View>
        </ScrollView>
      );
    }
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Your Profile</Text>
        <View style={styles.avatarLarge}><Text style={styles.avatarText}>{profile.name ? profile.name[0] : 'F'}</Text></View>
        <Text style={styles.cardTitle}>{profile.name || 'Your Name'}</Text>
        <Text style={styles.muted}>{profile.city || 'City'}, {profile.state || 'State'}</Text>
        {!!profile.from && <Text style={styles.body}>Originally from {profile.from}</Text>}
        <Text style={styles.sectionTitle}>Your Answers</Text>
        <ChipRow items={[answers.stage, ...(answers.interests || []), ...(answers.lookingFor || [])].filter(Boolean)} />
        <PrimaryButton label="Edit Onboarding" onPress={() => { setScreen('questions'); setStep(0); }} />
      </ScrollView>
    );
  }
}

function Shell({ children, showBack, onBack }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        {showBack && <Pressable onPress={onBack}><Text style={styles.back}>\u2190 Back</Text></Pressable>}
        {children}
      </View>
    </SafeAreaView>
  );
}

function PrimaryButton({ label, onPress }) {
  return (
    <Pressable style={styles.primaryButton} onPress={onPress}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function Input(props) {
  return <TextInput style={styles.input} placeholderTextColor="#9A948C" {...props} />;
}

function Chip({ label }) {
  return <View style={styles.chip}><Text style={styles.chipText}>{label}</Text></View>;
}

function ChipRow({ items }) {
  return <View style={styles.chipRow}>{items.map((item) => <Chip key={item} label={item} />)}</View>;
}

function FeatureCard({ title, body, onPress }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </Pressable>
  );
}

function MatchCard({ user, onPress, connected }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{user.name[0]}</Text></View>
      <Text style={styles.cardTitle}>{user.name}</Text>
      <Text style={styles.muted}>{user.city}</Text>
      <Text style={styles.cardBody}>{user.stage} \u2022 {user.interests.slice(0, 3).join(' \u2022 ')}</Text>
      <Text style={styles.matchScore}>{user.score + 3} shared connection points</Text>
      <Text style={styles.smallButtonText}>{connected ? 'Connection Sent' : 'View Profile \u2192'}</Text>
    </Pressable>
  );
}

function BottomNav({ tab, setTab }) {
  const tabs = ['Home', 'Matches', 'Groups', 'Messages', 'Profile'];
  return (
    <View style={styles.bottomNav}>
      {tabs.map((item) => (
        <Pressable key={item} onPress={() => setTab(item)} style={styles.navItem}>
          <Text style={[styles.navText, tab === item && styles.navTextActive]}>{item}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, padding: 24, justifyContent: 'space-between' },
  questionScreen: { flex: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 },
  questionScrollContent: { paddingBottom: 28 },
  stickyButtonWrap: { paddingTop: 10, paddingBottom: 8, backgroundColor: COLORS.bg },
  hero: { flex: 1, justifyContent: 'center' },
  logo: { fontSize: 56, fontWeight: '800', letterSpacing: -2, color: COLORS.ink, marginBottom: 8 },
  appLogo: { fontSize: 26, fontWeight: '800', letterSpacing: -1, color: COLORS.ink },
  kicker: { fontSize: 18, color: COLORS.muted, marginBottom: 36 },
  heroTitle: { fontSize: 48, lineHeight: 52, fontWeight: '700', color: COLORS.ink, letterSpacing: -1.8, marginBottom: 18 },
  title: { fontSize: 36, lineHeight: 40, fontWeight: '700', color: COLORS.ink, letterSpacing: -1.2, marginBottom: 14 },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 3, fontSize: 12, color: COLORS.muted, marginBottom: 16 },
  body: { fontSize: 17, lineHeight: 26, color: COLORS.muted, marginBottom: 22 },
  muted: { fontSize: 14, color: COLORS.muted, marginBottom: 10 },
  smallCenter: { textAlign: 'center', color: COLORS.muted, marginTop: 14, marginBottom: 10 },
  input: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 16, fontSize: 16, marginBottom: 12, color: COLORS.ink },
  primaryButton: { backgroundColor: COLORS.ink, borderRadius: 999, paddingVertical: 17, alignItems: 'center', marginTop: 10 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  optionsWrap: { gap: 12, marginTop: 8 },
  option: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 24, padding: 18 },
  optionSelected: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  optionText: { color: COLORS.ink, fontSize: 16, fontWeight: '600' },
  optionTextSelected: { color: '#FFFFFF' },
  appHeader: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  headerSub: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  appBody: { flex: 1, padding: 22 },
  card: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 30, padding: 20, marginBottom: 14 },
  cardTitle: { fontSize: 21, fontWeight: '700', color: COLORS.ink, marginBottom: 6 },
  cardBody: { fontSize: 15, lineHeight: 22, color: COLORS.muted, marginBottom: 12 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.sand, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  avatarLarge: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.sand, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  avatarText: { fontSize: 28, fontWeight: '800', color: COLORS.charcoal },
  matchScore: { fontSize: 13, color: COLORS.olive, fontWeight: '700', marginBottom: 10 },
  smallButton: { alignSelf: 'flex-start', backgroundColor: COLORS.ink, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, marginTop: 4 },
  smallButtonText: { color: COLORS.ink, fontWeight: '800', fontSize: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: COLORS.ink, marginTop: 20, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: COLORS.sand, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9, marginRight: 8, marginBottom: 8 },
  chipText: { color: COLORS.ink, fontWeight: '600', fontSize: 13 },
  messageCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 30, padding: 20, marginBottom: 14 },
  messageCardAlt: { backgroundColor: COLORS.sand, borderRadius: 30, padding: 20, marginBottom: 14 },
  bottomNav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.line, backgroundColor: COLORS.card, paddingVertical: 10, paddingHorizontal: 4 },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  navText: { fontSize: 11, color: COLORS.muted, fontWeight: '700' },
  navTextActive: { color: COLORS.ink },
  back: { fontSize: 16, fontWeight: '700', color: COLORS.ink, marginBottom: 18 },
});
