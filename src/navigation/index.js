import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, FONT, SHADOW } from '../theme';
import { useAuth } from '../auth/AuthContext';

import SplashScreen       from '../screens/SplashScreen';
import OnboardingScreen   from '../screens/OnboardingScreen';
import HomeScreen         from '../screens/HomeScreen';
import GroupsScreen       from '../screens/GroupsScreen';
import MessagesScreen     from '../screens/MessagesScreen';
import ProfileScreen      from '../screens/ProfileScreen';
import MatchDetailScreen  from '../screens/MatchDetailScreen';
import ChatScreen         from '../screens/ChatScreen';
import SignInScreen       from '../screens/auth/SignInScreen';
import SignUpScreen       from '../screens/auth/SignUpScreen';
import EditProfileScreen  from '../screens/EditProfileScreen';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// ── Tab config ────────────────────────────────────────────────────
const TABS = [
  { name: 'Discover', icon: 'compass',    iconActive: 'compass',     label: 'Discover' },
  { name: 'Groups',   icon: 'people',     iconActive: 'people',      label: 'Groups'   },
  { name: 'Messages', icon: 'chatbubble', iconActive: 'chatbubble',  label: 'Messages' },
  { name: 'Profile',  icon: 'person',     iconActive: 'person',      label: 'Profile'  },
];

// ── Custom floating tab bar ────────────────────────────────────────
function FloatingTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);

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
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              activeOpacity={0.75}
              style={styles.tabItem}
            >
              {focused && <View style={styles.tabPill} />}
              <Ionicons
                name={focused ? tab.iconActive : `${tab.icon}-outline`}
                size={21}
                color={focused ? COLORS.tabActive : COLORS.tabInactive}
              />
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
        </>
      )}
    </Stack.Navigator>
  );
}

// ── Root: gate on auth ─────────────────────────────────────────────
export default function AppNavigator() {
  const { session, profile, loading, profileLoading } = useAuth();

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
    <NavigationContainer>
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
});
