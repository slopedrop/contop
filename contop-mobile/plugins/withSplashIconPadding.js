const { withDangerousMod, withAndroidStyles, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin that fixes the Android 12+ splash screen logo clipping.
 *
 * Android 12's SplashScreen API applies a circular mask (216dp circle in a
 * 288dp icon area) to windowSplashScreenAnimatedIcon. The default Expo-generated
 * splashscreen_logo PNGs fill the entire canvas, so the L-shaped Contop logo
 * gets its edges cut off by the circle.
 *
 * This plugin:
 * 1. Creates a layer-list drawable wrapper that insets the logo by 28dp per side
 *    (232dp content area - logo corners at ~108dp from center, matching circle radius)
 * 2. Patches styles.xml via the managed withAndroidStyles mod to reference the
 *    wrapper instead of the raw bitmap
 */

const SPLASH_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item
        android:left="28dp"
        android:top="28dp"
        android:right="28dp"
        android:bottom="28dp">
        <bitmap
            android:src="@drawable/splashscreen_logo"
            android:gravity="fill" />
    </item>
</layer-list>
`;

function withSplashIconPadding(config) {
  // Step 1: Write the wrapper drawable XML file
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      const drawableDir = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'drawable'
      );
      fs.mkdirSync(drawableDir, { recursive: true });
      fs.writeFileSync(
        path.join(drawableDir, 'splashscreen_icon.xml'),
        SPLASH_ICON_XML
      );
      return mod;
    },
  ]);

  // Step 2: Patch styles.xml via the managed styles mod so the change persists
  // through Expo's mod pipeline (withDangerousMod runs before withAndroidStyles,
  // so a raw file write would be overwritten by expo-splash-screen's style gen).
  config = withAndroidStyles(config, (mod) => {
    mod.modResults = AndroidConfig.Styles.setStylesItem({
      item: {
        _: '@drawable/splashscreen_icon',
        $: { name: 'windowSplashScreenAnimatedIcon' },
      },
      xml: mod.modResults,
      parent: {
        name: 'Theme.App.SplashScreen',
        parent: 'Theme.SplashScreen',
      },
    });
    return mod;
  });

  return config;
}

module.exports = withSplashIconPadding;
