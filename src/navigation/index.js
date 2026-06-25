import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, AppState, Animated, Linking, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, createNavigationContainerRef, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, FONT, SHADOW } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import * as Notifications from 'expo-notifications';
import {
  registerForPush,
  unregisterForPush,
  attachNotificationResponseListener,
} from '../lib/push';
import { useUnreadNotifications } from '../lib/notifications';
import { useIconBounce, usePulse } from '../lib/animations';

// Shared ref so a tapped push notification can navigate from outside React.
export const navigationRef = createNavigationContainerRef();

// Deep-link / universal-link config.
// Scheme "found" is registered in app.json.
// found://edit-profile        → EditProfileScreen  (used in nudge emails)
// found://profile             → Profile tab
// found://groups/:groupId     → GroupDetailScreen
// found://invite/:shareToken  → EventDetailScreen (resolves token → event)
// https://found.community/*   → same routes via Universal Links / App Links
const linking = {
  prefixes: ['found://', 'https://found.community', 'https://found-community.vercel.app'],
  config: {
    screens: {
      EditProfile: 'edit-profile',
      GroupDetail: 'groups/:groupId',
      EventDetail: 'invite/:shareToken',
      Main: {
        screens: {
          Profile: 'profile',
          Groups:  'groups',
        },
      },
    },
  },
};

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
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen  from '../screens/auth/ResetPasswordScreen';
import EditProfileScreen  from '../screens/EditProfileScreen';
import GroupDetailScreen  from '../screens/GroupDetailScreen';
import NotificationsFeedScreen from '../screens/NotificationsFeedScreen';
import ChurchProfileScreen    from '../screens/ChurchProfileScreen';
import ChurchInboxScreen      from '../screens/ChurchInboxScreen';
import BlockedUsersScreen from '../screens/BlockedUsersScreen';
import SuspendedScreen    from '../screens/SuspendedScreen';
import CreateEventScreen  from '../screens/CreateEventScreen';
import EventDetailScreen  from '../screens/EventDetailScreen';

import NotificationsScreen    from '../screens/settings/NotificationsScreen';
import LocationSettingsScreen from '../screens/settings/LocationSettingsScreen';
import PrivacyScreen          from '../screens/settings/PrivacyScreen';
import HelpSupportScreen      from '../screens/settings/HelpSupportScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// ── Tab config ────────────────────────────────────────────────────
// Activity tab uses brandMark image instead of an Ionicons icon.
// Set icon/iconActive to null to signal the image path in TabItem.
const TABS = [
  { name: 'Discover', icon: 'compass',   iconActive: 'compass',   label: 'Discover' },
  { name: 'Activity', icon: null,        iconActive: null,        label: 'FOUND'    },
  { name: 'Messages', icon: 'chatbubble', iconActive: 'chatbubble', label: 'Messages' },
  { name: 'Groups',   icon: 'people',    iconActive: 'people',    label: 'Groups'   },
  { name: 'Profile',  icon: 'person',    iconActive: 'person',    label: 'Profile'  },
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
      if (s === 'active') {
        fetchCounts();
        Notifications.setBadgeCountAsync(0).catch(() => {});
      }
    });
    return () => { clearInterval(id); sub.remove(); };
  }, [fetchCounts]);

  return { counts, refresh: fetchCounts };
}

