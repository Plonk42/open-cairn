# PoissonRecon WASM — wasm64-mono + wasm32 fallback

Scripts et patches versionnés dans [tools/poisson-wasm/](../tools/poisson-wasm/)
(sources amont : `~/src/PoissonRecon/` — clone vanilla, jamais commit ;
emsdk : `~/src/emsdk`). Artefacts livrés dans ce repo :
[public/wasm/poissonrecon.{mjs,wasm}](../public/wasm/) (wasm64) +
[public/wasm/poissonrecon.wasm32.{mjs,wasm}](../public/wasm/) (fallback).
Loader frontend :
[src/lib/lidarBrowser/poissonRecon.ts](../src/lib/lidarBrowser/poissonRecon.ts).

## Pourquoi deux builds

Le solveur PoissonRecon stocke un octree dont la taille croît en
`8^depth`. Sur les nuages LiDAR HD typiques (200 m de rayon, max densité,
1–3 M points oriented, depth 9–10), l'octree dépasse régulièrement le
plafond `wasm32` de 4 GB de heap → crash `std::bad_alloc`.

`MEMORY64` (proposition WebAssembly64, pointeurs 64 bits) lève ce plafond
à 8 GB et supprime le besoin de patch `size_t` côté source. C'est le
*seul* gain visé : la version multi-thread (pthreads + SharedArrayBuffer
+ COOP/COEP) a été essayée et abandonnée — Atomics.wait domine le temps
de calcul sur Firefox et la complexité d'isolation cross-origin (service
worker pour GitHub Pages, headers Vite, etc.) ne se justifie pas.

## Cibles de support

| Build | Heap max | Cible |
| --- | --- | --- |
| `poissonrecon.{mjs,wasm}` (wasm64-mono) | 8 GB | Chrome/Edge ≥ 128, Firefox ≥ 134, Node ≥ 23 |
| `poissonrecon.wasm32.{mjs,wasm}` (fallback) | 4 GB | Safari (toutes versions WebKit), Chrome ≥ 68, Firefox ≥ 79, Node ≥ 16 |

emcc pose un `throw` au début du glue JS du build wasm64 quand le runtime
ne supporte pas MEMORY64 → l'`import()` rejette, et le loader bascule
automatiquement sur le fallback wasm32. **Un seul `.wasm` est téléchargé**
par client : le perdant n'est jamais fetché.

Aucune COOP/COEP / cross-origin isolation requise (mono-thread, pas de
SharedArrayBuffer).

## Stratégie loader

[poissonRecon.ts](../src/lib/lidarBrowser/poissonRecon.ts) :

```ts
modulePromise = factory('poissonrecon.mjs').catch(() =>
    factory('poissonrecon.wasm32.mjs')
);
```

- En succès wasm64 : pas de log particulier, on tourne en heap 8 GB.
- En fallback wasm32 : `onLog` reçoit `"poisson: wasm64 unavailable …;
  falling back to wasm32"`. Le client garde 4 GB de heap → il faut
  baisser depth ou rayon sur les zones très denses.

## Patches source amont (idempotents)

[tools/poisson-wasm/patch.sh](../tools/poisson-wasm/patch.sh) reset d'abord
`Src/` via `git checkout --`, puis applique 5 patches sur
`~/src/PoissonRecon/Src/` (le repo amont reste donc vierge) :

1. **NestedVector.h** : `((size_t)1)<<(LogSize*(Depth+1))` → `uint64_t`
   (overflow sur wasm32, identique sur wasm64 pour cohérence).
