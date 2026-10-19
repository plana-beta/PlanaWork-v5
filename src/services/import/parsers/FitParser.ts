import { RawExtractedWorkoutData } from '../../../domain/workoutImportTypes';

// Constante Garmin epoch : secondes entre le 1er janvier 1970 et le 31 décembre 1989 00:00:00 UTC
const GARMIN_TIME_OFFSET_SEC = 631065600;

export interface FitParseResult {
  success: boolean;
  workouts: RawExtractedWorkoutData[];
  errors: string[];
  warnings: string[];
}

/**
 * FitParser
 * Parseur binaire déterministe pour fichiers Garmin / ANT+ FIT (.FIT).
 * Conforme au protocole Flexible and Interoperable Data Transfer (FIT).
 */
export class FitParser {
  static parse(buffer: ArrayBuffer | Uint8Array): FitParseResult {
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Validation de l'en-tête FIT
    if (uint8.length < 12) {
      return {
        success: false,
        workouts: [],
        errors: ["Fichier FIT invalide : taille inférieure à l'en-tête minimal (12 octets)."],
        warnings: []
      };
    }

    const headerSize = uint8[0];
    if (headerSize < 12 || headerSize > 16 || headerSize > uint8.length) {
      return {
        success: false,
        workouts: [],
        errors: [`En-tête FIT corrompu : taille déclarée invalide (${headerSize} octets).`],
        warnings: []
      };
    }

    // Vérifier la signature ".FIT"
    const isFitSignature =
      uint8[8] === 0x2E && // '.'
      uint8[9] === 0x46 && // 'F'
      uint8[10] === 0x49 && // 'I'
      uint8[11] === 0x54;   // 'T'

    if (!isFitSignature) {
      return {
        success: false,
        workouts: [],
        errors: ["Signature FIT absente aux octets 8-11. Ce fichier n'est pas un fichier FIT valide."],
        warnings: []
      };
    }

    // Lecture de la taille des données (uint32 à l'offset 4 en little-endian)
    const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    const dataSize = view.getUint32(4, true);

    if (uint8.length < headerSize + dataSize) {
      warnings.push(`Fichier FIT tronqué : taille réelle (${uint8.length}) inférieure à la taille attendue (${headerSize + dataSize}). Analyse partielle en cours.`);
    }

    // Variables pour l'extraction de session
    let sessionSport: string | undefined;
    let startTimeIso: string | undefined;
    let durationSeconds: number | undefined;
    let distanceMeters: number | undefined;
    let avgHeartRate: number | undefined;
    let maxHeartRate: number | undefined;
    let avgPower: number | undefined;
    let maxPower: number | undefined;
    let normalizedPower: number | undefined;
    let avgCadence: number | undefined;
    let elevationGain: number | undefined;
    let calories: number | undefined;
    let providedTss: number | undefined;
    const powerSeries: number[] = [];
    const hrSeries: number[] = [];

    // Définitions de messages locaux (localMessageNum -> Definition)
    interface FieldDef {
      fieldNum: number;
      size: number;
      baseType: number;
    }
    interface MessageDef {
      globalMsgNum: number;
      fields: FieldDef[];
    }
    const localDefs = new Map<number, MessageDef>();

    let offset = headerSize;
    const maxOffset = Math.min(uint8.length, headerSize + dataSize);

    // Boucle de décodage des enregistrements FIT
    try {
      while (offset < maxOffset) {
        const recordHeader = uint8[offset++];

        // Normal Header (bit 7 == 0)
        if ((recordHeader & 0x80) === 0) {
          const isDefinition = (recordHeader & 0x40) !== 0;
          const hasDevData = (recordHeader & 0x20) !== 0;
          const localMsgNum = recordHeader & 0x0F;

          if (isDefinition) {
            // Lecture Définition Message
            if (offset + 5 > maxOffset) break;
            offset++; // reserved byte
            const arch = uint8[offset++]; // 0 = Little Endian, 1 = Big Endian
            const isLittleEndian = arch === 0;
            const globalMsgNum = isLittleEndian
              ? view.getUint16(offset, true)
              : view.getUint16(offset, false);
            offset += 2;

            const numFields = uint8[offset++];
            const fields: FieldDef[] = [];

            for (let f = 0; f < numFields; f++) {
              if (offset + 3 > maxOffset) break;
              const fieldNum = uint8[offset++];
              const size = uint8[offset++];
              const baseType = uint8[offset++];
              fields.push({ fieldNum, size, baseType });
            }

            if (hasDevData && offset < maxOffset) {
              const numDevFields = uint8[offset++];
              offset += numDevFields * 3; // Ignorer les métadonnées développeur
            }

            localDefs.set(localMsgNum, { globalMsgNum, fields });
          } else {
            // Lecture Data Message
            const def = localDefs.get(localMsgNum);
            if (!def) {
              // Message inconnu, impossible d'avancer de manière fiable
              warnings.push(`Définition locale ${localMsgNum} non trouvée à l'offset ${offset - 1}. Arrêt de la lecture.`);
              break;
            }

            // Global Message 18 = SESSION (métadonnées principales de la séance)
            if (def.globalMsgNum === 18) {
              let fieldOffset = offset;
              for (const field of def.fields) {
                if (fieldOffset + field.size > maxOffset) break;

                // Field 5 = sport (enum)
                if (field.fieldNum === 5 && field.size === 1) {
                  const sportCode = uint8[fieldOffset];
                  sessionSport = this.mapFitSportCode(sportCode);
                }
                // Field 2 = start_time (uint32 timestamp)
                else if (field.fieldNum === 2 && field.size === 4) {
                  const garminTime = view.getUint32(fieldOffset, true);
                  if (garminTime > 0 && garminTime !== 0xFFFFFFFF) {
                    const epochMs = (garminTime + GARMIN_TIME_OFFSET_SEC) * 1000;
                    startTimeIso = new Date(epochMs).toISOString();
                  }
                }
                // Field 7 = total_elapsed_time (uint32 / 1000 = secondes)
                else if (field.fieldNum === 7 && field.size === 4) {
                  const rawTime = view.getUint32(fieldOffset, true);
                  if (rawTime !== 0xFFFFFFFF) {
                    durationSeconds = Math.round(rawTime / 1000);
                  }
                }
                // Field 8 = total_timer_time (uint32 / 1000 = secondes)
                else if (field.fieldNum === 8 && field.size === 4) {
                  const rawTimer = view.getUint32(fieldOffset, true);
                  if (rawTimer !== 0xFFFFFFFF && !durationSeconds) {
                    durationSeconds = Math.round(rawTimer / 1000);
                  }
                }
                // Field 9 = total_distance (uint32 / 100 = mètres)
                else if (field.fieldNum === 9 && field.size === 4) {
                  const rawDist = view.getUint32(fieldOffset, true);
                  if (rawDist !== 0xFFFFFFFF) {
                    distanceMeters = rawDist / 100;
                  }
                }
                // Field 16 = avg_heart_rate (uint8)
                else if (field.fieldNum === 16 && field.size === 1) {
                  const hr = uint8[fieldOffset];
                  if (hr !== 0xFF && hr > 0) avgHeartRate = hr;
                }
                // Field 17 = max_heart_rate (uint8)
                else if (field.fieldNum === 17 && field.size === 1) {
                  const mhr = uint8[fieldOffset];
                  if (mhr !== 0xFF && mhr > 0) maxHeartRate = mhr;
                }
                // Field 20 = avg_power (uint16)
                else if (field.fieldNum === 20 && field.size === 2) {
                  const p = view.getUint16(fieldOffset, true);
                  if (p !== 0xFFFF && p > 0) avgPower = p;
                }
                // Field 21 = max_power (uint16)
                else if (field.fieldNum === 21 && field.size === 2) {
                  const mp = view.getUint16(fieldOffset, true);
                  if (mp !== 0xFFFF && mp > 0) maxPower = mp;
                }
                // Field 34 = normalized_power (uint16)
                else if (field.fieldNum === 34 && field.size === 2) {
                  const np = view.getUint16(fieldOffset, true);
                  if (np !== 0xFFFF && np > 0) normalizedPower = np;
                }
                // Field 11 = total_calories (uint16)
                else if (field.fieldNum === 11 && field.size === 2) {
                  const cal = view.getUint16(fieldOffset, true);
                  if (cal !== 0xFFFF) calories = cal;
                }
                // Field 22 = total_ascent (uint16 meters)
                else if (field.fieldNum === 22 && field.size === 2) {
                  const elev = view.getUint16(fieldOffset, true);
                  if (elev !== 0xFFFF) elevationGain = elev;
                }
                // Field 25 = training_stress_score (uint16 / 10)
                else if (field.fieldNum === 25 && field.size === 2) {
                  const rawTss = view.getUint16(fieldOffset, true);
                  if (rawTss !== 0xFFFF && rawTss > 0) {
                    providedTss = rawTss / 10;
                  }
                }

                fieldOffset += field.size;
              }
            }

            // Global Message 20 = RECORD (point de trace / série temporelle)
            else if (def.globalMsgNum === 20) {
              let fieldOffset = offset;
              for (const field of def.fields) {
                if (fieldOffset + field.size > maxOffset) break;
                // Field 7 = power (uint16)
                if (field.fieldNum === 7 && field.size === 2) {
                  const p = view.getUint16(fieldOffset, true);
                  if (p !== 0xFFFF) powerSeries.push(p);
                }
                // Field 3 = heart_rate (uint8)
                else if (field.fieldNum === 3 && field.size === 1) {
                  const hr = uint8[fieldOffset];
                  if (hr !== 0xFF && hr > 0) hrSeries.push(hr);
                }
                // Field 253 = timestamp
                else if (field.fieldNum === 253 && field.size === 4 && !startTimeIso) {
                  const garminTime = view.getUint32(fieldOffset, true);
                  if (garminTime > 0 && garminTime !== 0xFFFFFFFF) {
                    const epochMs = (garminTime + GARMIN_TIME_OFFSET_SEC) * 1000;
                    startTimeIso = new Date(epochMs).toISOString();
                  }
                }
                fieldOffset += field.size;
              }
            }

            // Avancer l'offset de la taille totale de tous les champs de la définition
            const totalRecordSize = def.fields.reduce((sum, f) => sum + f.size, 0);
            offset += totalRecordSize;
          }
        } else {
          // Compressed Timestamp Header : avancer d'1 octet
          offset++;
        }
      }
    } catch (e: any) {
      warnings.push(`Interruption de lecture FIT : ${e.message}`);
    }

    // Détermination de la durée si manquante mais séries temporelles présentes
    if (!durationSeconds && (powerSeries.length > 0 || hrSeries.length > 0)) {
      durationSeconds = Math.max(powerSeries.length, hrSeries.length);
    }

    if (!startTimeIso) {
      warnings.push("Date/heure de début non trouvée dans le fichier FIT. Date du jour utilisée.");
      startTimeIso = new Date().toISOString();
    }

    // Sport par défaut
    if (!sessionSport) {
      sessionSport = 'Other';
      warnings.push("Sport non explicite dans l'en-tête FIT. Classé en 'Other'.");
    }

    const missingFields: string[] = [];
    if (!distanceMeters) missingFields.push('distance');
    if (!avgHeartRate) missingFields.push('averageHeartRate');
    if (!avgPower && !normalizedPower) missingFields.push('power');
    if (!elevationGain) missingFields.push('elevationGain');

    const workout: RawExtractedWorkoutData = {
      sportRaw: sessionSport,
      startTimeRaw: startTimeIso,
      durationSecondsRaw: durationSeconds || 0,
      distanceMetersRaw: distanceMeters,
      averageHeartRateRaw: avgHeartRate,
      maxHeartRateRaw: maxHeartRate,
      averagePowerRaw: avgPower,
      maxPowerRaw: maxPower,
      normalizedPowerRaw: normalizedPower,
      averageCadenceRaw: avgCadence,
      elevationGainMetersRaw: elevationGain,
      caloriesRaw: calories,
      providedTssRaw: providedTss,
      powerSeries: powerSeries.length > 0 ? powerSeries : undefined,
      hrSeries: hrSeries.length > 0 ? hrSeries : undefined,
      confidence: durationSeconds && durationSeconds > 0 ? 'high' : 'medium',
      uncertainFields: [],
      missingFields,
      extractionNotes: [`Format binaire FIT validé (.FIT)`]
    };

    return {
      success: true,
      workouts: [workout],
      errors,
      warnings
    };
  }

  private static mapFitSportCode(code: number): string {
    switch (code) {
      case 1: return 'running';
      case 2: return 'cycling';
      case 5: return 'swimming';
      case 10: return 'strength_training';
      case 11: return 'walking';
      case 15: return 'rowing';
      default: return 'other';
    }
  }
}