// ── Animated tab icon + badge ─────────────────────────────────────
// Isolated component so each tab manages its own animation state.
function TabItem({ tab, focused, badgeCount, onPress }) {
  const iconBounce = useIconBounce(focused);
  const badgePulse = usePulse(badgeCount > 0, { min: 0.88, max: 1.14, duration: 900 });

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={styles.tabItem}
    >
      <Animated.View style={iconBounce}>
        {tab.icon === null ? (
          // FOUND tab — "F." text mark, enlarged per Sam 6-2-26 review
          <Text style={{
            fontFamily: FONT.bold,
            fontSize: 22,
            lineHeight: 22,
            letterSpacing: -0.5,
            color: focused ? COLORS.tabActive : COLORS.tabInactive,
            includeFontPadding: false,
          }}>F.</Text>
        ) : (
          <Ionicons
            name={focused ? tab.iconActive : `${tab.icon}-outline`}
            size={21}
            color={focused ? COLORS.tabActive : COLORS.tabInactive}
          />
        )}
        {badgeCount > 0 ? (
          <Animated.View style={[styles.tabBadge, badgePulse]}>
            <Text style={styles.tabBadgeText}>
              {badgeCount > 9 ? '9+' : String(badgeCount)}
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>
      <Text style={[styles.tabLabel, focused ? styles.tabLabelActive : styles.tabLabelInactive]}>
        {tab.label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Custom floating tab bar ────────────────────────────────────────
function FloatingTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  // Always reserve at least 16pt + 8pt breathing room. Some devices report
  // insets.bottom = 0 (e.g. older iPhones, Expo web) which previously cut off
  // the floating pill against the screen edge.
  const bottom = Math.max(insets.bottom, 16) + 8;
  const { counts, refresh: refreshCounts } = useUnreadCounts();
  const { user, profile } = useAuth();
  const { count: notifCount, refresh: refreshNotifs } = useUnreadNotifications(user?.id, 'tab-bar');

  // Profile gate — blocks Messages + Groups until the user has a photo AND a bio.
  // Applies to new AND existing users since it checks runtime profile state.
  const [photoGateTab, setPhotoGateTab] = useState(null); // 'Messages' | 'Groups' | null
  const hasPhoto    = !!(profile?.avatar_url);
  const hasBio      = !!(profile?.bio?.trim());
  const profileComplete = hasPhoto && hasBio;

  // ── Pill positioning ──────────────────────────────────────────────
  // Web (CSS): position:absolute origins from the PADDING edge of the parent.
  // Native (Yoga): position:absolute origins from the CONTENT edge.
  // Tabs use flex:1 and fill the CONTENT area. To make pill math identical on
  // both platforms, offset the pill's `left` by paddingHorizontal on web so
  // it anchors at the content edge just like native.
  const INNER_PAD  = 4;  // tabBarInner paddingHorizontal — must stay in sync
  const PILL_INSET = 2;  // breathing room on each side of tab slot (reduced for better alignment)
  // Both native and web: absolute `left: 0` starts at the padding edge, not content edge.
  // Offset by INNER_PAD so the pill anchors at the same content edge as the flex tabs.
  const pillBaseLeft = INNER_PAD;

  const [barWidth, setBarWidth] = useState(0);
  const numTabs     = state.routes.length;
  const pillX       = useRef(new Animated.Value(0)).current;
  const firstLayout = useRef(true);

  // Content width excludes both borders (1px each) and both paddings.
  const contentWidth = barWidth > 0 ? barWidth - 2 - 2 * INNER_PAD : 0;
  const tabWidth     = contentWidth / numTabs;
  const pillWidth    = tabWidth > 0 ? tabWidth - PILL_INSET * 2 : 0;

  useEffect(() => {
    if (!barWidth) return;
    // Tab i occupies [i*tabWidth, (i+1)*tabWidth] within the content area.
    // Pill left (relative to content edge) = i*tabWidth + PILL_INSET.
    const targetX = state.index * tabWidth + PILL_INSET;

    if (firstLayout.current) {
      pillX.setValue(targetX);
      firstLayout.current = false;
      return;
    }

    Animated.spring(pillX, {
      toValue: targetX,
      useNativeDriver: true,
      damping: 18,
      stiffness: 160,
      mass: 0.7,
    }).start();
  }, [state.index, barWidth]);

  return (
    <>
    {/* ── Profile-gate modal ───────────────────────────────────────────
        Shown when a user without a complete profile taps Messages or Groups.
        "Complete profile" navigates to EditProfile via the root stack ref. */}
    <Modal
      visible={photoGateTab !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setPhotoGateTab(null)}
    >
      <Pressable style={styles.gateOverlay} onPress={() => setPhotoGateTab(null)}>
        <Pressable style={styles.gateSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.gateHandle} />
          <Text style={styles.gateTitle}>Complete your profile first</Text>
          <Text style={styles.gateBody}>
            {photoGateTab === 'Messages'
              ? 'People need to know who they\'re talking to before you can message.'
              : 'Members need to know who you are before you can join a group.'}
          </Text>

          {/* Only show what's still missing */}
          <View style={styles.gateChecklist}>
            {!hasPhoto && (
              <View style={styles.gateCheckRow}>
                <View style={styles.gateCheckBadge}>
                  <Ionicons name="close" size={13} color={COLORS.white} />
                </View>
                <Text style={styles.gateCheckLabel}>Profile photo</Text>
              </View>
            )}
            {!hasBio && (
              <View style={styles.gateCheckRow}>
                <View style={styles.gateCheckBadge}>
                  <Ionicons name="close" size={13} color={COLORS.white} />
                </View>
                <Text style={styles.gateCheckLabel}>Bio</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.gateButton}
            activeOpacity={0.85}
            onPress={() => {
              setPhotoGateTab(null);
              if (navigationRef.isReady()) navigationRef.navigate('EditProfile');
            }}
          >
            <Text style={styles.gateButtonText}>Complete profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.gateDismiss}
            activeOpacity={0.7}
            onPress={() => setPhotoGateTab(null)}
          >
            <Text style={styles.gateDismissText}>Not now</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>

    <View style={[styles.tabBarOuter, { paddingBottom: bottom }]}>
      <View
        style={styles.tabBarInner}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      >
        {/* Single sliding pill, anchored to content edge on both platforms */}
        {barWidth > 0 && (
          <Animated.View
            style={[
              styles.tabPill,
              { left: pillBaseLeft, width: pillWidth, transform: [{ translateX: pillX }] },
            ]}
            pointerEvents="none"
          />
        )}

        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const tab     = TABS.find(t => t.name === route.name) ?? TABS[0];

          const onPress = () => {
            // Gate Messages + Groups behind a complete profile (photo + bio).
            // Shows a modal explaining what's needed; button goes to EditProfile.
            if (!profileComplete && (route.name === 'Messages' || route.name === 'Groups')) {
              setPhotoGateTab(route.name);
              return;
            }

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

          return (
            <TabItem
              key={route.key}
              tab={tab}
              focused={focused}
              badgeCount={badgeCount}
              onPress={onPress}
            />
          );
        })}
      </View>
    </View>
    </>
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
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Groups"   component={GroupsScreen}   />
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
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ animation: 'slide_from_right' }} />
    </Stack.Navigator>
  );
}

