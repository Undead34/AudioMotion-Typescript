import { GradientOptions } from "./types"

export const VERSION = '3.6.1';

// internal constants
export const TAU = 2 * Math.PI,
  HALF_PI = Math.PI / 2,
  RPM = TAU / 3600,           // angle increment per frame for one revolution per minute @60fps
  ROOT24 = 2 ** (1 / 24),      // 24th root of 2
  C0 = 440 * ROOT24 ** -114; // ~16.35 Hz

export const defaults = {
  alphaBars: false,
  barSpace: 0.1,
  bgAlpha: 0.7,
  fftSize: 8192,
  fillAlpha: 1,
  gradient: 'classic',
  ledBars: false,
  lineWidth: 0,
  loRes: false,
  lumiBars: false,
  maxDecibels: -25,
  maxFreq: 22000,
  minDecibels: -85,
  minFreq: 20,
  mirror: 0,
  mode: 0,
  outlineBars: false,
  overlay: false,
  radial: false,
  reflexAlpha: 0.15,
  reflexBright: 1,
  reflexFit: true,
  reflexRatio: 0,
  showBgColor: true,
  showFPS: false,
  showPeaks: true,
  showScaleX: true,
  showScaleY: false,
  smoothing: 0.5,
  spinSpeed: 0,
  splitGradient: false,
  start: true,
  stereo: false,
  useCanvas: true,
  volume: 1,
};

let classic: GradientOptions = {
  bgColor: '#111',
  colorStops: [
    'hsl( 0, 100%, 50% )',
    { pos: .6, color: 'hsl( 60, 100%, 50% )' },
    'hsl( 120, 100%, 50% )'
  ]
}

let prism: GradientOptions = {
  bgColor: '#111',
  colorStops: [
    'hsl( 0, 100%, 50% )',
    'hsl( 60, 100%, 50% )',
    'hsl( 120, 100%, 50% )',
    'hsl( 180, 100%, 50% )',
    'hsl( 240, 100%, 50% )'
  ]
}

let rainbow: GradientOptions = {
  bgColor: '#111',
  dir: 'h',
  colorStops: [
    'hsl( 0, 100%, 50% )',
    'hsl( 60, 100%, 50% )',
    'hsl( 120, 100%, 50% )',
    'hsl( 180, 100%, 47% )',
    'hsl( 240, 100%, 58% )',
    'hsl( 300, 100%, 50% )',
    'hsl( 360, 100%, 50% )'
  ]
}


export const gradients = {
  classic,
  prism,
  rainbow
};
