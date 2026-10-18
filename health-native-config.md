# Configuration Native pour Apple HealthKit et Google Health Connect

L'application web a été architecturée avec une couche de service (`src/services/healthService.ts`) prête à être connectée aux ponts natifs (Capacitor ou Expo). 

Cependant, étant donné qu'une Web App ne peut pas accéder directement aux données de santé de l'appareil pour des raisons de sécurité, vous **devez** envelopper l'application dans un conteneur natif (ex: Expo ou Capacitor) et ajouter les configurations suivantes pour obtenir les permissions du système d'exploitation.

## 🍎 iOS (Apple HealthKit)

Si vous utilisez Capacitor (`@capacitor-community/apple-fitness`) ou React Native / Expo, vous devez justifier l'utilisation de HealthKit dans votre fichier `Info.plist` (ou dans `app.json` via le plugin Expo).

**Fichier : `ios/App/App/Info.plist`**
```xml
<key>NSHealthShareUsageDescription</key>
<string>PlanaWork a besoin d'accéder à vos données de santé (fréquence cardiaque, VFC, sommeil) pour calculer votre charge d'entraînement, votre fatigue (ATL) et adapter les conseils du coach.</string>

<key>NSHealthUpdateUsageDescription</key>
<string>PlanaWork synchronisera vos entraînements complétés avec Apple Health pour maintenir votre profil à jour.</string>
```

Vous devez également activer la capacité **HealthKit** dans Xcode (Signing & Capabilities).

---

## 🤖 Android (Google Health Connect)

Google a remplacé Google Fit par **Health Connect**. Les permissions doivent être déclarées explicitement dans le `AndroidManifest.xml`.

**Fichier : `android/app/src/main/AndroidManifest.xml`**

1. Dans la balise `<manifest>`, ajoutez les permissions spécifiques :
```xml
<!-- Permettre à l'app de vérifier si Health Connect est installé -->
<queries>
    <package android:name="com.google.android.apps.healthdata" />
</queries>

<!-- Permissions de lecture -->
<uses-permission android:name="android.permission.health.READ_HEART_RATE"/>
<uses-permission android:name="android.permission.health.READ_RESTING_HEART_RATE"/>
<uses-permission android:name="android.permission.health.READ_HEART_RATE_VARIABILITY"/>
<uses-permission android:name="android.permission.health.READ_SLEEP"/>
<uses-permission android:name="android.permission.health.READ_EXERCISE"/>

<!-- Permissions d'écriture -->
<uses-permission android:name="android.permission.health.WRITE_EXERCISE"/>
```

2. Dans la balise `<activity>` principale, ajoutez le filtre d'intention pour gérer l'explication des permissions :
```xml
<intent-filter>
    <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
</intent-filter>
```

## Implémentation via l'App Web

Dans `src/services/healthService.ts`, remplacez le délai simulé (`setTimeout`) par l'appel réel au SDK de votre wrapper natif une fois votre projet migré.

Exemple (Pseudo-code Capacitor) :
```typescript
import { Health } from '@awesome-cordova-plugins/health';

// ... dans healthService.ts
if (provider === 'apple_health') {
  await Health.requestAuthorization([
    { read: ['heart_rate', 'sleep', 'hrv'] }
  ]);
  // Fetch real data...
}
```
