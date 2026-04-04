// Global test setup — ensure native Expo modules are mocked in all test files
jest.mock('expo-camera');
jest.mock('expo-blur', () => ({
  BlurView: ({ children, style, ...props }) =>
    require('react').createElement(require('react-native').View, { style, ...props }, children),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: jest.fn(() => ({
    record: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(() => ({ metering: -160 })),
    uri: null,
  })),
  useAudioRecorderState: jest.fn(() => ({ metering: -160, isRecording: false })),
  RecordingPresets: { HIGH_QUALITY: {} },
  AudioModule: {
    setAudioModeAsync: jest.fn(),
    requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  },
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    release: jest.fn(),
    playing: false,
  })),
}));
jest.mock('react-native-live-audio-stream', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    on: jest.fn(),
  },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Heavy: 'heavy', Medium: 'medium', Light: 'light' },
  NotificationFeedbackType: { Error: 'error', Success: 'success', Warning: 'warning' },
}));
jest.mock('expo-font', () => ({
  useFonts: () => [true],
  isLoaded: jest.fn(() => true),
}));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }) => children,
}));

jest.mock('react-native-webrtc', () => {
  const View = require('react-native').View;
  return {
    RTCPeerConnection: jest.fn(),
    RTCSessionDescription: jest.fn((desc) => desc),
    RTCIceCandidate: jest.fn((candidate) => candidate),
    RTCView: (props) => require('react').createElement(View, { ...props, testID: props.testID || 'rtc-view' }),
    MediaStream: jest.fn().mockImplementation(() => ({
      toURL: () => 'mock-stream-url',
      addTrack: jest.fn(),
      getTracks: () => [],
    })),
    mediaDevices: { getUserMedia: jest.fn() },
  };
});

jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  return {
    __esModule: true,
    default: {
      View: ({ children, style, ...props }) =>
        require('react').createElement(View, { style, ...props }, children),
      createAnimatedComponent: (component) => component,
    },
    useSharedValue: (initial) => {
      const React = require('react');
      const ref = React.useRef(null);
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useAnimatedStyle: (fn) => fn(),
    useAnimatedProps: (fn) => (typeof fn === 'function' ? fn() : {}),
    useDerivedValue: (fn) => ({ value: typeof fn === 'function' ? fn() : 0 }),
    withTiming: (val) => val,
    withSpring: (val) => val,
    withRepeat: (val) => val,
    withDelay: (_delay, val) => val,
    interpolate: (value, inputRange, outputRange) => {
      // Simple linear interpolation for tests
      const [inMin, inMax] = inputRange;
      const [outMin, outMax] = outputRange;
      const ratio = (value - inMin) / (inMax - inMin);
      return outMin + ratio * (outMax - outMin);
    },
    cancelAnimation: jest.fn(),
    Easing: {
      inOut: () => ({}),
      out: () => ({}),
      linear: {},
      sin: {},
      quad: {},
    },
    useReducedMotion: jest.fn(() => false),
  };
});

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: jest.fn(({ children }) => children ?? null),
  Svg: jest.fn(({ children }) => children ?? null),
  Path: jest.fn(() => null),
  G: jest.fn(({ children }) => children ?? null),
  Circle: jest.fn(() => null),
  Rect: jest.fn(() => null),
  Line: jest.fn(() => null),
  Defs: jest.fn(({ children }) => children ?? null),
}));

jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  return {
    GestureHandlerRootView: ({ children, ...props }) =>
      require('react').createElement(View, props, children),
    GestureDetector: ({ children }) => children,
    Gesture: {
      Pinch: () => ({
        onUpdate: function () { return this; },
        onEnd: function () { return this; },
        onStart: function () { return this; },
      }),
      Pan: () => ({
        onUpdate: function () { return this; },
        onChange: function () { return this; },
        onEnd: function () { return this; },
        onStart: function () { return this; },
        minDistance: function () { return this; },
        activeOffsetX: function () { return this; },
        activeOffsetY: function () { return this; },
      }),
      Tap: () => ({
        numberOfTaps: function () { return this; },
        maxDuration: function () { return this; },
        onEnd: function () { return this; },
        onStart: function () { return this; },
      }),
      Simultaneous: function () { return this; },
      Exclusive: function () { return this; },
      Race: function () { return this; },
    },
  };
});

jest.mock('expo-screen-orientation', () => ({
  unlockAsync: jest.fn(),
  lockAsync: jest.fn(),
  OrientationLock: { PORTRAIT_UP: 1 },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  getAllKeys: jest.fn(() => Promise.resolve([])),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiSet: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn(() => Promise.resolve({ text: '', functionCalls: null })),
    },
  })),
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    ARRAY: 'ARRAY',
  },
}));

jest.mock('openai-react-native', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
    audio: { transcriptions: { create: jest.fn() } },
  })),
}));

jest.mock('anthropic-react-native', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  })),
}));

// Polyfill crypto.randomUUID for Jest (used by webrtc service envelope creation)
if (typeof globalThis.crypto === 'undefined') {
  const nodeCrypto = require('crypto');
  globalThis.crypto = { randomUUID: () => nodeCrypto.randomUUID() };
} else if (typeof globalThis.crypto.randomUUID !== 'function') {
  const nodeCrypto = require('crypto');
  globalThis.crypto.randomUUID = () => nodeCrypto.randomUUID();
}
