// ─────────────────────────────────────────────────────────────────────────
// calendarIntegration.js
//
// Adds a FOUND event to the user's default calendar app.
// Uses expo-calendar — fully guarded (no-op on web, graceful if unavailable).
//
// API:
//   addEventToCalendar(event) → Promise<{ success: boolean, error?: string }>
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';

function getCalendar() {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-calendar');
  } catch (e) {
    console.warn('[calendar] expo-calendar unavailable:', e?.message);
    return null;
  }
}

/**
 * Add a FOUND event to the device's default calendar.
 *
 * @param {{ title: string, event_time: string, location_name?: string, description?: string }} event
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function addEventToCalendar(event) {
  const Calendar = getCalendar();
  if (!Calendar) return { success: false, error: 'Calendar not available on this platform.' };

  try {
    // Request permission
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      return { success: false, error: 'Calendar permission denied.' };
    }

    // Get the default calendar to write to
    let calendarId;
    if (Platform.OS === 'ios') {
      const defaultCal = await Calendar.getDefaultCalendarAsync();
      calendarId = defaultCal?.id;
    } else {
      // Android — find a local writable calendar
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const local = calendars.find(
        (c) => c.accessLevel === Calendar.CalendarAccessLevel.OWNER &&
               c.source?.type === 'LOCAL'
      ) ?? calendars.find((c) => c.allowsModifications);
      calendarId = local?.id;
    }

    if (!calendarId) {
      return { success: false, error: 'No writable calendar found on this device.' };
    }

    const startDate = new Date(event.event_time);
    // Default duration: 1 hour
    const endDate   = new Date(startDate.getTime() + 60 * 60 * 1000);

    await Calendar.createEventAsync(calendarId, {
      title:    event.title,
      startDate,
      endDate,
      location: event.location_name ?? undefined,
      notes:    event.description ?? undefined,
      alarms:   [{ relativeOffset: -60 }], // 1 hour reminder in the calendar app too
    });

    return { success: true };
  } catch (e) {
    console.warn('[calendar] addEventToCalendar failed:', e?.message);
    return { success: false, error: e?.message ?? 'Could not add to calendar.' };
  }
}
