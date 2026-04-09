/**
 * ATDD - Story 1.1: Project Initialization & Infrastructure Scaffold
 * Unit Tests for mobile client configuration (GREEN PHASE)
 *
 * These tests validate acceptance criteria:
 *   AC1: Mobile client initialized with Expo bare workflow + NativeWind
 *   AC3: Both environments build and run locally without errors
 *
 * These are pure filesystem checks - no Expo runtime needed.
 */

const fs = require('fs');
const path = require('path');

// Mobile project root (this file lives at contop-mobile/)
const MOBILE_ROOT = __dirname;

describe('[ATDD 1.1] Mobile Client Configuration', () => {
  // 1.1-UNIT-001: Mobile package.json has required dependencies
  describe('[P1] Package Dependencies', () => {
    let packageJson;

    beforeAll(() => {
      const pkgPath = path.join(MOBILE_ROOT, 'package.json');
      const content = fs.readFileSync(pkgPath, 'utf-8');
      packageJson = JSON.parse(content);
    });

    test('should have expo as dependency', () => {
      expect(packageJson.dependencies).toHaveProperty('expo');
    });

    test('should have react as dependency', () => {
      expect(packageJson.dependencies).toHaveProperty('react');
    });

    test('should have react-native as dependency', () => {
      expect(packageJson.dependencies).toHaveProperty('react-native');
    });

    test('should have nativewind as dependency', () => {
      expect(packageJson.dependencies).toHaveProperty('nativewind');
    });

    test('should have react-native-webrtc as dependency', () => {
      expect(packageJson.dependencies).toHaveProperty('react-native-webrtc');
    });

    test('should have tailwindcss as dependency', () => {
      expect(packageJson.dependencies).toHaveProperty('tailwindcss');
    });

    test('should have react-native-reanimated as dependency', () => {
      expect(packageJson.dependencies).toHaveProperty('react-native-reanimated');
    });
  });

  // 1.1-UNIT-002: NativeWind v4 configured
  describe('[P1] NativeWind Configuration', () => {
    test('tailwind.config.js should exist', () => {
      const configPath = path.join(MOBILE_ROOT, 'tailwind.config.js');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    test('tailwind.config.js should have nativewind preset', () => {
      const configPath = path.join(MOBILE_ROOT, 'tailwind.config.js');
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('nativewind');
    });
  });

  // 1.1-UNIT-003: Babel configured with NativeWind
  describe('[P1] Babel Configuration', () => {
    test('babel.config.js should exist', () => {
      const configPath = path.join(MOBILE_ROOT, 'babel.config.js');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    test('babel.config.js should include nativewind/babel preset', () => {
      const configPath = path.join(MOBILE_ROOT, 'babel.config.js');
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('nativewind/babel');
    });
  });

  // 1.1-UNIT-004: TypeScript strict mode enabled
  describe('[P2] TypeScript Configuration', () => {
    test('tsconfig.json should exist', () => {
      const configPath = path.join(MOBILE_ROOT, 'tsconfig.json');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    test('tsconfig.json should have strict mode enabled', () => {
      const configPath = path.join(MOBILE_ROOT, 'tsconfig.json');
      const content = fs.readFileSync(configPath, 'utf-8');
      const tsconfig = JSON.parse(content);
      expect(tsconfig.compilerOptions.strict).toBe(true);
    });
  });

  // 1.1-UNIT-005: Required folder structure exists
  describe('[P2] Folder Structure', () => {
    const requiredDirs = [
      'app',
      'components',
      'stores',
      'hooks',
      'services',
      'constants',
      'types',
    ];

    requiredDirs.forEach((dir) => {
      test(`${dir}/ directory should exist`, () => {
        const dirPath = path.join(MOBILE_ROOT, dir);
        expect(fs.existsSync(dirPath)).toBe(true);
        const stats = fs.statSync(dirPath);
        expect(stats.isDirectory()).toBe(true);
      });
    });
  });

  // 1.1-UNIT-006: Expo app.json valid
  describe('[P2] Expo Configuration', () => {
    test('app.json should exist', () => {
      const configPath = path.join(MOBILE_ROOT, 'app.json');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    test('app.json should be valid JSON', () => {
      const configPath = path.join(MOBILE_ROOT, 'app.json');
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    test('app.json should have a name field', () => {
      const configPath = path.join(MOBILE_ROOT, 'app.json');
      const content = fs.readFileSync(configPath, 'utf-8');
      const appConfig = JSON.parse(content);
      // Expo app.json can have name at root or under expo key
      const name = appConfig.name || (appConfig.expo && appConfig.expo.name);
      expect(name).toBeDefined();
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });
  });
});
