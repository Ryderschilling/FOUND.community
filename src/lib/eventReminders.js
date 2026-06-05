// ─────────────────────────────────────────────────────────────────────────
// eventReminders.js
//
// Local scheduled notifications for event reminders.
// Fires 1 hour before the event time on the user's device.
//
// No server required — uses expo-notifications local scheduling.
// Fully guarded: no-ops on web and when native modules are unavailable.
//
// API:
//   scheduleEventReminder(event)   — schedule (or reschedule) a reminder
//   cancelEventReminder(eventId)   — cancel an existing reminder
//
// Notification identifier = "event_reminder_<eventId>" — stable so a
// reschedule always replaces the previous one rather than stacking.
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';

const REMINDER_OFFSET_MS = 60 * 60 * 1000; // 1 hour before
const MIN_LEAD_MS        = 5 * 60 * 1000;  // skip if < 5 min away (already too close)

function getNotifications() {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-notifications');
  } catch (e) {
    console.warn('[eventReminders] expo-notifications unavailable:', e?.message);
    return null;
  }
}

function identifierFor(eventId) {
  return `event_reminder_${eventId}`;
}

/**
 * Schedule a local reminder 1 hour before the event.
 * Safe to call repeatedly — cancels any existing reminder for this event first.
 *
 * @param {{ id: string, title: string, event_time: string }} event
 */
export async function scheduleEventReminder(event) {
  const Notifications = getNotifications();
  if (!Notifications) return;

  const eventTime = new Date(event.event_time).getTime();
  const fireAt    = eventTime - REMINDER_OFFSET_MS;
  const now       = Date.now();

  // Don't schedule if the reminder time has already passed or is too close.
  if (fireAt - now < MIN_LEAD_MS) return;

  const identifier = identifierFor(event.id);

  try {
    // Cancel any previous reminder for this event before rescheduling.
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: `📅 ${event.title}`,
        body:  'Starting in 1 hour — don\'t forget!',
        data:  { type: 'event_reminder', entity_id: event.id },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes?.DATE ?? 'date',
        date: new Date(fireAt),
      },
    });

    console.log('[eventReminders] scheduled reminder for:', event.title, 'at', new Date(fireAt).toISOString());
  } catch (e) {
    // Non-fatal — reminders are best-effort.
    console.warn('[eventReminders] schedule failed:', e?.message);
  }
}

/**
 * Cancel the scheduled reminder for an event (e.g. user declined RSVP).
 *
 * @param {string} eventId
 */
export async function cancelEventReminder(eventId) {
  const Notifications = getNotifications();
  if (!Notifications) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(identifierFor(eventId));
    console.log('[eventReminders] cancelled reminder for event:', eventId);
  } catch (e) {
    // Non-fatal.
    console.warn('[eventReminders] cancel failed:', e?.message);
  }
}
