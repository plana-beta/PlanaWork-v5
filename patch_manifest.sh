#!/bin/bash
sed -i.bak '/<uses-permission android:name="android.permission.health.READ_DISTANCE"\/>/a \
    <uses-permission android:name="android.permission.health.READ_EXERCISE"/>\
    <uses-permission android:name="android.permission.health.READ_POWER"/>\
    <uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED"/>\
' android/app/src/main/AndroidManifest.xml
