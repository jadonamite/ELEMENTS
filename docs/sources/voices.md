# Sources: voices

## client/public/assets/voice/

Every townsperson line in `shared/dialogue.json` spoken by synthetic voices, rendered once with VoiceStudio and shipped as files. The voices are designed from written descriptions; none is cloned from a real person.

| Voices | Engine | Model |
| --- | --- | --- |
| Adults (`*_sindr_male`, `*_sindr_female`, except children) | VoxCPM2 through mlx-audio | `mlx-community/VoxCPM2-8bit` (Apache-2.0) |
| Children (`child_sindr_*`) | OmniVoice | `k2-fsa/OmniVoice` (used under agreement) |

Each line is stored as `<voice>/<key>.ogg` (Opus, 32 kbps mono) and `.m4a` (AAC), where `<key>` is `lineKey()` of the spoken text (`shared/src/story/voice.ts`). `manifest.json` lists the recorded lines per voice.

Players are told the voices are AI-generated in the credits.
