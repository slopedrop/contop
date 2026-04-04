const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin that configures Android data persistence:
 * - hasFragileUserData: prompts "Keep app data?" on manual uninstall (Android 10+)
 * - fullBackupContent: backup rules for Android 11 and below
 * - dataExtractionRules: backup + device transfer rules for Android 12+
 *
 * This ensures session history, settings, and credentials survive app updates
 * and are included in Google cloud backup / device-to-device transfers.
 */

const BACKUP_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <include domain="database" path="RKStorage" />
    <include domain="sharedpref" path="." />
    <exclude domain="root" path="cache" />
    <exclude domain="external" path="cache" />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <include domain="database" path="RKStorage" />
        <include domain="sharedpref" path="." />
        <exclude domain="root" path="cache" />
        <exclude domain="external" path="cache" />
    </cloud-backup>
    <device-transfer>
        <include domain="database" path="." />
        <include domain="sharedpref" path="." />
        <exclude domain="root" path="cache" />
        <exclude domain="external" path="cache" />
    </device-transfer>
</data-extraction-rules>
`;

function withDataPersistence(config) {
  // Step 1: Modify AndroidManifest.xml to add persistence attributes
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) return mod;

    const attrs = application.$;
    attrs['android:hasFragileUserData'] = 'true';
    attrs['android:fullBackupContent'] = '@xml/backup_rules';
    attrs['android:dataExtractionRules'] = '@xml/data_extraction_rules';

    return mod;
  });

  // Step 2: Write the XML resource files into android/app/src/main/res/xml/
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      const xmlDir = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml'
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'backup_rules.xml'), BACKUP_RULES_XML);
      fs.writeFileSync(
        path.join(xmlDir, 'data_extraction_rules.xml'),
        DATA_EXTRACTION_RULES_XML
      );
      return mod;
    },
  ]);

  return config;
}

module.exports = withDataPersistence;
