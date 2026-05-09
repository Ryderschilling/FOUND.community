/**
 * ScoreRing — circular SVG match percentage indicator
 * Uses react-native-svg. Shows a sage-colored arc over a light track.
 *
 * Props:
 *   score     number  0–100
 *   size      number  outer diameter (default 56)
 *   stroke    number  ring stroke width (default 4)
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { COLORS, FONT } from '../theme';

export default function ScoreRing({
  score = 0,
  size = 56,
  stroke = 4,
  style,
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(score / 100, 0), 1);
  const strokeDashoffset = circumference * (1 - progress);
  const center = size / 2;

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {/* Track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={COLORS.sageLight}
          strokeWidth={stroke}
          fill="none"
        />
        {/* Progress arc */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={COLORS.sage}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          // Start from top: rotate -90deg
          rotation="-90"
          origin={`${center}, ${center}`}
        />
      </Svg>
      {/* Score label */}
      <View style={styles.label}>
        <Text style={[styles.score, { fontSize: size * 0.22 }]}>{score}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    alignItems: 'center',
  },
  score: {
    fontFamily: FONT.bold,
    color: COLORS.sage,
    lineHeight: undefined,
  },
});
