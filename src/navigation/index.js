import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, FONT, SHADOW } from '../theme';

import SplashScreen       from '../screens/SplashScreen';
import OnboardingScreen   from '../screens/OnboardingScreen';
import HomeScreen         from '../screens/HomeScreen';
import GroupsScreen       from '../screens/GroupsScreen';
import MessagesScreen     from '../screens/MessagesScreen';
import ProfileScreen      from '../screens/ProfileScreen';
import MatchDetailScreen  from '../screens/MatchDetailScreen';
import ChatScreen         from '../screens/ChatScreen';

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

// ── Root stack ─────────────────────────────────────────────────────
export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{ headerShown: false, animation: 'fade' }}
      >
        <Stack.Screen name="Splash"       component={SplashScreen}      />
        <Stack.Screen name="Onboarding"   component={OnboardingScreen}  options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Main"         component={MainTabNavigator}  options={{ animation: 'fade' }} />
        <Stack.Screen name="MatchDetail"  component={MatchDetailScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Chat"         component={ChatScreen}        options={{ animation: 'slide_from_right' }} />
      </Stack.Navigator>
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
