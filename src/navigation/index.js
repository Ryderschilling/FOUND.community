import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, FONT, SHADOW } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import {
  registerForPush,
  unregisterForPush,
  attachNotificationResponseListener,
} from '../lib/push';
import { useUnreadNotifications } from '../lib/notifications';

// Shared ref so a tapped push notification can navigate from outside React.
export const navigationRef = createNavigationContainerRef();

import SplashScreen       from '../screens/SplashScreen';
import OnboardingScreen   from '../screens/OnboardingScreen';
import HomeScreen         from '../screens/HomeScreen';
import GroupsScreen       from '../screens/GroupsScreen';
import MessagesScreen     from '../screens/MessagesScreen';
import ProfileScreen      from '../screens/ProfileScreen';
import ActivityScreen     from '../screens/ActivityScreen';
import MatchDetailScreen  from '../screens/MatchDetailScreen';
import ChatScreen         from '../screens/ChatScreen';
import SignInScreen       from '../screens/auth/SignInScreen';
import SignUpScreen       from '../screens/auth/SignUpScreen';
import EditProfileScreen  from '../screens/EditProfileScreen';
import GroupDetailScreen  from '../screens/GroupDetailScreen';
import NotificationsFeedScreen from '../screens/NotificationsFeedScreen';
import BlockedUsersScreen from '../screens/BlockedUsersScreen';

import NotificationsScreen    from '../screens/settings/NotificationsScreen';
import LocationSettingsScreen from '../screens/settings/LocationSettingsScreen';
import PrivacyScreen          from '../screens/settings/PrivacyScreen';
import HelpSupportScreen      from '../screens/settings/HelpSupportScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// ── Tab config ────────────────────────────────────────────────────
const TABS = [
  { name: 'Discover', icon: 'compass',       iconActive: 'compass',       label: 'Discover' },
  { name: 'Groups',   icon: 'people',        iconActive: 'people',        label: 'Groups'   },
  { name: 'Activity', icon: 'notifications', iconActive: 'notifications', label: 'Activity' },
  { name: 'Messages', icon: 'chatbubble',    iconActive: 'chatbubble',    label: 'Messages' },
  { name: 'Profile',  icon: 'person',        iconActive: 'person',        label: 'Profile'  },
];

// ── Unread counts hook (Activity + Messages) ─────────────────────
// Single hook fires both RPCs in parallel every 45s + on app foreground.
// Both badges use the same poll cycle so we only spend one round-trip pair.
// Swap to Supabase realtime subscriptions when scale warrants.
function useUnreadCounts() {
  const { user } = useAuth();
  const [counts, setCounts] = useState({ activity: 0, messages: 0 });

  const fetchCounts = React.useCallback(async () => {
    if (!user) { setCounts({ activity: 0, messages: 0 }); return; }
    const [actRes, msgRes] = await Promise.all([
      supabase.rpc('unread_inbound_count'),
      supabase.rpc('unread_messages_count'),
    ]);
    setCounts({
      activity: actRes.error ? 0 : (typeof actRes.data === 'number' ? actRes.data : (actRes.data ?? 0)),
      messages: msgRes.error ? 0 : (typeof msgRes.data === 'number' ? msgRes.data : (msgRes.data ?? 0)),
    });
  }, [user]);

  useEffect(() => {
    fetchCounts();
    const id = setInterval(fetchCounts, 45_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') fetchCounts();
    });
    return () => { clearInterval(id); sub.remove(); };
  }, [fetchCounts]);

  return { counts, refresh: fetchCounts };
}

// ── Custom floating tab bar ────────────────────────────────────────
function FloatingTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  // Always reserve at least 16pt + 8pt breathing room. Some devices report
  // insets.bottom = 0 (e.g. older iPhones, Expo web) which previously cut off
  // the floating pill against the screen edge.
  const bottom = Math.max(insets.bottom, 16) + 8;
  const { counts, refresh: refreshCounts } = useUnreadCounts();
  const { user } = useAuth();
  const { count: notifCount, refresh: refreshNotifs } = useUnreadNotifications(user?.id, 'tab-bar');

  return (
    <View style={[styles.tabBarOuter, { paddingBottom: bottom }]}>
      <View style={styles.tabBarInner}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const tab     = TABS.find(t => t.name === route.name) ?? TABS[0];

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
            // Activity screen marks-all-seen on focus; Messages screen marks
            // each thread read when opened. Refresh shortly after navigating
            // so the badges drop.
            if (route.name === 'Activity') {
              setTimeout(() => { refreshCounts(); refreshNotifs(); }, 800);
            } else if (route.name === 'Messages') {
              setTimeout(refreshCounts, 800);
            }
          };

          // Pick badge value per tab.
          const badgeCount =
            route.name === 'Activity' ? counts.activity
          : route.name === 'Messages' ? counts.messages
          : 0;
          const showBadge = badgeCount > 0;

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              activeOpacity={0.75}
              style={styles.tabItem}
            >
              {focused && <View style={styles.tabPill} />}
              <View>
                <Ionicons
                  name={focused ? tab.iconActive : `${tab.icon}-outline`}
                  size={21}
                  color={focused ? COLORS.tabActive : COLORS.tabInactive}
                />
                {showBadge ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {badgeCount > 9 ? '9+' : String(badgeCount)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, focused ? styles.tabLabelActive : styles.tabLabelInactive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Main tabs navigator ────────────────────────────────────────────
function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Discover" component={HomeScreen}     />
      <Tab.Screen name="Groups"   component={GroupsScreen}   />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Profile"  component={ProfileScreen}  />
    </Tab.Navigator>
  );
}