// ── Recovery stack ─────────────────────────────────────────────────
// Shown when the user opens a password-reset link (AuthContext.recoveryMode).
// It pre-empts both the auth stack and the app stack: a recovery link
// technically creates a session, so without this gate the user would land
// straight in the app and never get a chance to set a new password.
function RecoveryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
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
          <Stack.Screen name="CreateEvent"     component={CreateEventScreen}      options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="EventDetail"     component={EventDetailScreen}      options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChurchProfile"   component={ChurchProfileScreen}    options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ChurchInbox"     component={ChurchInboxScreen}      options={{ animation: 'slide_from_right' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

// ── Root: gate on auth ─────────────────────────────────────────────
// Defined outside the component so the object reference is stable — prevents
// NavigationContainer from re-initializing on every AppNavigator render.
// React Navigation v7 added a `fonts` key to the theme shape.
// Spread DefaultTheme so we inherit any new required keys automatically.
const NAV_THEME = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary:      COLORS.accent,
    background:   COLORS.bg,
    card:         COLORS.bg,
    text:         COLORS.text,
    border:       COLORS.border,
    notification: COLORS.clay,
  },
};

export default function AppNavigator() {
  const { session, profile, loading, profileLoading, recoveryMode } = useAuth();

  // ── Deep link replay after auth resolves ────────────────────────────
  // Problem: when the app cold-starts from a deep link (e.g. found://edit-profile),
  // the auth spinner mounts WITHOUT a NavigationContainer, so React Navigation
  // can't process the URL. We capture it early, then navigate once the navigator
  // is ready and the user is fully logged in.
  const pendingDeepLink = useRef(null);

  useEffect(() => {
    Linking.getInitialURL().then(url => {
      if (url) pendingDeepLink.current = url;
    });
  }, []);

  useEffect(() => {
    if (!session || !profile?.onboarding_complete) return;
    if (!pendingDeepLink.current) return;
    const url = pendingDeepLink.current;
    pendingDeepLink.current = null;

    const tryNavigate = () => {
      if (!navigationRef.isReady()) return false;
      if (url.includes('/groups/')) {
        // e.g. found://groups/uuid  or  https://found.community/groups/uuid
        const groupId = url.split('/groups/')[1]?.split('?')[0];
        if (groupId) navigationRef.navigate('GroupDetail', { groupId });
      } else if (url.includes('/invite/')) {
        // e.g. https://found.community/invite/<share_token>
        const shareToken = url.split('/invite/')[1]?.split('?')[0];
        if (shareToken) navigationRef.navigate('EventDetail', { shareToken });
      } else if (url.includes('edit-profile')) {
        navigationRef.navigate('EditProfile');
      } else if (url.includes('profile')) {
        navigationRef.navigate('Main', { screen: 'Profile' });
      }
      return true;
    };

    if (!tryNavigate()) {
      const id = setInterval(() => { if (tryNavigate()) clearInterval(id); }, 50);
      return () => clearInterval(id);
    }
  }, [session, profile?.onboarding_complete]);

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
  const showSpinner =
    loading || (session && profileLoading && !profile && !recoveryMode);
  if (showSpinner) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg }}>
        <ActivityIndicator color={COLORS.text} />
      </View>
    );
  }

  // A password-reset link was opened. This must pre-empt both the auth stack
  // and the app stack: the recovery link establishes a session, so without
  // this gate the user would land in the app and never set a new password.
  if (recoveryMode) {
    return (
      <NavigationContainer ref={navigationRef} linking={linking}>
        <RecoveryStack />
      </NavigationContainer>
    );
  }

  // A suspended profile can still hold a valid session, but a moderator has
  // revoked their access via the admin panel. This pre-empts the app stack
  // entirely — rendered with no NavigationContainer, so the user can reach
  // nothing but the suspension notice and a Sign Out button. The gate clears
  // by itself if the profile is unsuspended and refetched.
  if (session && profile?.suspended) {
    return <SuspendedScreen />;
  }

  const needsOnboarding = !!session && !profile?.onboarding_complete;

  return (
    <NavigationContainer ref={navigationRef} theme={NAV_THEME}>
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
    gap: 4,       // increased from 3 → pushes labels down to align with larger F.
    position: 'relative',
  },
  tabPill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
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

  // ── Photo-gate modal ─────────────────────────────────────────────
  gateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  gateSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 28,
    paddingBottom: 40,
    paddingTop: 12,
    alignItems: 'center',
  },
  gateHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 24,
  },
  gateTitle: {
    fontFamily: FONT.semiBold,
    fontSize: 18,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  gateBody: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  gateChecklist: {
    width: '100%',
    gap: 10,
    marginBottom: 28,
  },
  gateCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  gateCheckBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E8534A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateCheckBadgeDone: {
    backgroundColor: '#4CAF50',
  },
  gateCheckLabel: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  gateCheckLabelDone: {
    color: COLORS.text,
    fontFamily: FONT.semiBold,
  },
  gateButton: {
    width: '100%',
    backgroundColor: COLORS.text,
    borderRadius: 9999,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  gateButtonText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.white,
  },
  gateDismiss: {
    paddingVertical: 8,
  },
  gateDismissText: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
});
