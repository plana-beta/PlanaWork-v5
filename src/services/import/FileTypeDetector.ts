import { SupportedFileFormat } from '../../domain/workoutImportTypes';

export interface FileDetectionResult {
  format: SupportedFileFormat;
  mimeType: string;
  isCompliant: boolean;
  error?: string;
}

export const MAX_IMPORT_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 Mo

/**
 * FileTypeDetector
 * Analyse le type réel d'un fichier à partir de son en-tête binaire (magic numbers)
 * et de son contenu plutôt que de se fier uniquement à l'extension.
 */
export class FileTypeDetector {
  /**
   * Vérifie la taille maximale autorisée.
   */
  static validateFileSize(sizeBytes: number, maxBytes: number = MAX_IMPORT_FILE_SIZE_BYTES): { valid: boolean; error?: string } {
    if (sizeBytes <= 0) {
      return { valid: false, error: "Le fichier est vide (0 octet)." };
    }
    if (sizeBytes > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
      return {
        valid: false,
        error: `Fichier trop volumineux (${sizeMb} Mo). La taille maximale autorisée est de ${maxMb} Mo.`
      };
    }
    return { valid: true };
  }

  /**
   * Détecte le format du fichier via ses magic bytes et son contenu.
   */
  static detect(
    fileName: string,
    buffer: Uint8Array | ArrayBuffer | string
  ): FileDetectionResult {
    const uint8 = typeof buffer === 'string'
      ? new TextEncoder().encode(buffer.slice(0, 1024))
      : buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer);

    const sizeCheck = this.validateFileSize(uint8.byteLength);
    if (!sizeCheck.valid) {
      return {
        format: 'unknown',
        mimeType: 'application/octet-stream',
        isCompliant: false,
        error: sizeCheck.error
      };
    }

    // 1. Détection de signatures exécutables malveillantes (MZ = DOS/Windows PE, \x7FELF = Linux ELF)
    if (uint8.length >= 2 && uint8[0] === 0x4D && uint8[1] === 0x5A) {
      return { format: 'unknown', mimeType: 'application/x-msdownload', isCompliant: false, error: "Fichier exécutable interdit pour des raisons de sécurité." };
    }
    if (uint8.length >= 4 && uint8[0] === 0x7F && uint8[1] === 0x45 && uint8[2] === 0x4C && uint8[3] === 0x46) {
      return { format: 'unknown', mimeType: 'application/x-elf', isCompliant: false, error: "Binaire exécutable interdit." };
    }

    // 2. Détection format FIT (Garmin / Wahoo)
    // Le protocole FIT place les 4 octets ".FIT" (0x2E, 0x46, 0x49, 0x54) aux offsets 8..11
    if (uint8.length >= 12) {
      if (
        uint8[8] === 0x2E &&
        uint8[9] === 0x46 &&
        uint8[10] === 0x49 &&
        uint8[11] === 0x54
      ) {
        return { format: 'fit', mimeType: 'application/vnd.ant.fit', isCompliant: true };
      }
    }

    // 3. Détection format PDF (%PDF- = 0x25, 0x50, 0x44, 0x46, 0x2D)
    if (uint8.length >= 5) {
      if (
        uint8[0] === 0x25 &&
        uint8[1] === 0x50 &&
        uint8[2] === 0x44 &&
        uint8[3] === 0x46 &&
        uint8[4] === 0x2D
      ) {
        return { format: 'pdf', mimeType: 'application/pdf', isCompliant: true };
      }
    }

    // 4. Détection Images (PNG, JPEG, WebP)
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (uint8.length >= 8 && uint8[0] === 0x89 && uint8[1] === 0x50 && uint8[2] === 0x4E && uint8[3] === 0x47) {
      return { format: 'image', mimeType: 'image/png', isCompliant: true };
    }
    // JPEG: FF D8 FF
    if (uint8.length >= 3 && uint8[0] === 0xFF && uint8[1] === 0xD8 && uint8[2] === 0xFF) {
      return { format: 'image', mimeType: 'image/jpeg', isCompliant: true };
    }
    // WebP: RIFF....WEBP
    if (
      uint8.length >= 12 &&
      uint8[0] === 0x52 && uint8[1] === 0x49 && uint8[2] === 0x46 && uint8[3] === 0x46 &&
      uint8[8] === 0x57 && uint8[9] === 0x45 && uint8[10] === 0x42 && uint8[11] === 0x50
    ) {
      return { format: 'image', mimeType: 'image/webp', isCompliant: true };
    }

