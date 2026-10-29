# ELEMENTS asset sources

Checked **29 October 2026**. The production direction is realistic characters, scanned environments and captured animation, as specified in [ART-PRODUCTION-PLAN.md](ART-PRODUCTION-PLAN.md). This register checks whether the proposed sources can supply assets for a commercial browser game at $0. It does not certify individual files that have not been downloaded.

**The complete pipeline is not confirmed at $0.** ElevenLabs sound effects, Eleven Music downloads, Marble exports and Scaniverse commercial rights have restrictions described below. Hunyuan's current hosted-service rights and account quota remain unresolved. Keep blocked sources out of the shipping asset set until resolved.

“Commercial” means permission to use an asset in a commercial game, not permission to resell the asset file. CC0 permits commercial reuse without attribution. An export is a file downloaded for use elsewhere. Resolution describes image detail; motion data has no image resolution. Gaussian splatting depicts a scene using many small coloured shapes rather than a conventional model surface.

## Current production pipeline

The date in each row applies to its linked sources. **Not confirmed** means the checked pages did not establish a detail, or available sources conflict. No paid subscription or purchase is authorized by this document.

| Source and project use | License and commercial game use | Free allowance and export limits | Attribution, watermark and regional checks | Sources; checked |
| --- | --- | --- | --- | --- |
| Megascans: rocks, ruins and ground | Fab Standard License permits commercial projects in compatible engines. Legacy acquisitions need their original license checked; see below. | Quixel advertises over 2,000 free Megascans; other listings are sold individually. Static FBX and glTF. Exact free items and texture resolutions require a per-listing check. | No publisher credit required under Fab Standard. Watermark: **not confirmed**, no explicit statement found. Complete regional availability: **not confirmed**; Fab's terms page did not expose its substantive text. | [Quixel](https://quixel.com/ai-info), [Fab license](https://www.fab.com/eula), [terms](https://www.fab.com/terms-of-service); 2026-10-29 |
| Poly Haven: scanned materials, models and lighting panoramas | CC0; commercial game use and redistribution allowed. | Published assets are free, without a signup paywall. Site advertises 16K+ lighting panoramas and at least 8K textures. Rock Boulder Dry offers 1K–16K, Blend/glTF packages and EXR/JPG/PNG maps. Formats vary by asset. | No attribution required. No territorial exclusion found in the asset license. Watermark: **not confirmed** as an express promise; downloaded files were not inspected. | [License](https://polyhaven.com/license), [library](https://polyhaven.com/), [example download](https://polyhaven.com/a/rock_boulder_dry); 2026-10-29 |
| Hunyuan 3D: characters, weapons and props | Hosted Global commercial output rights: **not confirmed**; its separate terms could not be read in full. Downloadable 2.1 uses Tencent's community license with territorial restrictions; see below. | Tencent's November 2025 announcement promises 20 free generations daily and OBJ/GLB output. Today's account allowance, single-image versus multi-view charging and export resolution: **not confirmed** behind login. | Hosted attribution, watermark and territory coverage: **not confirmed**, unreadable terms. Do not substitute the model license for the hosted agreement. | [Announcement](https://www.tencent.com/tencent-announces-global-launch-of-hunyuan-3d-engine-to-empower-creators-with-advanced-creation-tools/), [app](https://hy3d.tencent.ai/), [hosted terms](https://docs.qq.com/doc/DSHRnRWp2YUVuQXJv), [2.1 license](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE); 2026-10-29 |
| Blender: cleanup, rigging and export | Software is GPL, principally GPL-2.0-or-later. Commercial artwork is allowed; original artwork need not be GPL. Imported assets retain their restrictions. | Free software; no service generation quota. Exact export options depend on the installed version; no version was tested. | No artwork attribution requirement or territorial exclusion found on the license page. Watermark/export-resolution limits: **not confirmed by a test**; this is a local tool, not a hosted free tier. | [License and artwork rights](https://www.blender.org/about/license/); 2026-10-29 |
| Mixamo: combat clips and rigging | Adobe permits royalty-free characters and animations in commercial games. | Free with Adobe ID; no Creative Cloud subscription. Numeric download quota: **not confirmed**, FAQ does not state a number. Upload accepts FBX/OBJ/ZIP; existing rigs require FBX. Current download menu: **not confirmed** without login; verify FBX at export. | China country-code accounts excluded; Enterprise/Federated IDs unsupported. Attribution and watermark: **not confirmed**, FAQ gives no explicit policy. Image resolution does not apply to motion. | [FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html), [rigging guide](https://helpx.adobe.com/creative-cloud/help/mixamo-rigging-animation.html); 2026-10-29 |
| Rokoko Vision through Create/Studio: performed signature moves | Rokoko terms apply; Create FAQ expressly permits commercial use of generated video-to-motion data. | Starter: 30 seconds of video processing/month, FBX export, one month of cloud storage. Custom-character import/retargeting and BVH appear under paid Basic on the Vision page. Retargeting transfers movement to another character's skeleton. | Attribution and watermark: **not confirmed**, no explicit statement found. Terms §13 requires export-law compliance; no exhaustive country list found. Image resolution does not apply to motion. | [Vision plans](https://www.rokoko.com/products/vision), [commercial-use FAQ](https://create.rokoko.com/), [terms](https://www.rokoko.com/terms-of-use); 2026-10-29 |
| ElevenLabs Sound Effects: hits, casts and interface sounds | General FAQ excludes commercial use on Free. A sound-effects marketing page claims commercial use broadly: **conflict, free commercial permission not confirmed**. Keep free output out of the shipping game. | Free platform allocation: 10,000 credits/month shared across features. Documentation states 40 credits/second for specified duration. Product guide offers MP3 44.1 kHz or WAV 48 kHz; Free-specific format entitlements are **not confirmed**. | Free publication requires ElevenLabs credit under its general FAQ. Watermark: **not confirmed**. Country blocks listed below. | [Pricing](https://elevenlabs.io/pricing), [publishing policy](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform), [conflicting FAQ](https://elevenlabs.io/sound-effects/free), [credit cost](https://elevenlabs.io/docs/overview/capabilities/sound-effects), [formats](https://elevenlabs.io/docs/eleven-creative/playground/sound-effects); 2026-10-29 |
| Eleven Music: soundtrack | Music Terms govern this product. Free media-rights wording permits commercial uses except specified categories, including Studio Games; it conflicts with the general FAQ. This team's exact use: **not confirmed**. | Terms dated 9 October 2026 list Free: 11 generation minutes/month, **no downloads**, no API or high-quality downloads. This blocks free soundtrack export regardless of the rights conflict. | Free requires Eleven Music attribution. Terms allow AI provenance marking without guaranteeing a watermark. Availability can vary by model/location; country blocks below also apply. | [Music Terms, §§1, 3–4 and Exhibit A](https://elevenlabs.io/music-terms), [general FAQ](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform); 2026-10-29 |
| Marble: skyline and distant scenery | World Labs terms §3.3 restrict Free output to personal, noncommercial use. Pricing puts commercial rights on Pro. Standard's rights are **not confirmed**: general paid-account terms are broader than the pricing table. | Free: 7,000 credits, up to four worlds. Exports start at Standard; high-resolution textured meshes at Pro. Paid export specs include SPZ/PLY splats, GLB meshes and a 2560×1280 PNG panorama. | Preserve embedded notices/watermarks; paid users must credit World Labs on reasonable request (§3.7). Whether every export carries a watermark: **not confirmed**. Terms §12.11 restrict sanctioned/embargoed locations and restricted users. | [Pricing](https://marble.worldlabs.ai/pricing), [billing](https://docs.worldlabs.ai/marble/support/account-billing), [export specs](https://docs.worldlabs.ai/marble/export/specs), [terms](https://www.worldlabs.ai/terms-of-service); 2026-10-29 |
| Scaniverse: local scans | New Scaniverse's pricing FAQ requires Pro or Enterprise for commercial rights. Free exports are not commercially cleared. Classic's present commercial permission is **not confirmed**: vendor staff describe it as noncommercial. | New Free: 20,000 credits/month, approximately ten minutes of mobile capture; FBX/SPZ/PLY export. Classic offers unlimited on-device splat processing. Fixed texture-resolution allowance: **not confirmed**, not stated. | Attribution and watermark: **not confirmed**, reviewed pages do not specify them. Business terms §17.8 applies export/sanctions controls. Complete country-availability list: **not confirmed**, none found. | [Plans and FAQ](https://www.nianticspatial.com/pricing), [business terms](https://www.nianticspatial.com/terms-business), [staff explanation](https://community.nianticspatial.com/t/are-there-any-plans-for-this-to-be-available-in-a-license-for-students/5747); 2026-10-29 |

## Two licensing decisions

### Megascans in a Three.js browser game: yes under Fab Standard

Fab's official summary says:

> Use the assets with any compatible tools (usage is not limited to Unreal Engine)

Commercial distribution of projects containing the assets is allowed; standalone redistribution is excluded. Save the **Fab Standard** acquisition record and keep restricted raw files out of the public repository. The full binding EULA was not exposed by the text reader; this quotation is from Epic's own summary. [Fab license, checked 2026-10-29](https://www.fab.com/eula).

**No under legacy Unreal-only rights.** The Megascans Content Addendum, §1(c), limits Unreal Engine plan acquisitions to UE-Only Content. A verified additional Fab entitlement can change the available rights; finding the same item on Fab does not establish that entitlement. The whole-library free promotion ended in 2024. Check today's free subset and any previous entitlements separately. [Legacy agreement](https://www.unrealengine.com/eula/content), [acquisition guidance](https://dev.epicgames.com/documentation/fab/purchasing-and-downloading-assets-in-fab), [dated promotion](https://www.unrealengine.com/blog/fab-epics-new-unified-content-marketplace-launches-today?lang=en-US); checked 2026-10-29.

### Hunyuan territory exclusions: yes for model 2.1; none in the hosted Global terms

The 2.1 community license, §1(l), defines Territory:

> “Territory” shall mean the worldwide territory, excluding the territory of the European Union, United Kingdom and South Korea.

Section 5(c) expressly restricts use, distribution and display of **Output** outside that territory. Section 6(d)'s statement that Tencent claims no output rights does not remove §5(c). Worldwide distribution therefore needs a different permission basis.

Commercial use is conditional: §4 requires a separate license above one million monthly active users, measured as specified at the model's release. Distribution of model works has license/notice obligations; the acceptable-use policy also requires public AI-content disclosure. These are not CC0 assets. [Full 2.1 license, checked 2026-10-29](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE).

For **hosted Global**, the login page links a separate agreement. Its full terms, output attribution and territorial scope are **not confirmed**: search and browser readers exposed the document shell but not its full text. Obtain readable terms for the exact service/model before approving worldwide distribution. [Hosted terms](https://docs.qq.com/doc/DSHRnRWp2YUVuQXJv), [acceptable-use policy](https://docs.qq.com/doc/DSHFRaU96UWVhRVZV); checked 2026-10-29.


**Hosted Global terms, read 29 Oct 2026** (Tencent HY 3D Global Terms of Service, last updated 6 Feb 2026, [linked from hy3d.tencent.ai](https://docs.qq.com/doc/DSHRnRWp2YUVuQXJv)). These terms govern models made on the website, not the 2.1 license above.

- **Ownership, section 6.3:** "we hereby assign to you all our rights, title and interest, if any, in and to the Outputs." No EU, UK or South Korea exclusion appears anywhere in the terms. The only country limit is comprehensive sanctions.
- **Disclosure, section 6.6:** published outputs must be labelled as AI-generated. Credit Hunyuan 3D in the game's credits.
- **Watermarks, section 6.7:** "We will add artificial intelligence-generated marks to the Output, such as watermarks that are visible to the naked eye". Check every downloaded model's textures for a visible mark before use.
- **Access, section 4.2:** use is allowed "within the designated territory", which the terms do not define. This limits where the team can use the website, not where players can be.

Decision: generate on the hosted website only. Do not run the downloadable 2.1 model for game assets.

## Audio and motion corrections

Eleven Music distinguishes independent games from Studio Games and imposes account eligibility rules. Free is individual-use only. Its download prohibition blocks the $0 soundtrack workflow; do not capture previews to work around it. A later paid choice needs the team's game category and account eligibility checked. [Music Terms, checked 2026-10-29](https://elevenlabs.io/music-terms).

ElevenLabs blocks service access from Belarus, Cuba, Iran, North Korea, Russia, Syria, Crimea, and Ukraine's Donetsk and Luhansk oblasts. This is a service-access list, not a conclusion about where licensed game audio may be distributed. [Country policy, checked 2026-10-29](https://elevenlabs.io/docs/help-center/legal/do-you-restrict-access-to-the-service-and-platform-for-any-specific-countries).

For Rokoko, budget all processed takes against 30 seconds/month. Four ten-second takes exceed that before retries. The general pricing FAQ and Vision page disagree on some paid BVH entitlements; FBX is the confirmed free path. [Vision](https://www.rokoko.com/products/vision), [pricing](https://www.rokoko.com/pricing); checked 2026-10-29. This finding does not reduce the four-ultimate design.

## Retained fallbacks

These are fallback choices, not the current visual direction. KayKit or Quaternius characters need an art-direction decision before replacing realistic heroes. Kenney audio is a possible substitute for blocked sound effects.

| Source | License and commercial use | Free content and limits | Credit, regions and verification gaps | Sources; checked |
| --- | --- | --- | --- | --- |
| KayKit Adventurers | CC0; commercial use allowed. | Five characters, 25+ accessories; FBX/glTF and 1024×1024 atlas. Extra characters and Blend sources are paid. | No attribution required; no regional exclusion stated. Watermark: **not confirmed**, no downloaded-file inspection. Other KayKit packs need separate checks. | [Pack page](https://kaylousberg.itch.io/kaykit-adventurers); 2026-10-29 |
| Quaternius | Current Quaternius Asset License v1.0 permits commercial games, excludes standalone asset redistribution and requires no credit. Older FAQ still says CC0: **exact pack license not confirmed** until its included license is inspected. | Free packs available; contents, formats and texture resolution vary by pack. No generation quota applies to downloads. | QAL grants worldwide rights. Watermark: **not confirmed** without a selected download. Preserve evidence for older CC0 acquisitions. | [Current license, dated 28 August 2026](https://quaternius.com/license.html), [conflicting FAQ](https://quaternius.com/faq.html); 2026-10-29 |
| Kenney | Asset-page downloads are CC0; commercial use allowed. | Impact Sounds offers 130 files free. Particle/prop packs remain possible fallbacks. Exact audio encoding, particle resolution and watermark: **not confirmed**; no archive inspected and particle page failed to load. | No attribution required; no territorial restriction stated in support policy. | [License policy](https://kenney.nl/support), [Impact Sounds](https://kenney.nl/assets/impact-sounds), [particle page attempted](https://kenney.nl/assets/particle-pack); 2026-10-29 |

ambientCG, Sonniss and Pixabay from the old register are outside the current art plan and are not cleared by this revision. Re-check a specific pack or track before adding one. Previous vendor rejections are not repeated as current facts.

## Code libraries

These source-code licenses permit commercial software under their conditions, without library-license fees or service quotas. Hosting and network charges are separate. No dependencies were installed or versions locked in this task.

| Library | Proposed use | License and obligations | Free-tier note | Publisher source; checked |
| --- | --- | --- | --- | --- |
| `three` | Browser 3D rendering | MIT; retain copyright and permission notice. | Free library; no service quota. | [License](https://github.com/mrdoob/three.js/blob/dev/LICENSE); 2026-10-29 |
| `@dimforge/rapier3d-compat` | Physics | Apache-2.0; preserve license/notices and mark distributed modifications. | Free library; no service quota. | [JS license](https://github.com/dimforge/rapier.js/blob/master/LICENSE), [project](https://rapier.rs/docs/); 2026-10-29 |
| `postprocessing` | Element glow and image effects | Zlib; preserve source notice, identify altered source, do not misrepresent authorship. | Free library; no service quota. | [License](https://raw.githubusercontent.com/pmndrs/postprocessing/main/LICENSE.md), [package](https://github.com/pmndrs/postprocessing/blob/main/package.json); 2026-10-29 |
| `howler` | Audio playback | MIT; retain copyright and permission notice. | Free library; no service quota. | [Publisher README and license](https://github.com/goldfire/howler.js/blob/master/README.md?plain=1); 2026-10-29 |
| `colyseus` | Game server and player rooms | MIT; retain copyright and permission notice. | Free framework; hosted Cloud is separate. | [Publisher repository](https://github.com/colyseus/colyseus); 2026-10-29 |
| `near-api-js` | NEAR account and contract calls | Publisher states MIT and Apache-2.0; retain both license texts and applicable notices. | Free library; network costs separate. | [Publisher licensing statement](https://github.com/near/near-api-js); 2026-10-29 |
| `near-sdk-js` | NEAR contracts in JavaScript | Publisher states MIT and Apache-2.0; retain both license texts and applicable notices. | Free library; deployment costs separate. | [Publisher licensing statement](https://github.com/near/near-sdk-js); 2026-10-29 |
| `@babylonjs/core` | Alternative 3D engine | Apache-2.0; preserve license/notices and mark distributed modifications. | Free library; no service quota. | [License](https://github.com/BabylonJS/Babylon.js/blob/master/license.md?plain=1); 2026-10-29 |

## Rules for the team

1. Record each asset's exact source, creator, acquisition date, license version, account plan and permitted game use. A free download alone is insufficient.
2. Keep a `CREDITS.md` when assets enter the product. Preserve required license notices separately. Record optional CC0 credits too.
3. Save rights evidence alongside raw assets. Keep restricted raw scans and animation libraries out of public repositories. Publish only what their licenses permit.
4. Use original work and cleared inputs. Confirm rights to reference images, characters, filmed performances and scanned subjects.
5. Follow the art plan's worn materials and human proportions. Only elements glow: IGNIS crimson, AQUES azure, TERRA ochre, AURA pale white.
6. Follow the [art plan's budgets and formats](ART-PRODUCTION-PLAN.md#lightweight-specs). They are project targets, not vendor export guarantees. Preserve raw and cleaned sources; measure compressed size and browser performance during implementation.
7. Resolve the named rights and export blockers before relying on those assets. Seek vendor clarification or legal review for conflicting terms and worldwide Hunyuan distribution. This evidence register does not replace that review.

## Next checks before production use

- Obtain readable hosted Hunyuan terms and the signed-in quota/cost schedule, including multi-view, retries, texturing and rigging.
- Select exact free Fab assets and record their Fab Standard entitlements and formats.
- Replace or separately fund blocked audio/splat steps; preserve the $0 constraint until the team changes it.
- Check licenses inside downloaded packs and capture actual export settings. This research pass generated, purchased and downloaded no game assets.