2. **PoissonRecon.cpp** : commente `#include "Image.h"` (turbojpeg pas
   dans le port set d'emcc, et inutilisé).
3. **NestedVector.h** : ajoute `#include <cstdint>` en tête.
4. **MultiThreading.h** : `std::async( std::launch::async , … )` →
   `std::launch::deferred`. `ThreadPool::ParallelSections` (utilisé
   pendant l'extraction iso-surface dans `FEMTree.LevelSet.3D.inl`)
   spawne des threads inconditionnellement, ignorant `--parallel 1`.
   En mono-thread emcc, libc++ jette
   `std::__2::system_error: thread constructor failed: Not supported`.
   `std::launch::deferred` exécute la callable en synchrone sur le
   thread appelant lors du `.get()` — même API, zéro thread.
5. **MyMiscellany.h** : `Profiler` désactive son sampler RSS
   (`if( ms )` → `if( 0 )`). Le constructeur `Profiler(20)` dans
   `PoissonRecon.cpp` essayait sinon de spawn un `std::thread` de
   monitoring mémoire toutes les 20 ms → même crash. `getCurrentRSS`
   n'est de toute façon pas supporté en WASM.

## Build

```bash
cd tools/poisson-wasm
bash ./build.sh           # wasm64 → public/wasm/poissonrecon.{mjs,wasm}
bash ./build-wasm32.sh    # wasm32 → public/wasm/poissonrecon.wasm32.{mjs,wasm}
node  ./smoke.mjs         # sanity-check wasm32 sur Node ≥ 16 (Node 22 OK ;
                          # le wasm64 nécessite Node ≥ 23 et n'est pas testé ici)
```

Les scripts écrivent directement dans `public/wasm/` du repo (chemin
calculé relativement à `tools/poisson-wasm/`). `EMSDK_DIR` et `PR_REPO`
sont configurables via variables d'environnement (défauts : `~/src/emsdk`,
`~/src/PoissonRecon`).

## Flags emcc clés

Communs aux deux builds :

- `-O3 -std=c++17`, `--use-port=zlib`, `--use-port=libpng`
- `-sINITIAL_MEMORY=536870912`, `-sSTACK_SIZE=16777216`,
  `-sALLOW_MEMORY_GROWTH=1`
- `-sMODULARIZE=1 -sEXPORT_ES6=1` pour le `import()` dynamique
- `-sFORCE_FILESYSTEM=1` pour MEMFS (entrée/sortie PLY)
- `-sEXPORTED_RUNTIME_METHODS` inclut `getExceptionMessage` pour décoder
  les exceptions C++ côté JS (sinon `e instanceof Error` est faux et le
  message se perd en pointeur).

Spécifiques wasm64 :

- `-sMEMORY64=1 -sWASM_BIGINT=1`
- `-sMAXIMUM_MEMORY=8589934592` (8 GB)

Spécifiques wasm32 :

- `-sMAXIMUM_MEMORY=4294967296` (4 GB, plafond dur du wasm32)

## Runtime CLI

Le binaire expose le CLI standard de PoissonRecon. Le loader passe :

```
--in /pr_in.ply --out /pr_out.ply
--depth N --bType 2 --samplesPerNode 1.5 --pointWeight 4
--parallel 1
```

`--parallel 1` est obligatoire : aucun des deux builds n'a `-pthread`,
donc `std::thread` n'est pas disponible.

## Historique

- **1er juin** — Premier build mono-thread wasm32 fonctionnel, avec les 5
  patches appliqués depuis un repo de travail (`open-cairn-mesh-lab/`) non
  versionné. Le binaire commit `9032e76` (récupéré via `git show` pour
  diagnostic) tournait avec les 5 patches actifs.
- **4 juin** — Branche expérimentale `wasm-64-multithread` (pthreads +
  SharedArrayBuffer + COOP/COEP) montée puis abandonnée : Atomics.wait
  domine Firefox et la complexité d'isolation cross-origin (service worker
  pour GitHub Pages) ne se justifie pas.
- **5 juin matin** — Portage vers le dual mono-thread (wasm64 + wasm32
  fallback). En refaisant le `patch.sh` du lab non versionné, les patches
  4 (`std::launch::deferred`) et 5 (`Profiler` désactivé) ont été oubliés
  — à tort qualifiés de « pthread-specific ». Conséquence : crash
  `std::__2::system_error: thread constructor failed: Not supported` au
  premier `std::async` ou à l'instanciation de `Profiler(20)`.
- **5 juin après-midi** — Patches restaurés ; tout le toolchain (patches,
  build scripts, smoke test, doc) migré dans [tools/poisson-wasm/](../tools/poisson-wasm/)
  versionné. Le repo amont `~/src/PoissonRecon/` reste un clone vanilla
  (jamais commit), garanti par `git checkout -- Src/` en tête de `patch.sh`.

**Leçon** : les patches source amont et scripts de build doivent être
versionnés *dans* le repo applicatif. Garder ça dans un workspace de
lab non tracké revient à perdre l'information critique au premier oubli.