    // 5. Détection XML / Texte (TCX, GPX, JSON, CSV)
    // Décodage des premiers 2048 caractères
    let textSample = '';
    try {
      const sampleSlice = uint8.subarray(0, Math.min(uint8.length, 2048));
      textSample = new TextDecoder('utf-8', { fatal: false }).decode(sampleSlice).trim();
    } catch {
      // Données binaires non textuelles
      textSample = '';
    }

    if (textSample.length > 0) {
      const lower = textSample.toLowerCase();

      // Sécurité : rejet des balises de scripts actives
      if (lower.includes('<script') || lower.includes('javascript:')) {
        return { format: 'unknown', mimeType: 'text/html', isCompliant: false, error: "Contenu script ou HTML potentiellement actif non autorisé." };
      }

      // TCX XML : <TrainingCenterDatabase
      if (lower.includes('<trainingcenterdatabase')) {
        return { format: 'tcx', mimeType: 'application/vnd.garmin.tcx+xml', isCompliant: true };
      }

      // GPX XML : <gpx
      if (lower.includes('<gpx')) {
        return { format: 'gpx', mimeType: 'application/gpx+xml', isCompliant: true };
      }

      // JSON : commence par { ou [ et est du JSON valide
      if (textSample.startsWith('{') || textSample.startsWith('[')) {
        try {
          // Si nous avons tout le buffer ou un échantillon qui parse
          const fullText = typeof buffer === 'string'
            ? buffer
            : new TextDecoder('utf-8').decode(uint8);
          JSON.parse(fullText);
          return { format: 'json', mimeType: 'application/json', isCompliant: true };
        } catch {
          // Si le JSON est mal formé
          if (fileName.toLowerCase().endsWith('.json')) {
            return { format: 'json', mimeType: 'application/json', isCompliant: true };
          }
        }
      }

      // CSV : lignes multiples avec séparateurs tabulaires
      if (this.looksLikeCsv(textSample, fileName)) {
        return { format: 'csv', mimeType: 'text/csv', isCompliant: true };
      }
    }

    // Fallback par extension si les magic bytes ne sont pas concluants
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'fit':
        return { format: 'fit', mimeType: 'application/vnd.ant.fit', isCompliant: true };
      case 'tcx':
        return { format: 'tcx', mimeType: 'application/vnd.garmin.tcx+xml', isCompliant: true };
      case 'gpx':
        return { format: 'gpx', mimeType: 'application/gpx+xml', isCompliant: true };
      case 'csv':
        return { format: 'csv', mimeType: 'text/csv', isCompliant: true };
      case 'json':
        return { format: 'json', mimeType: 'application/json', isCompliant: true };
      case 'pdf':
        return { format: 'pdf', mimeType: 'application/pdf', isCompliant: true };
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'webp':
        return { format: 'image', mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, isCompliant: true };
      default:
        return { format: 'unknown', mimeType: 'application/octet-stream', isCompliant: false, error: "Format de fichier non reconnu." };
    }
  }

  private static looksLikeCsv(sample: string, fileName: string): boolean {
    const lines = sample.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2 && !fileName.toLowerCase().endsWith('.csv')) {
      return false;
    }

    const firstLine = lines[0] || '';
    const delimiters = [',', ';', '\t', '|'];
    
    // Vérifier si un délimiteur est présent au moins 2 fois sur la 1ère ligne
    for (const d of delimiters) {
      if (firstLine.split(d).length >= 3) {
        return true;
      }
    }

    // Vérifier des mots-clés typiques de colonnes sportives
    const lowerFirst = firstLine.toLowerCase();
    const sportKeywords = ['date', 'time', 'duration', 'durée', 'distance', 'sport', 'hr', 'heart_rate', 'power', 'tss'];
    const matched = sportKeywords.filter(k => lowerFirst.includes(k));
    if (matched.length >= 2) {
      return true;
    }

    return fileName.toLowerCase().endsWith('.csv');
  }
}