// ── Auth stack (unauthenticated users) ─────────────────────────────
function AuthStack() {
  return (
    <Stack.Navigator
      initialRouteName="Splash"
      screenOptions={{ headerShown: false, animation: 'fade' }}
    >
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="SignIn" component={SignInScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="SignUp" component={SignUpScreen} options={{ animation: 'slide_from_right' }} />
    </Stack.Navigator>
  );
}

// ── App stack (signed-in users) ────────────────────────────────────
// Uses React Navigation's conditional-screens pattern: when needsOnboarding
// flips from true → false (after complete_onboarding RPC), the Onboarding
// screen unmounts and the Main stack mounts. This forces a clean swap
// instead of relying on initialRouteName (which is only read once at mount,
// and was the cause of the post-onboarding freeze).
function AppStack({ needsOnboarding }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {needsOnboarding ? (
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ animation: 'slide_from_right' }}
        />
      ) : (
        <>
          <Stack.Screen name="Main"        component={MainTabNavigator}  options={{ animation: 'fade' }} />
          <Stack.Screen name="MatchDetail" component={MatchDetailScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Chat"        component={ChatScreen}        options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="GroupDetail" component={GroupDetailScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="NotificationsFeed" component={NotificationsFeedScreen} options={{ animation: 'slide_from_right' }} />

          <Stack.Screen name="Notifications"    component={NotificationsScreen}    options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="LocationSettings" component={LocationSettingsScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Privacy"          component={PrivacyScreen}          options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="HelpSupport"      component={HelpSupportScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="BlockedUsers"     component={BlockedUsersScreen}     options={{ animation: 'slide_from_right' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

// ── Root: gate on auth ─────────────────────────────────────────────
export default function AppNavigator() {
  const { session, profile, loading, profileLoading } = useAuth();

  // ── Push notifications ──────────────────────────────────────────────
  // Register the device once per signed-in user (keyed on the stable user
  // id, so an hourly token refresh doesn't churn). Attach the tap listener
  // for deep-linking; release the token on sign-out. All no-ops on web.
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    registerForPush();
    const detach = attachNotificationResponseListener(navigationRef);
    return () => {
      detach();
      unregisterForPush();
    };
  }, [userId]);

  // Two wait states:
  //   loading       — bootstrapping session from AsyncStorage
  //   profileLoading — we know who the user is, but haven't read their profile
  //                    row yet (so we don't know if they need onboarding).
  // CRITICAL: only show the spinner when we have NO profile yet. If we already
  // have a profile and are just refetching (e.g. after EditProfile save),
  // returning a different element here unmounts the entire NavigationContainer
  // and resets the user back to the first tab. The first-load gate is the
  // `!profile` guard.
  if (loading || (session && profileLoading && !profile)) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg }}>
        <ActivityIndicator color={COLORS.text} />
      </View>
    );
  }

  const needsOnboarding = !!session && !profile?.onboarding_complete;

  return (
    <NavigationContainer ref={navigationRef}>
      {session ? <AppStack needsOnboarding={needsOnboarding} /> : <AuthStack />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  // Outer wrapper: sits above the safe area, provides bottom padding
  tabBarOuter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  // The pill-shaped floating bar
  tabBarInner: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 4,
    ...SHADOW.lg,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 3,
    position: 'relative',
  },
  tabPill: {
    position: 'absolute',
    top: 0,
    left: '10%',
    right: '10%',
    bottom: 0,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceAlt,
  },
  tabLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 10,
    letterSpacing: 0.1,
  },
  tabLabelActive: {
    color: COLORS.tabActive,
  },
  tabLabelInactive: {
    color: COLORS.tabInactive,
  },
  // Red dot + count badge on the Activity tab icon
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#D24A4A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.white,
  },
  tabBadgeText: {
    fontFamily: FONT.bold,
    fontSize: 9,
    color: COLORS.white,
    letterSpacing: 0,
  },
});
