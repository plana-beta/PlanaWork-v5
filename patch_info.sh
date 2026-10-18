#!/bin/bash
sed -i.bak '/<\/dict>/i \
\t<key>NSHealthShareUsageDescription</key>\
\t<string>Plana utilise vos données d’activité et de fréquence cardiaque pour calculer votre charge d’entraînement et adapter votre plan.</string>\
\t<key>NSHealthUpdateUsageDescription</key>\
\t<string>Plana peut enregistrer des données d’entraînement dans Apple Health.</string>\
' ios/App/App/Info.plist
