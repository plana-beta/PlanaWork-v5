import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // AI Coach Route
  app.post("/api/coach", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ success: false, message: "La clé API Gemini n'est pas configurée sur le serveur." });
      }

      const { prompt, context } = req.body;
      if (!prompt || !context) {
        return res.status(400).json({ success: false, message: "Prompt et contexte sont requis." });
      }

      const ai = new GoogleGenAI({ apiKey });

      const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `
Tu es le Coach IA de l'application Plana (entraînement sportif pour le cyclisme, course, triathlon).
Ton rôle est d'expliquer les données métier déterministes de l'application (charge d'entraînement, fatigue, séances, recommandations) et de proposer des ajustements d'entraînement quand l'athlète le demande ou le justifie (fatigue, séance manquée, progression).

RÈGLES PHYSIOLOGIQUES STRICTES:
1. Tu NE DOIS JAMAIS recalculer ou inventer des métriques (TSS, ATL, CTL, TSB). Base-toi EXCLUSIVEMENT sur le contexte fourni.
2. Tu NE DOIS JAMAIS dépasser +5% d'augmentation de la charge hebdomadaire totale prévue.
3. Si fatigue élevée ou extrême (TSB < -20 ou ATL > 80), AUCUNE augmentation de charge n'est permise (uniquement allègement, annulation ou repos).
4. Pour une séance manquée: NE JAMAIS ajouter ou rattraper automatiquement la charge perdue sur les autres séances. Tu peux proposer une réorganisation (déplacer, adapter, ou repos).
5. Si un ajustement de planning est pertinent (ex: athlète fatigué, demande d'adapter, séance manquée, ou souhait d'alléger), génère une proposition structurée complète dans "proposal".
6. HISTORIQUE ET RESSENTI : Analyse les retours de séance (RPE, sensations, observations déterministes, habitudes, préférences) fournis dans le contexte sans jamais inventer de données.
7. STRICTEMENT AUCUN DIAGNOSTIC MÉDICAL : Tu ne dois jamais formuler de diagnostic médical (ex: "surentraîné", "blessure clinique", "pathologie", "malade"). Analyse uniquement la fatigue et le ressenti d'effort de façon purement sportive et factuelle.
8. AUCUNE MUTATION DIRECTE : Tu n'as aucun pouvoir de modification directe sur le planning. Toute adaptation doit être formulée sous forme de "proposal" soumise au validateur et à l'accord de l'athlète.

CONTEXTE ACTUEL FOURNI PAR PLANA:
${JSON.stringify(context, null, 2)}

MESSAGE DE L'ATHLÈTE:
${prompt}
                `
              }
            ]
          }
        ],
        config: {
          temperature: 0.2, // Factuel et précis
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              message: {
                type: Type.STRING,
                description: "Ta réponse conversationnelle à l'athlète, en tant que coach bienveillant, factuel et précis."
              },
              suggestedAction: {
                type: Type.STRING,
                description: "Une action optionnelle recommandée à l'athlète, par exemple 'OPEN_TODAY_WORKOUT', 'OPEN_PLAN', 'SYNC_HEALTH'. Null si pas d'action suggérée.",
                nullable: true
              },
              proposal: {
                type: Type.OBJECT,
                description: "Proposition formelle d'ajustement du planning soumise à validation de l'athlète.",
                nullable: true,
                properties: {
                  id: { type: Type.STRING },
                  action: {
                    type: Type.STRING,
                    description: "ADAPT_PLAN | MODIFY_WORKOUT | MOVE_WORKOUT | CANCEL_WORKOUT | REDUCE_LOAD | INCREASE_LOAD | RECOVERY | NO_CHANGE"
                  },
                  reason: { type: Type.STRING, description: "Titre ou motif court de la modification" },
                  explanation: { type: Type.STRING, description: "Explication physiologique détaillée du 'Pourquoi' de cette proposition" },
                  affectedWorkoutIds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "IDs des séances ciblées (provenant de plannedWorkouts)"
                  },
                  proposedModifications: {
                    type: Type.ARRAY,
                    nullable: true,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        workoutId: { type: Type.STRING },
                        newDate: { type: Type.STRING, nullable: true },
                        newDurationMin: { type: Type.NUMBER, nullable: true },
                        cancel: { type: Type.BOOLEAN, nullable: true }
                      },
                      required: ["workoutId"]
                    }
                  },
                  confidence: {
                    type: Type.STRING,
                    description: "Niveau de confiance provenant du contexte (INSUFFICIENT_DATA | LOW | MEDIUM | HIGH)"
                  },
                  sourceContext: {
                    type: Type.OBJECT,
                    nullable: true,
                    properties: {
                      currentWeeklyLoad: { type: Type.NUMBER, nullable: true },
                      proposedWeeklyLoad: { type: Type.NUMBER, nullable: true },
                      loadIncreasePercent: { type: Type.NUMBER, nullable: true }
                    }
                  }
                },
                required: ["id", "action", "reason", "affectedWorkoutIds", "confidence"]
              }
            },
            required: ["message"]
          }
        }
      });

      const responseText = response.text;
      if (responseText) {
          const parsed = JSON.parse(responseText);
          res.json({ success: true, ...parsed });
      } else {
          res.status(500).json({ success: false, message: "Réponse vide de l'IA." });
      }

    } catch (error: any) {
      console.error("[Coach API Error]", error);
      res.status(500).json({ success: false, message: "Erreur lors de la communication avec l'IA.", error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
