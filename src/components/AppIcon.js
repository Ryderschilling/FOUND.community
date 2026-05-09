import React from 'react';
import { Ionicons } from '@expo/vector-icons';

/**
 * AppIcon — thin wrapper around Ionicons.
 * Use this everywhere instead of emoji Text nodes.
 *
 * Props:
 *   name    string  — Ionicons icon name (e.g. 'book-outline')
 *   size    number  — px (default 20)
 *   color   string  — hex / rgba (default inherits nothing, caller must pass)
 *   style   object  — optional extra View style on the icon
 */
export default function AppIcon({ name, size = 20, color = '#1A1A1A', style }) {
  return <Ionicons name={name} size={size} color={color} style={style} />;
}
